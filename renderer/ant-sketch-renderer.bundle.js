var AntSketchRenderer = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // renderer/ant-sketch-renderer.js
  var ant_sketch_renderer_exports = {};
  __export(ant_sketch_renderer_exports, {
    createSketchAntRenderer: () => createSketchAntRenderer,
    drawMantouIcon: () => drawMantouIcon,
    drawPortalContact: () => drawPortalContact,
    drawPortalIcon: () => drawPortalIcon,
    drawSpaceSnack: () => drawSpaceSnack,
    portalPose: () => portalPose
  });

  // renderer/portal-art.js
  var TAU = Math.PI * 2;
  var clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  function portalPose(ant, portal) {
    const entering = ant.mode === "deposit" && Boolean(portal?.mouth);
    const emerging = !entering && portal?.mouth && Number.isFinite(ant.departureProgress) && ant.departureProgress < 1;
    if (!entering && !emerging) return { x: ant.x, y: ant.y, scale: 1, alpha: 1, active: false };
    const progress = clamp(entering ? ant.entryProgress : ant.departureProgress);
    const eased = progress * progress * (3 - 2 * progress);
    const amount = entering ? eased : 1 - eased;
    const sway = Math.sin(Math.PI * progress) * (ant.id % 5 - 2) * 0.55;
    return {
      x: ant.x + (portal.mouth.x - ant.x) * amount + sway,
      y: ant.y + (portal.mouth.y - ant.y) * amount,
      scale: 1 - amount * 0.78,
      alpha: entering ? 1 - Math.pow(progress, 1.6) : Math.sin(progress * Math.PI / 2),
      active: true,
      entering,
      progress
    };
  }
  function drawPortalIcon(context, rect, time, backdrop) {
    const { x, y, w, h } = rect;
    context.save();
    context.beginPath();
    context.rect(x, y, w, h);
    context.clip();
    if (backdrop) context.drawImage(backdrop, x, y, w, h);
    else {
      context.fillStyle = "#203026";
      context.fillRect(x, y, w, h);
    }
    context.translate(x + w / 2, y + h / 2);
    const rx = w * 0.44, ry = h * 0.47, phase = time * 14e-4;
    context.lineJoin = "round";
    context.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * TAU;
      const r = 1 + Math.sin(a * 7 + phase * 2) * 0.035 + Math.sin(a * 11 - phase) * 0.018;
      const px = Math.cos(a) * rx * r, py = Math.sin(a) * ry * r;
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fillStyle = "#a7ef26";
    context.strokeStyle = "#172718";
    context.lineWidth = 2.2;
    context.fill();
    context.stroke();
    context.save();
    context.clip();
    context.beginPath();
    context.ellipse(0, 0, rx * 0.84, ry * 0.88, 0, 0, TAU);
    context.fillStyle = "#3c9b25";
    context.fill();
    for (let band = 0; band < 3; band++) {
      context.beginPath();
      for (let i = 0; i <= 84; i++) {
        const t = i / 84, a = phase + band * TAU / 3 + t * TAU * 1.55;
        const r = (0.08 + t * 0.85) * (1 + Math.sin(a * 3 - phase) * 0.06);
        const px = Math.cos(a) * rx * r, py = Math.sin(a) * ry * r;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.strokeStyle = band === 0 ? "#e2ff79" : band === 1 ? "#8cda29" : "#174d25";
      context.lineWidth = Math.max(1.5, w * 0.055);
      context.lineCap = "round";
      context.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996 - phase * 0.45, r = 0.55 + i % 3 * 0.12;
      context.beginPath();
      context.ellipse(
        Math.cos(a) * rx * r,
        Math.sin(a) * ry * r,
        1 + i % 2 * 0.5,
        0.7 + i % 3 * 0.3,
        a,
        0,
        TAU
      );
      context.fillStyle = i % 2 ? "#d9ff61" : "#266d20";
      context.fill();
    }
    for (let ring = 0; ring < 4; ring++) {
      const wave = (time * 32e-5 + ring / 4) % 1;
      const r = 0.13 + 0.86 * wave;
      context.globalAlpha = Math.sin(Math.PI * wave) * 0.65;
      context.beginPath();
      context.ellipse(
        Math.sin(phase) * rx * 0.035,
        Math.cos(phase * 0.8) * ry * 0.025,
        rx * r,
        ry * r * (0.94 + Math.sin(phase + ring) * 0.035),
        0,
        0,
        TAU
      );
      context.strokeStyle = ring % 2 ? "#edffb4" : "#baff38";
      context.lineWidth = (1 - wave) * 1.6 + 0.45;
      context.stroke();
    }
    context.restore();
    context.restore();
  }
  function drawPortalContact(context, pose, portal, id) {
    if (!pose.active || !portal?.mouth) return;
    const envelope = Math.sin(pose.progress * Math.PI);
    if (envelope < 0.03) return;
    const cx = portal.mouth.x, cy = portal.mouth.y;
    const dx = pose.x - cx, dy = pose.y - cy, len = Math.hypot(dx, dy);
    const nx = len > 0.1 ? -dy / len : 1, ny = len > 0.1 ? dx / len : 0;
    context.save();
    context.globalAlpha = envelope * 0.72;
    if (len > 3) {
      const base = 4.2, tip = Math.max(0.5, 2.5 - len * 0.035);
      context.beginPath();
      context.moveTo(cx + nx * base, cy + ny * base);
      context.bezierCurveTo(
        cx + dx * 0.55 + nx * 0.7,
        cy + dy * 0.55 + ny * 0.7,
        pose.x + nx * tip,
        pose.y + ny * tip,
        pose.x,
        pose.y
      );
      context.bezierCurveTo(
        pose.x - nx * tip,
        pose.y - ny * tip,
        cx + dx * 0.55 - nx * 0.7,
        cy + dy * 0.55 - ny * 0.7,
        cx - nx * base,
        cy - ny * base
      );
      context.closePath();
      context.fillStyle = "#aaff43";
      context.fill();
      context.strokeStyle = "#e5ffa0";
      context.lineWidth = 0.6;
      context.stroke();
    }
    for (let ring = 0; ring < 2; ring++) {
      const wave = (pose.progress * 1.7 + ring * 0.45) % 1;
      context.globalAlpha = envelope * (1 - wave) * 0.85;
      context.beginPath();
      context.ellipse(
        cx,
        cy,
        3 + wave * 15,
        2 + wave * 12,
        id % 3 * 0.2,
        0,
        TAU
      );
      context.strokeStyle = ring ? "#efffa5" : "#b8ff42";
      context.lineWidth = 1.2 * (1 - wave) + 0.3;
      context.stroke();
    }
    context.restore();
  }

  // renderer/ant-sketch-renderer.js
  var SKETCH_CELL = 38;
  var SKETCH_PHASES = 8;
  var SKETCH_ROWS = 9;
  var SKETCH_FOOTPRINT_RADIUS = 18;
  var SKETCH_TAU = Math.PI * 2;
  function sketchClamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function sketchEllipse(context, x, y, rx, ry, fill, stroke, lineWidth = 1) {
    context.beginPath();
    context.ellipse(x, y, rx, ry, 0, 0, SKETCH_TAU);
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth;
      context.stroke();
    }
  }
  function sketchStroke(context, points, color, width) {
    context.beginPath();
    context.moveTo(points[0], points[1]);
    context.quadraticCurveTo(points[2], points[3], points[4], points[5]);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke();
  }
  function drawSpaceSnack(context, x, y, size = 48, time = 0) {
    context.save();
    context.translate(x, y);
    context.scale(size / 48, size / 48);
    context.lineJoin = "round";
    context.lineCap = "round";
    sketchEllipse(context, 0, 12, 19, 4, "rgba(9,20,16,.2)");
    sketchEllipse(context, 0, 6, 19, 10, "#cf8845", "#1c2820", 2.4);
    context.beginPath();
    context.moveTo(-19, 0);
    context.bezierCurveTo(-14, -5, 13, -5, 19, 0);
    context.lineTo(17, 8);
    context.quadraticCurveTo(13, 5, 9, 9);
    context.quadraticCurveTo(5, 14, 3, 8);
    context.quadraticCurveTo(-8, 11, -17, 6);
    context.closePath();
    context.fillStyle = "#b9f64b";
    context.fill();
    context.strokeStyle = "#253522";
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.moveTo(-19, 0);
    context.bezierCurveTo(-20, -10, -11, -18, 0, -17);
    context.bezierCurveTo(10, -19, 20, -10, 19, 0);
    context.bezierCurveTo(12, 6, -12, 6, -19, 0);
    context.closePath();
    context.fillStyle = "#e9b468";
    context.fill();
    context.strokeStyle = "#20271e";
    context.lineWidth = 2.4;
    context.stroke();
    sketchStroke(context, [-15, -6, -10, -16, 0, -14], "#ffe5a4", 2.8);
    context.beginPath();
    for (let i = 0; i <= 28; i++) {
      const t = i / 28, a = t * Math.PI * 3.6, r = 1 + t * 8;
      const px = Math.cos(a) * r, py = -6 + Math.sin(a) * r * 0.52;
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.strokeStyle = "#805638";
    context.lineWidth = 1.7;
    context.stroke();
    sketchStroke(context, [10, -11, 12, -12, 13, -11], "#df76b7", 2.2);
    sketchEllipse(context, -9, -3, 1.5, 0.8, "#fff2b9");
    context.restore();
  }
  function drawSketchAnt(context, phase, row) {
    const sniffing = row === 3 || row === 7;
    const cutting = row === 4;
    const attentive = row === 5;
    const resting = row === 6;
    const carrying = row === 1 || row === 2 || row === 8;
    const stationary = row === 3 || cutting || attentive || resting;
    context.lineCap = "round";
    context.lineJoin = "round";
    const cycle = phase / SKETCH_PHASES * SKETCH_TAU;
    sketchEllipse(context, -0.4, 3.1, 11.6, 4.3, "rgba(9, 16, 14, .18)");
    const hips = [-4.4, -1, 2.2];
    const feet = [-9.2, -3.3, 8.1];
    for (const side of [-1, 1]) {
      for (let leg = 0; leg < 3; leg += 1) {
        if (carrying && leg === 2) continue;
        const tripod = (leg + (side === 1 ? 1 : 0)) % 2;
        const swing = stationary ? 0 : Math.sin(cycle + tripod * Math.PI);
        const hipX = hips[leg];
        const footX = feet[leg] + swing * 1.1;
        const footY = side * ([7.5, 8.4, 7.7][leg] - Math.max(0, swing) * 0.45);
        const path = [
          hipX,
          side * 1.55,
          hipX + (footX - hipX) * 0.58,
          side * 5.9,
          footX,
          footY
        ];
        sketchStroke(context, path, "#111714", 2.45);
        sketchStroke(context, path, "#66997b", 0.65);
      }
    }
    for (const [x, y, rx, ry] of [[-7.5, 0, 4.8, 3.9], [-1.35, 0, 2.4, 2.4]]) {
      sketchEllipse(context, x, y, rx, ry, "#537f69", "#101d18", 1.8);
    }
    sketchStroke(context, [-10, -1, -8, -3, -6, -2.5], "#99bd83", 0.8);
    const headTurn = sniffing ? Math.sin(cycle) * 0.14 : attentive ? Math.sin(cycle) * 0.055 : resting ? Math.sin(cycle) * 0.035 : 0;
    const bite = cutting ? Math.pow(Math.max(0, Math.sin(cycle)), 2) : 0;
    context.save();
    context.translate(1 + (cutting ? bite * 0.75 : 0), carrying ? Math.sin(cycle) * 0.3 : 0);
    context.rotate(headTurn);
    context.translate(-1, 0);
    sketchEllipse(context, 5.8, 0, 6.7, 6, "#89b28c", "#101d18", 1.9);
    sketchEllipse(context, 5.8, -2.1, 3.25, 3.1, "#f8f7df", "#16201a", 0.95);
    sketchEllipse(context, 10, 1.1, 2.5, 2.7, "#f8f7df", "#16201a", 0.9);
    sketchEllipse(context, 6.7, -1.85, 0.95, 1.1, "#111b16");
    sketchEllipse(context, 10.8, 1.2, 0.8, 0.95, "#111b16");
    sketchEllipse(context, 6.9, -2.2, 0.3, 0.3, "#ffffff");
    if (!attentive) sketchStroke(context, [2.8, -3.4, 5.4, -4.5, 8.7, -3.2], "#52775d", 0.95);
    sketchEllipse(context, 4, 3.2, 1.3, 0.6, "#dba08b");
    sketchStroke(context, [8.4, 4.3, 10, 5.1, 11.7, 3.7], "#142019", 0.9);
    sketchStroke(context, [2.4, 2.3, 3.5, 3.1, 4, 2.9], "#385f49", 0.7);
    for (const side of [-1, 1]) {
      const wiggle = sniffing ? Math.sin(cycle + side * Math.PI / 2) * 1.9 : Math.sin(cycle + side) * (cutting ? 0.25 : 0.55);
      const reach = (side < 0 ? 15.5 : 13.7) - (carrying ? 2 : 0) + (attentive ? 0.5 : 0);
      const tipY = side < 0 ? -8.8 + wiggle : 7.6 + wiggle;
      const path = [
        9.7,
        side * 4.1,
        11.8,
        side * 7 + wiggle * 0.5,
        reach,
        tipY
      ];
      sketchStroke(context, path, "#111714", 2);
      sketchStroke(context, path, "#a4c68e", 0.65);
    }
    if (carrying) {
      sketchStroke(context, [1, -2, 2, -9, 6, -10], "#111b16", 2.2);
      sketchStroke(context, [2, 3, 13, 5, 14, -8], "#111b16", 2.2);
      sketchStroke(context, [1, -2, 2, -9, 6, -10], "#9bbf86", 0.65);
      sketchStroke(context, [2, 3, 13, 5, 14, -8], "#9bbf86", 0.65);
      if (row !== 8) drawSpaceSnack(context, 10, -11.2 + Math.sin(cycle) * 0.35, row === 2 ? 12 : 10);
    } else if (cutting) {
      const open = 0.55 + (1 - bite) * 2.2;
      drawSpaceSnack(context, 15, 0, 7);
      for (const side of [-1, 1]) {
        sketchStroke(context, [
          9,
          side * 1.4,
          12,
          side * (1.4 + open),
          14.9,
          side * 0.65
        ], "#121816", 1.4);
      }
      if (phase >= 2 && phase <= 6) {
        sketchEllipse(context, 17.8, 3.3 - phase * 0.25, 0.6, 0.5, "#d9954c");
        sketchEllipse(context, 17.2, -3.7 + phase * 0.2, 0.5, 0.45, "#f2c67b");
      }
    }
    context.restore();
  }
  function buildSketchAtlas(dpr) {
    const cellPixels = Math.ceil(SKETCH_CELL * dpr);
    const canvas = document.createElement("canvas");
    canvas.width = cellPixels * SKETCH_PHASES;
    canvas.height = cellPixels * SKETCH_ROWS;
    const context = canvas.getContext("2d", { alpha: true });
    for (let row = 0; row < SKETCH_ROWS; row += 1) {
      for (let phase = 0; phase < SKETCH_PHASES; phase += 1) {
        context.save();
        context.translate(
          phase * cellPixels + cellPixels / 2,
          row * cellPixels + cellPixels / 2
        );
        context.scale(dpr, dpr);
        drawSketchAnt(context, phase, row);
        context.restore();
      }
    }
    return { canvas, cellPixels };
  }
  function sketchAngleDifference(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
  }
  function drawGuestOutfit(context, costume, phase, time) {
    if (!costume) return;
    if (costume === 1) {
      sketchEllipse(context, -1, 0, 3.1, 3.3, "#e5eee4", "#17291e", 0.9);
      sketchStroke(context, [-3, -2, -1, 0, -3, 2], "#56c6c3", 1);
      for (const [x, y, r] of [[5.8, -2.1, 3.2], [10, 1.1, 2.65]]) {
        context.beginPath();
        context.ellipse(x, y, r, r, 0, 0, SKETCH_TAU);
        context.strokeStyle = "#303d45";
        context.lineWidth = 1.15;
        context.stroke();
        sketchStroke(context, [x - 1.7, y - 0.5, x - 1, y - 1.5, x + 0.2, y - 1.7], "#93e8ec", 0.8);
      }
    } else {
      const flutter = Math.sin(phase / SKETCH_PHASES * SKETCH_TAU) * 1.3;
      context.beginPath();
      context.moveTo(0, -2.6);
      context.lineTo(-11, -6.4 + flutter);
      context.lineTo(-9, -1.3);
      context.lineTo(-12, 2.5 + flutter);
      context.lineTo(-1, 2.8);
      context.closePath();
      context.fillStyle = "#ab86d6";
      context.fill();
      context.strokeStyle = "#253027";
      context.lineWidth = 1;
      context.stroke();
      sketchEllipse(context, 0, 0, 1.2, 1.2, "#e9cc70", "#293528", 0.65);
      sketchStroke(context, [-5, -2, -7, -3, -8, -2], "#ddc4f5", 0.75);
    }
  }
  function drawMantouIcon(context, rect, time = 0, backdrop = "#242725", portion = 1) {
    const x = Number(rect.x ?? rect.left);
    const y = Number(rect.y ?? rect.top);
    const width = Number(rect.w ?? rect.width ?? rect.right - x);
    const height = Number(rect.h ?? rect.height ?? rect.bottom - y);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    context.save();
    if (backdrop && typeof backdrop !== "string" && (Number(backdrop.width) > 0 || Number(backdrop.naturalWidth) > 0)) {
      context.drawImage(backdrop, x, y, width, height);
    } else {
      context.fillStyle = typeof backdrop === "string" ? backdrop : "#242725";
      context.fillRect(x, y, width, height);
    }
    context.translate(x, y);
    context.scale(width / 48, height / 48);
    const remaining = sketchClamp(Number(portion) || 1, 0.25, 1);
    const cutX = 8 + 34 * remaining;
    if (remaining < 0.999) {
      context.save();
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(cutX, 0);
      context.lineTo(cutX, 14);
      for (let index = 0; index < 5; index += 1) {
        const y2 = 14 + index * 6.5;
        context.quadraticCurveTo(cutX - 2.2, y2 + 3.2, cutX, y2 + 6.5);
      }
      context.lineTo(cutX, 48);
      context.lineTo(0, 48);
      context.closePath();
      context.clip();
    }
    const lift = Math.sin(Number(time) * 3e-3) * 0.55;
    drawSpaceSnack(context, 24, 25 + lift, 48, time);
    if (remaining < 0.999) {
      context.restore();
      context.strokeStyle = "rgba(255, 239, 205, .86)";
      context.lineWidth = 1.25;
      context.beginPath();
      context.moveTo(cutX, 15 + lift);
      for (let index = 0; index < 5; index += 1) {
        const y2 = 15 + index * 6.3 + lift;
        context.quadraticCurveTo(cutX - 2.1, y2 + 3.1, cutX, y2 + 6.2);
      }
      context.stroke();
      for (const [dx, dy, radius] of [[2.3, 11, 0.7], [3.4, 34, 0.55]]) {
        context.fillStyle = "rgba(250, 214, 158, .9)";
        context.beginPath();
        context.arc(cutX + dx, dy + lift, radius, 0, SKETCH_TAU);
        context.fill();
      }
    }
    context.restore();
  }
  function createSketchAntRenderer(canvas) {
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) throw new Error("2D canvas is unavailable for sketch ants");
    const atlases = /* @__PURE__ */ new Map();
    const actors = /* @__PURE__ */ new Map();
    let width = 1;
    let height = 1;
    let dpr = 1;
    let suspended = false;
    let lastTime = null;
    let frame = 0;
    let atlasBuilds = 0;
    let drawCalls = 0;
    let iconClears = 0;
    let performanceTime = 0;
    let greetings = 0;
    let previousBounds = [];
    function atlasFor(scale) {
      let atlas = atlases.get(scale);
      if (!atlas) {
        atlas = buildSketchAtlas(scale);
        atlases.set(scale, atlas);
        atlasBuilds += 1;
      }
      return atlas;
    }
    function resize(nextWidth, nextHeight, nextDpr) {
      const previousDpr = dpr;
      width = Math.max(1, Number(nextWidth) || 1);
      height = Math.max(1, Number(nextHeight) || 1);
      dpr = sketchClamp(Number(nextDpr) || 1, 1, 2);
      if (suspended) return;
      const pixelsWide = Math.max(1, Math.round(width * dpr));
      const pixelsHigh = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh || previousDpr !== dpr) {
        canvas.width = pixelsWide;
        canvas.height = pixelsHigh;
        previousBounds = [];
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      atlasFor(dpr);
    }
    function render(ants, obstacles, time, running, entryPortal) {
      if (suspended) return;
      const current = Number(time) || 0;
      const dt = lastTime === null ? 1 / 60 : sketchClamp((current - lastTime) / 1e3, 1 / 240, 0.1);
      lastTime = current;
      if (running) performanceTime += dt;
      frame += 1;
      drawCalls = 0;
      iconClears = 0;
      for (const r of previousBounds) context.clearRect(r.x, r.y, r.w, r.h);
      previousBounds = [];
      const atlas = atlasFor(dpr);
      const points = [];
      const neighbourhood = /* @__PURE__ */ new Map();
      for (const ant of ants || []) {
        if (!actors.has(ant.id)) actors.set(ant.id, {
          motionX: ant.motionX ?? ant.x,
          motionY: ant.motionY ?? ant.y,
          angle: ant.angle,
          gait: Math.abs(ant.id * 7) % SKETCH_PHASES,
          carrying: Boolean(ant.carrying),
          liftAt: -Infinity,
          greetingUntil: 0,
          greetingReadyAt: 0,
          costume: ant.id === 0 ? 1 : ant.id === 1 ? 2 : 0
        });
        const key = `${Math.floor(ant.x / 32)},${Math.floor(ant.y / 32)}`;
        if (!neighbourhood.has(key)) neighbourhood.set(key, []);
        neighbourhood.get(key).push(ant);
      }
      if (running) for (const ant of ants || []) {
        const actor = actors.get(ant.id);
        if (ant.action || ant.carrying || ant.mode === "deposit" || performanceTime < actor.greetingReadyAt) continue;
        const gx = Math.floor(ant.x / 32), gy = Math.floor(ant.y / 32);
        let greeted = false;
        for (let dy = -1; dy <= 1 && !greeted; dy += 1) {
          for (let dx = -1; dx <= 1 && !greeted; dx += 1) {
            for (const other of neighbourhood.get(`${gx + dx},${gy + dy}`) || []) {
              const partner = actors.get(other.id);
              if (other.id <= ant.id || (ant.id + other.id) % 3 || other.action || other.carrying || other.mode === "deposit" || performanceTime < partner.greetingReadyAt || Math.cos(ant.angle - other.angle) > -0.3 || Math.hypot(ant.x - other.x, ant.y - other.y) > 23) continue;
              actor.greetingUntil = partner.greetingUntil = performanceTime + 0.38;
              actor.greetingReadyAt = partner.greetingReadyAt = performanceTime + 7;
              greetings += 1;
              greeted = true;
              break;
            }
          }
        }
      }
      for (const ant of ants || []) {
        const portal = ant.renderPortal || entryPortal;
        const pose = portalPose(ant, portal);
        const entering = pose.entering;
        const { x, y } = pose;
        const left = Math.floor((Math.min(x - 29, pose.active ? portal.mouth.x - 19 : x - 29) - 1) * dpr) / dpr;
        const top = Math.floor((Math.min(y - 29, pose.active ? portal.mouth.y - 19 : y - 29) - 1) * dpr) / dpr;
        const right = Math.ceil((Math.max(x + 29, pose.active ? portal.mouth.x + 19 : x + 29) + 1) * dpr) / dpr;
        const bottom = Math.ceil((Math.max(y + 29, pose.active ? portal.mouth.y + 19 : y + 29) + 1) * dpr) / dpr;
        previousBounds.push({ x: left, y: top, w: right - left, h: bottom - top });
        const actionProgress = sketchClamp(Number(ant.actionProgress) || 0, 0, 1);
        const actor = actors.get(ant.id);
        actor.frame = frame;
        if (pose.active && !pose.entering && pose.progress < 0.12 && ant.id < 2) {
          actor.costume = Math.floor(performanceTime / 60) % 3 === 2 ? 0 : ant.id + 1;
        }
        const motionX = ant.motionX ?? ant.x;
        const motionY = ant.motionY ?? ant.y;
        const moved = Math.hypot(motionX - actor.motionX, motionY - actor.motionY);
        if (running && moved < 35) actor.gait = (actor.gait + moved / (ant.carrying ? 1.6 : 1.9)) % SKETCH_PHASES;
        if (ant.carrying && !actor.carrying) actor.liftAt = performanceTime;
        actor.carrying = Boolean(ant.carrying);
        actor.motionX = motionX;
        actor.motionY = motionY;
        let target = entering ? Math.atan2(portal.mouth.y - ant.y, portal.mouth.x - ant.x) : ant.angle;
        if (Number.isFinite(ant.actionFacing) && ant.action && actionProgress > 0.18) {
          const orient = sketchClamp((actionProgress - 0.18) / 0.65, 0, 1);
          target += sketchAngleDifference(target, ant.actionFacing) * orient;
        } else if (["reorient", "recover"].includes(ant.action)) {
          target += Math.sin(actionProgress * SKETCH_TAU) * Math.sin(actionProgress * Math.PI) * (ant.action === "recover" ? 0.65 : 0.32);
        }
        const turnSpeed = ant.carrying ? 9 : 14;
        if (running) actor.angle += sketchClamp(sketchAngleDifference(actor.angle, target), -dt * turnSpeed, dt * turnSpeed);
        const actionRow = ["sniff", "survey", "reorient", "recover"].includes(ant.action) ? 3 : ["sense", "alert"].includes(ant.action) ? 5 : ant.action === "cutting" ? 4 : -1;
        let actionPhase = actionProgress;
        if (ant.action === "cutting") {
          actionPhase = actionProgress < 0.15 ? 0 : actionProgress > 0.85 ? 0.5 : (actionProgress - 0.15) / 0.7 * 3 % 1;
        }
        let phase = actionRow >= 0 ? Math.min(SKETCH_PHASES - 1, Math.floor(actionPhase * SKETCH_PHASES)) : Math.floor(actor.gait) % SKETCH_PHASES;
        const greeting = !ant.action && !ant.carrying && actor.greetingUntil > performanceTime;
        if (greeting) phase = Math.floor((1 - (actor.greetingUntil - performanceTime) / 0.38) * SKETCH_PHASES) % SKETCH_PHASES;
        const row = entering ? ant.carrying ? 8 : 0 : actionRow >= 0 ? actionRow : ant.carrying ? ant.payloadKind === "file" ? 2 : 1 : greeting ? 7 : moved < 0.01 ? 6 : 0;
        const size = SKETCH_CELL;
        context.save();
        context.translate(x, y);
        context.rotate(actor.angle);
        if (running && !ant.action && moved > 0.01 && moved < 35 && !entering) {
          const stride = actor.gait / SKETCH_PHASES * SKETCH_TAU;
          context.rotate(Math.sin(stride) * (ant.carrying ? 0.035 : 0.018));
          context.scale(1, 1 - Math.abs(Math.sin(stride)) * (ant.carrying ? 0.045 : 0.018));
        }
        if (ant.carrying && !entering) {
          const lift = sketchClamp((performanceTime - actor.liftAt) / 0.35, 0, 1);
          context.scale(1 + Math.sin(lift * Math.PI) * 0.035, 1 - Math.sin(lift * Math.PI) * 0.055);
        }
        if (pose.active) {
          const stretch = Math.sin(pose.progress * Math.PI) * 0.12;
          context.scale(pose.scale * (1 + stretch), pose.scale * (1 - stretch));
          context.globalAlpha = pose.alpha;
        }
        context.drawImage(
          atlas.canvas,
          phase * atlas.cellPixels,
          row * atlas.cellPixels,
          atlas.cellPixels,
          atlas.cellPixels,
          -size / 2,
          -size / 2,
          size,
          size
        );
        drawGuestOutfit(context, actor.costume, actor.gait, performanceTime);
        const blink = (performanceTime + ant.id * 1.73) % 5.8;
        if (blink < 0.12 && !ant.action && !entering) {
          sketchStroke(context, [3, -2, 6, -0.5, 8.4, -2], "#668b6a", 2.8);
          sketchStroke(context, [8.1, 1.2, 10, 2.3, 11.8, 1.2], "#668b6a", 2.4);
        }
        if (pose.active && !entering && pose.progress > 0.65) {
          const flick = Math.sin((pose.progress - 0.65) / 0.35 * Math.PI);
          for (let i = 0; i < 2; i++) {
            sketchEllipse(context, -7 - i * 3, -6 - flick * (3 + i * 2), 0.7, 0.9, "#beef59");
          }
        }
        context.restore();
        drawPortalContact(context, pose, portal, ant.id);
        drawCalls += 1;
        points.push({ x, y });
      }
      for (const [id, actor] of actors) {
        if (actor.frame !== frame) actors.delete(id);
      }
      for (const obstacle of obstacles || []) {
        if (obstacle.isRecycleBin && entryPortal?.rect) continue;
        const { x, y, w, h } = obstacle;
        if (x >= width || y >= height || x + w <= 0 || y + h <= 0) continue;
        if (!points.some((point) => point.x + SKETCH_FOOTPRINT_RADIUS >= x && point.x - SKETCH_FOOTPRINT_RADIUS <= x + w && point.y + SKETCH_FOOTPRINT_RADIUS >= y && point.y - SKETCH_FOOTPRINT_RADIUS <= y + h)) continue;
        context.clearRect(x, y, w, h);
        iconClears += 1;
      }
    }
    function setVisible(visible) {
      if (!visible && !suspended) {
        suspended = true;
        canvas.width = 1;
        canvas.height = 1;
        previousBounds = [];
      } else if (visible && suspended) {
        suspended = false;
        resize(width, height, dpr);
        lastTime = null;
        actors.clear();
      }
    }
    function dispose() {
      actors.clear();
      atlases.clear();
      previousBounds = [];
    }
    return {
      resize,
      render,
      setVisible,
      dispose,
      stats: () => ({
        drawCalls,
        iconClears,
        spriteCount: drawCalls,
        greetings,
        atlasBuilds,
        atlasBytes: [...atlases.values()].reduce((total, atlas) => total + atlas.canvas.width * atlas.canvas.height * 4, 0),
        canvasPixels: canvas.width * canvas.height
      })
    };
  }
  window.createSketchAntRenderer = createSketchAntRenderer;
  window.drawMantouIcon = drawMantouIcon;
  return __toCommonJS(ant_sketch_renderer_exports);
})();
