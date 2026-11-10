import * as THREE from 'three';
import { createAntModel } from './ant-model.js';

function angleDifference(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// Covers the rotated body, fully extended legs, antennae, and carried file.
const ANT_FOOTPRINT_RADIUS = 24;

function supportsMultisample(samples) {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2', { antialias: false });
  if (!gl) return false;
  const supported = typeof gl.renderbufferStorageMultisample === 'function' &&
    gl.getParameter(gl.MAX_SAMPLES) >= samples;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return supported;
}

export function createAntRenderer(canvas, options = {}) {
  const requestedSamples = options.msaaSamples === undefined ? 2 : options.msaaSamples;
  const multisample = requestedSamples >= 2 && supportsMultisample(requestedSamples);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !multisample && options.antialias !== false,
    premultipliedAlpha: false
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  const target = multisample ? new THREE.WebGLRenderTarget(1, 1, {
    samples: requestedSamples,
    depthBuffer: true,
    stencilBuffer: false
  }) : null;
  const outputScene = multisample ? new THREE.Scene() : null;
  const outputCamera = multisample ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2) : null;
  const outputQuad = multisample ? new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, toneMapped: false,
      depthTest: false, depthWrite: false })
  ) : null;
  if (outputScene) {
    outputCamera.position.z = 1;
    outputScene.add(outputQuad);
  }

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffeee0, 2.2));
  const key = new THREE.DirectionalLight(0xffe4c2, 3.2);
  key.position.set(-80, -90, 150);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd7eb, 2.4);
  fill.position.set(95, 55, 90);
  scene.add(fill);

  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 1000);
  const models = new Map();
  let width = 1;
  let height = 1;
  let lastTime = null;
  let lastDelta = 1 / 60;
  let frameId = 0;
  let lastIconClears = 0;
  let lastDrawCalls = 0;
  let lastTriangles = 0;
  let suspended = false;
  const bufferSize = new THREE.Vector2();

  function setBufferSize(bufferWidth, bufferHeight) {
    renderer.setSize(bufferWidth, bufferHeight, false);
    if (target) {
      renderer.getDrawingBufferSize(bufferSize);
      target.setSize(bufferSize.x, bufferSize.y);
    }
  }

  function setVisible(visible) {
    if (!visible && !suspended) {
      suspended = true;
    } else if (visible && suspended) {
      suspended = false;
      lastTime = null;
      lastDelta = 1 / 60;
    }
  }

  function resize(nextWidth, nextHeight, dpr) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    renderer.setPixelRatio(Math.min(dpr || 1, 2));
    setBufferSize(width, height);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.position.set(width / 2, height / 2, 250);
    camera.lookAt(width / 2, height / 2, 0);
    camera.updateProjectionMatrix();
  }

  function clearIcons(obstacles) {
    let clears = 0;
    for (const { x, y, w, h } of obstacles) {
      const left = Math.max(0, x);
      const top = Math.max(0, y);
      const right = Math.min(width, x + w);
      const bottom = Math.min(height, y + h);
      if (right <= left || bottom <= top) continue;

      let intersectsAnt = false;
      for (const actor of models.values()) {
        if (actor.x + ANT_FOOTPRINT_RADIUS < left || actor.x - ANT_FOOTPRINT_RADIUS > right ||
          actor.y + ANT_FOOTPRINT_RADIUS < top || actor.y - ANT_FOOTPRINT_RADIUS > bottom) continue;
        intersectsAnt = true;
        break;
      }
      if (!intersectsAnt) continue;
      if (!clears) renderer.setScissorTest(true);
      renderer.setScissor(left, height - bottom, right - left, bottom - top);
      renderer.clear(true, false, false);
      clears += 1;
    }
    if (clears) renderer.setScissorTest(false);
    lastIconClears = clears;
  }

  function render(ants, obstacles, time, running, entryPortal, retainMissing = false) {
    if (suspended) return;
    const seconds = time / 1000;
    if (lastTime !== null && seconds !== lastTime) {
      lastDelta = Math.min(0.1, Math.max(1 / 240, seconds - lastTime));
    }
    const dt = lastDelta;
    lastTime = seconds;
    frameId += 1;
    for (const ant of ants) {
      let actor = models.get(ant.id);
      if (!actor) {
        const model = createAntModel(ant.id);
        actor = {
          ...model,
          x: ant.x,
          y: ant.y,
          motionX: ant.motionX ?? ant.x,
          motionY: ant.motionY ?? ant.y,
          angle: -ant.angle,
          baseScale: model.group.scale.x,
          motionState: {}
        };
        models.set(ant.id, actor);
        scene.add(actor.group);
      }
      actor.frameId = frameId;
      actor.group.visible = true;
      const portal = ant.renderPortal || entryPortal;
      const entering = ant.mode === 'deposit' && portal;
      const progress = entering ? Math.min(1, Math.max(0, ant.entryProgress)) : 0;
      const eased = progress * progress * (3 - 2 * progress);
      const sway = entering ? Math.sin(Math.PI * progress) * ((ant.id % 5) - 2) * 1.2 : 0;
      const visualX = entering ? ant.x + (portal.mouth.x - ant.x) * eased + sway : ant.x;
      const visualY = entering ? ant.y + (portal.mouth.y - ant.y) * eased : ant.y;
      const motionX = ant.motionX ?? visualX;
      const motionY = ant.motionY ?? visualY;
      if (!retainMissing || actor.lastRenderTime !== time) {
        const moved = Math.hypot(motionX - actor.motionX, motionY - actor.motionY);
        const distance = running && moved < 35 ? moved : 0;
        const target = entering
          ? -Math.atan2(portal.mouth.y - ant.y, portal.mouth.x - ant.x)
          : -ant.angle;
        const turn = angleDifference(actor.angle, target);
        const step = Math.max(-dt * 18, Math.min(dt * 18, turn));
        actor.angle += step;
        const motionState = actor.motionState;
        motionState.time = seconds;
        motionState.speed = running ? distance / dt : 0;
        motionState.carrying = ant.carrying || Boolean(entering);
        motionState.payloadKind = ant.payloadKind;
        motionState.payloadBytes = ant.payloadBytes;
        motionState.turnRate = step / dt;
        motionState.distance = distance;
        actor.update(motionState);
        actor.motionX = motionX;
        actor.motionY = motionY;
        actor.lastRenderTime = time;
      }
      actor.group.position.set(visualX, height - visualY, 0);
      actor.group.rotation.z = actor.angle;
      actor.group.scale.setScalar(actor.baseScale * (1 - eased * 0.7));
      actor.x = visualX;
      actor.y = visualY;
    }
    for (const [id, actor] of models) {
      if (actor.frameId === frameId) continue;
      if (retainMissing) {
        actor.group.visible = false;
        continue;
      }
      scene.remove(actor.group);
      actor.dispose();
      models.delete(id);
    }
    if (target) renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    lastDrawCalls = renderer.info.render.calls;
    lastTriangles = renderer.info.render.triangles;
    if (target) {
      renderer.setRenderTarget(null);
      renderer.render(outputScene, outputCamera);
    }
    clearIcons(obstacles);
  }

  function pruneModels(activeIds) {
    for (const [id, actor] of models) {
      if (activeIds.has(id)) continue;
      scene.remove(actor.group);
      actor.dispose();
      models.delete(id);
    }
  }

  function dispose() {
    for (const actor of models.values()) {
      scene.remove(actor.group);
      actor.dispose();
    }
    models.clear();
    if (target) {
      target.dispose();
      outputQuad.geometry.dispose();
      outputQuad.material.dispose();
    }
    renderer.dispose();
  }

  return {
    resize,
    render,
    pruneModels,
    setVisible,
    stats: () => ({
      drawCalls: lastDrawCalls,
      triangles: lastTriangles,
      iconClears: lastIconClears
    }),
    dispose
  };
}

function visualAntPoint(ant, portal) {
  if (ant.mode !== 'deposit' || !portal) return { x: ant.x, y: ant.y };
  const progress = Math.min(1, Math.max(0, ant.entryProgress));
  const eased = progress * progress * (3 - 2 * progress);
  const sway = Math.sin(Math.PI * progress) * ((ant.id % 5) - 2) * 1.2;
  return {
    x: ant.x + (portal.mouth.x - ant.x) * eased + sway,
    y: ant.y + (portal.mouth.y - ant.y) * eased
  };
}

function groupAnts(ants, points, dpr) {
  const parents = ants.map((_, index) => index);
  function root(index) {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(points[i].x - points[j].x) <= ANT_FOOTPRINT_RADIUS * 2 &&
        Math.abs(points[i].y - points[j].y) <= ANT_FOOTPRINT_RADIUS * 2) {
        parents[root(j)] = root(i);
      }
    }
  }
  const groups = new Map();
  for (let index = 0; index < ants.length; index += 1) {
    const key = root(index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  }
  return [...groups.values()].map((members) => {
    const x = members.map((index) => points[index].x);
    const y = members.map((index) => points[index].y);
    const anchorX = Math.floor((Math.min(...x) - ANT_FOOTPRINT_RADIUS) * dpr) - 2;
    const anchorY = Math.floor((Math.min(...y) - ANT_FOOTPRINT_RADIUS) * dpr) - 2;
    return {
      members,
      anchorX,
      anchorY,
      width: Math.ceil((Math.max(...x) + ANT_FOOTPRINT_RADIUS) * dpr) + 2 - anchorX,
      height: Math.ceil((Math.max(...y) + ANT_FOOTPRINT_RADIUS) * dpr) + 2 - anchorY
    };
  });
}

function packAtlas(groups, size) {
  const pages = [];
  let page = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  const sorted = [...groups].sort((a, b) => b.height - a.height || b.width - a.width);
  for (const group of sorted) {
    if (group.width > size || group.height > size) return null;
    if (x + group.width > size) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    if (y + group.height > size) {
      pages.push(page);
      page = [];
      x = 0;
      y = 0;
      rowHeight = 0;
    }
    group.atlasX = x;
    group.atlasY = y;
    page.push(group);
    x += group.width;
    rowHeight = Math.max(rowHeight, group.height);
  }
  if (page.length) pages.push(page);
  return pages;
}

function splitOversizedGroup(group, points, dpr, size) {
  const margin = Math.ceil(ANT_FOOTPRINT_RADIUS * dpr) + 2;
  const interiorSize = size - margin * 2;
  if (interiorSize < 16) return null;
  const tiles = [];
  for (let y = group.anchorY; y < group.anchorY + group.height; y += interiorSize) {
    for (let x = group.anchorX; x < group.anchorX + group.width; x += interiorSize) {
      const copyWidth = Math.min(interiorSize, group.anchorX + group.width - x);
      const copyHeight = Math.min(interiorSize, group.anchorY + group.height - y);
      const members = group.members.filter((index) => {
        const px = points[index].x * dpr;
        const py = points[index].y * dpr;
        return px + margin >= x && px - margin <= x + copyWidth &&
          py + margin >= y && py - margin <= y + copyHeight;
      });
      if (!members.length) continue;
      tiles.push({
        members,
        anchorX: x - margin,
        anchorY: y - margin,
        copyX: margin,
        copyY: margin,
        copyWidth,
        copyHeight
      });
    }
  }
  return tiles;
}

export function createGroupedAntAtlasRenderer(canvas, options = {}) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('2D canvas is unavailable for ant atlas');
  const atlasCanvas = document.createElement('canvas');
  const atlasRenderer = createAntRenderer(atlasCanvas, options);
  let width = 1;
  let height = 1;
  let dpr = 1;
  let suspended = false;
  let lastStats = { drawCalls: 0, triangles: 0, iconClears: 0, atlasPages: 0, fallback: false };

  function resize(nextWidth, nextHeight, nextDpr) {
    width = Math.max(1, Number(nextWidth) || 1);
    height = Math.max(1, Number(nextHeight) || 1);
    dpr = Math.max(0.5, Math.min(Number(nextDpr) || 1, 2));
    const outputWidth = Math.max(1, Math.floor(width * dpr));
    const outputHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== outputWidth) canvas.width = outputWidth;
    if (canvas.height !== outputHeight) canvas.height = outputHeight;
    const requestedSize = Number(options.atlasSize);
    const atlasSize = Number.isFinite(requestedSize) && requestedSize > 0
      ? Math.max(128, Math.min(1024, requestedSize))
      : Math.min(640, Math.max(320, Math.min(width, height)));
    atlasRenderer.resize(atlasSize, atlasSize, dpr);
  }

  function transformAnt(ant, point, group) {
    const offsetX = (group.atlasX - group.anchorX) / dpr;
    const offsetY = (group.atlasY - group.anchorY) / dpr;
    const result = {
      ...ant,
      x: ant.x + offsetX,
      y: ant.y + offsetY,
      motionX: point.x,
      motionY: point.y
    };
    if (ant.mode === 'deposit' && group.portal) {
      result.renderPortal = { mouth: {
        x: group.portal.mouth.x + offsetX,
        y: group.portal.mouth.y + offsetY
      } };
    }
    return result;
  }

  function render(ants, obstacles, time, running, entryPortal) {
    if (suspended) return;
    if (!Array.isArray(ants) || !ants.length) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      atlasRenderer.render([], [], time, running, null);
      lastStats = { ...atlasRenderer.stats(), iconClears: 0, atlasPages: 0, fallback: false };
      return;
    }
    const points = ants.map((ant) => visualAntPoint(ant, entryPortal));
    const groups = groupAnts(ants, points, dpr);
    const size = atlasCanvas.width;
    const ordinary = groups.filter((group) => group.width <= size && group.height <= size);
    const oversized = groups.filter((group) => group.width > size || group.height > size);
    const pages = packAtlas(ordinary, size) || [];
    const tiles = oversized.flatMap((group) => splitOversizedGroup(group, points, dpr, size) || []);
    context.clearRect(0, 0, canvas.width, canvas.height);
    let drawCalls = 0;
    let triangles = 0;
    for (const page of pages) {
      const transformed = page.flatMap((group) => {
        group.portal = entryPortal;
        return group.members.map((index) => transformAnt(ants[index], points[index], group));
      });
      atlasRenderer.render(transformed, [], time, running, null, true);
      const stats = atlasRenderer.stats();
      drawCalls += stats.drawCalls;
      triangles += stats.triangles;
      for (const group of page) {
        context.drawImage(atlasCanvas,
          group.atlasX, group.atlasY, group.width, group.height,
          group.anchorX, group.anchorY, group.width, group.height);
      }
    }
    for (const tile of tiles) {
      tile.atlasX = 0;
      tile.atlasY = 0;
      tile.portal = entryPortal;
      atlasRenderer.render(tile.members.map((index) =>
        transformAnt(ants[index], points[index], tile)), [], time, running, null, true);
      const stats = atlasRenderer.stats();
      drawCalls += stats.drawCalls;
      triangles += stats.triangles;
      context.drawImage(atlasCanvas,
        tile.copyX, tile.copyY, tile.copyWidth, tile.copyHeight,
        tile.anchorX + tile.copyX, tile.anchorY + tile.copyY,
        tile.copyWidth, tile.copyHeight);
    }
    atlasRenderer.pruneModels(new Set(ants.map((ant) => ant.id)));
    let iconClears = 0;
    for (const { x, y, w, h } of obstacles || []) {
      if (!points.some((point) => point.x + ANT_FOOTPRINT_RADIUS >= x &&
        point.x - ANT_FOOTPRINT_RADIUS <= x + w &&
        point.y + ANT_FOOTPRINT_RADIUS >= y &&
        point.y - ANT_FOOTPRINT_RADIUS <= y + h)) continue;
      context.clearRect(x * dpr, y * dpr, w * dpr, h * dpr);
      iconClears += 1;
    }
    lastStats = { drawCalls, triangles, iconClears, atlasPages: pages.length,
      atlasTiles: tiles.length, atlasPixels: atlasCanvas.width * atlasCanvas.height,
      fallback: false };
  }

  function setVisible(visible) {
    suspended = !visible;
    atlasRenderer.setVisible(visible);
    const outputWidth = visible ? Math.max(1, Math.floor(width * dpr)) : 1;
    const outputHeight = visible ? Math.max(1, Math.floor(height * dpr)) : 1;
    if (canvas.width !== outputWidth) canvas.width = outputWidth;
    if (canvas.height !== outputHeight) canvas.height = outputHeight;
  }

  function dispose() {
    atlasRenderer.dispose();
  }

  return { resize, render, setVisible, stats: () => ({ ...lastStats }), dispose };
}

window.createAntRenderer = createAntRenderer;
window.createGroupedAntAtlasRenderer = createGroupedAntAtlasRenderer;
