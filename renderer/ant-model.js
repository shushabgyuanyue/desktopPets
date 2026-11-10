import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const SIDES = [-1, 1];
const HIP_X = [1.28, -0.28, -1.72];
const FOOT_X = [5.0, -0.05, -5.0];
const LEG_SIDES = 6;
const LEG_SEGMENTS = 18;
const RING_VERTICES = LEG_SIDES * 2;
const RING_COS = Array.from({ length: LEG_SIDES }, (_, side) => Math.cos(side / LEG_SIDES * TAU));
const RING_SIN = Array.from({ length: LEG_SIDES }, (_, side) => Math.sin(side / LEG_SIDES * TAU));
const BODY_GEOMETRY = new THREE.SphereGeometry(1, 16, 12);
const SMALL_GEOMETRY = new THREE.SphereGeometry(1, 10, 8);
const SHADOW_GEOMETRY = new THREE.PlaneGeometry(22, 17);
const CRUMB_GEOMETRY = new THREE.IcosahedronGeometry(1, 1);

function mergedEllipsoids(specs, extra = []) {
  const pieces = specs.map(([x, y, z, sx, sy, sz]) => {
    const geometry = BODY_GEOMETRY.clone();
    geometry.scale(sx, sy, sz);
    geometry.translate(x, y, z);
    return geometry;
  });
  pieces.push(...extra);
  const merged = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  if (!merged) throw new Error('Could not merge ant geometry');
  return merged;
}

const GASTER_DORSAL_GEOMETRY = mergedEllipsoids([
  [-1.3, 0, 1.42, 1.5, 0.96, 0.27],
  [1.3, 0, 1.42, 0.75, 0.82, 0.24]
]);
const BODY_SHELL_GEOMETRY = mergedEllipsoids([
  [-3.25, 0, 2.9, 0.76, 0.82, 0.72],
  [-0.85, 0, 2.83, 1.65, 1.31, 1.04],
  [0.9, 0, 2.86, 1.62, 1.48, 1.22],
  [6.78, 0, 2.45, 0.87, 1.49, 0.75]
]);
const BODY_JOINT_GEOMETRY = mergedEllipsoids([
  [-2.55, 0, 2.8, 0.52, 0.56, 0.48],
  [2.12, 0, 2.8, 0.73, 0.76, 0.55]
]);
const BODY_DORSAL_GEOMETRY = mergedEllipsoids([
  [0.25, 0, 3.99, 1.5, 0.62, 0.16],
  [4.55, 0, 4.22, 1.5, 0.83, 0.16]
]);
const BODY_COLORS = [0x2d3032, 0x303334, 0x2a2f31, 0x333332];
const BODY_MATERIALS = BODY_COLORS.map((color) => new THREE.MeshPhysicalMaterial({
  color,
  roughness: 0.29,
  metalness: 0.04,
  clearcoat: 0.66,
  clearcoatRoughness: 0.19
}));
const DORSAL_MATERIALS = BODY_COLORS.map((color) => new THREE.MeshStandardMaterial({
  color: new THREE.Color(color).multiplyScalar(2.8),
  roughness: 0.37,
  metalness: 0.04
}));
const LEG_COLORS = [0x596367, 0x5b6467, 0x566063, 0x606666];
const LEG_MATERIALS = LEG_COLORS.map((color) => new THREE.MeshStandardMaterial({
  color,
  roughness: 0.42,
  metalness: 0.02
}));
const JOINT_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x303638, roughness: 0.48 });
const EYE_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x090c0c,
  roughness: 0.1,
  metalness: 0.1,
  clearcoat: 0.8
});
const FOOD_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd9a459,
  roughness: 0.78,
  flatShading: true
});
const FILE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xcbd5da, side: THREE.DoubleSide });
const FILE_FOLD_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xe6edf0, side: THREE.DoubleSide });
const FILE_LINE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x5c91b4, side: THREE.DoubleSide });
const FILE_EDGE_MATERIAL = new THREE.LineBasicMaterial({ color: 0x4b5961, transparent: true, opacity: 0.8 });
const FILE_SHAPE = new THREE.Shape();
FILE_SHAPE.moveTo(-1.02, -0.82);
FILE_SHAPE.lineTo(1.02, -0.82);
FILE_SHAPE.lineTo(1.02, 0.36);
FILE_SHAPE.lineTo(0.55, 0.82);
FILE_SHAPE.lineTo(-1.02, 0.82);
FILE_SHAPE.closePath();
const FILE_GEOMETRY = new THREE.ShapeGeometry(FILE_SHAPE);
const FILE_FOLD_SHAPE = new THREE.Shape();
FILE_FOLD_SHAPE.moveTo(0.55, 0.82);
FILE_FOLD_SHAPE.lineTo(0.55, 0.36);
FILE_FOLD_SHAPE.lineTo(1.02, 0.36);
FILE_FOLD_SHAPE.closePath();
const FILE_FOLD_GEOMETRY = new THREE.ShapeGeometry(FILE_FOLD_SHAPE);
const FILE_LINE_GEOMETRY = new THREE.PlaneGeometry(1.12, 0.13);
const FILE_EDGE_GEOMETRY = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-1.02, -0.82, 0.03),
  new THREE.Vector3(1.02, -0.82, 0.03),
  new THREE.Vector3(1.02, 0.36, 0.03),
  new THREE.Vector3(0.55, 0.82, 0.03),
  new THREE.Vector3(-1.02, 0.82, 0.03),
  new THREE.Vector3(-1.02, -0.82, 0.03)
]);

const LEG_INDICES = new Uint16Array(LEG_SEGMENTS * LEG_SIDES * 6);
for (let segment = 0; segment < LEG_SEGMENTS; segment += 1) {
  const vertex = segment * RING_VERTICES;
  for (let side = 0; side < LEG_SIDES; side += 1) {
    const next = (side + 1) % LEG_SIDES;
    const offset = (segment * LEG_SIDES + side) * 6;
    LEG_INDICES.set([
      vertex + side, vertex + next, vertex + LEG_SIDES + side,
      vertex + next, vertex + LEG_SIDES + next, vertex + LEG_SIDES + side
    ], offset);
  }
}

function makeShadowTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - size / 2) / (size / 2);
      const dy = (y + 0.5 - size / 2) / (size / 2);
      const fade = Math.max(0, 1 - dx * dx - dy * dy);
      const index = (y * size + x) * 4;
      data[index] = 8;
      data[index + 1] = 9;
      data[index + 2] = 10;
      data[index + 3] = Math.round(70 * fade * fade);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

const SHADOW_MATERIAL = new THREE.MeshBasicMaterial({
  map: makeShadowTexture(),
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide
});

function addEllipsoid(parent, material, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(BODY_GEOMETRY, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  parent.add(mesh);
  return mesh;
}

function makeAntennaGeometry(side) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.8, side * 0.9, 0.6),
    new THREE.Vector3(1.5, side * 1.65, 0.6),
    new THREE.Vector3(2.4, side * 2.1, 0.15),
    new THREE.Vector3(3.8, side * 2.5, -0.6)
  ]);
  return new THREE.TubeGeometry(curve, 12, 0.23, 5, false);
}

function makeMandibleGeometry(side) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.8, side * 0.25, -0.12),
    new THREE.Vector3(1.7, side * 0.15, -0.23),
    new THREE.Vector3(2.4, -side * 0.38, -0.4)
  ]);
  return new THREE.TubeGeometry(curve, 8, 0.3, 5, false);
}

const MANDIBLE_GEOMETRIES = [makeMandibleGeometry(-1), makeMandibleGeometry(1)];
const ANTENNA_SHELL_GEOMETRIES = SIDES.map((side) => {
  const antenna = makeAntennaGeometry(side);
  const tip = mergedEllipsoids([[3.76, side * 2.5, -0.6, 0.6, 0.35, 0.3]]);
  const merged = mergeGeometries([antenna, tip]);
  antenna.dispose();
  tip.dispose();
  if (!merged) throw new Error('Could not merge antenna geometry');
  return merged;
});

function tube(positions, normals, segment, start, end, startRadius, endRadius) {
  let dx = end[0] - start[0];
  let dy = end[1] - start[1];
  let dz = end[2] - start[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  dx /= length;
  dy /= length;
  dz /= length;

  let ux = dy;
  let uy = -dx;
  let uz = 0;
  let horizontal = Math.hypot(ux, uy);
  if (horizontal < 0.01) {
    ux = -dz;
    uy = 0;
    uz = dx;
    horizontal = Math.hypot(ux, uz) || 1;
  }
  ux /= horizontal;
  uy /= horizontal;
  uz /= horizontal;
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;

  const vertexOffset = segment * RING_VERTICES * 3;
  for (let ring = 0; ring < 2; ring += 1) {
    const point = ring ? end : start;
    const radius = ring ? endRadius : startRadius;
    for (let side = 0; side < LEG_SIDES; side += 1) {
      const cosine = RING_COS[side];
      const sine = RING_SIN[side];
      const nx = ux * cosine + vx * sine;
      const ny = uy * cosine + vy * sine;
      const nz = uz * cosine + vz * sine;
      const index = vertexOffset + (ring * LEG_SIDES + side) * 3;
      positions[index] = point[0] + nx * radius;
      positions[index + 1] = point[1] + ny * radius;
      positions[index + 2] = point[2] + nz * radius;
      normals[index] = nx;
      normals[index + 1] = ny;
      normals[index + 2] = nz;
    }
  }
}

function makeLegMesh(material) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(LEG_SEGMENTS * RING_VERTICES * 3);
  const normals = new Float32Array(positions.length);
  const position = new THREE.BufferAttribute(positions, 3);
  const normal = new THREE.BufferAttribute(normals, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.setIndex(new THREE.BufferAttribute(LEG_INDICES, 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, positions, normals, position, normal };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createAntModel(id = 0) {
  const variant = Math.abs(id) % BODY_COLORS.length;
  const shell = BODY_MATERIALS[variant];
  const dorsal = DORSAL_MATERIALS[variant];
  const root = new THREE.Group();
  root.scale.setScalar(0.76 + (Math.abs(id * 13) % 7) * 0.006);
  const shadow = new THREE.Mesh(SHADOW_GEOMETRY, SHADOW_MATERIAL);
  shadow.position.z = 0.04;
  shadow.renderOrder = -1;
  root.add(shadow);

  const body = new THREE.Group();
  root.add(body);
  const gaster = new THREE.Group();
  gaster.position.set(-6.8, 0, 3.1);
  body.add(gaster);
  addEllipsoid(gaster, shell, 0, 0, 0, 3.7, 2.45, 1.68);
  gaster.add(new THREE.Mesh(GASTER_DORSAL_GEOMETRY, dorsal));
  body.add(new THREE.Mesh(BODY_SHELL_GEOMETRY, shell));
  body.add(new THREE.Mesh(BODY_JOINT_GEOMETRY, JOINT_MATERIAL));
  body.add(new THREE.Mesh(BODY_DORSAL_GEOMETRY, dorsal));
  const head = addEllipsoid(body, shell, 4.7, 0, 2.79, 2.8, 2.55, 1.52);

  const eyes = new THREE.InstancedMesh(SMALL_GEOMETRY, EYE_MATERIAL, 2);
  const eyeTransform = new THREE.Object3D();
  for (const [index, side] of [-1, 1].entries()) {
    eyeTransform.position.set(5.2, side * 2.18, 3.38);
    eyeTransform.scale.set(0.63, 0.49, 0.48);
    eyeTransform.updateMatrix();
    eyes.setMatrixAt(index, eyeTransform.matrix);
  }
  eyes.instanceMatrix.needsUpdate = true;
  eyes.frustumCulled = false;
  body.add(eyes);

  const antennae = [];
  const mandibles = [];
  for (const side of SIDES) {
    const antenna = new THREE.Group();
    antenna.position.set(6.8, side * 1.42, 3.32);
    antenna.add(new THREE.Mesh(ANTENNA_SHELL_GEOMETRIES[side === -1 ? 0 : 1], shell));
    addEllipsoid(antenna, JOINT_MATERIAL, 1.52, side * 1.65, 0.58, 0.3, 0.32, 0.32);
    body.add(antenna);
    antennae.push({ side, group: antenna });

    const mandible = new THREE.Group();
    mandible.position.set(7.15, side * 1.15, 2.38);
    mandible.add(new THREE.Mesh(MANDIBLE_GEOMETRIES[side === -1 ? 0 : 1], JOINT_MATERIAL));
    body.add(mandible);
    mandibles.push({ side, group: mandible });
  }

  const crumb = new THREE.Mesh(CRUMB_GEOMETRY, FOOD_MATERIAL);
  crumb.position.set(9.52, 0, 2.2);
  crumb.scale.set(0.95, 0.74, 0.64);
  crumb.visible = false;
  body.add(crumb);
  const fileSlice = new THREE.Group();
  fileSlice.position.set(9.52, 0, 2.2);
  const paper = new THREE.Mesh(FILE_GEOMETRY, FILE_MATERIAL);
  fileSlice.add(paper);
  const fold = new THREE.Mesh(FILE_FOLD_GEOMETRY, FILE_FOLD_MATERIAL);
  fold.position.z = 0.04;
  fileSlice.add(fold);
  const line = new THREE.Mesh(FILE_LINE_GEOMETRY, FILE_LINE_MATERIAL);
  line.position.set(-0.22, -0.23, 0.05);
  fileSlice.add(line);
  fileSlice.add(new THREE.Line(FILE_EDGE_GEOMETRY, FILE_EDGE_MATERIAL));
  fileSlice.visible = false;
  body.add(fileSlice);

  const legs = makeLegMesh(LEG_MATERIALS[variant]);
  root.add(legs.mesh);
  let gaitPhase = (Math.abs(id * 37) % 17) / 17 * TAU;
  let motion = 0;
  let lastTime = null;
  const hip = [0, 0, 0];
  const knee = [0, 0, 0];
  const ankle = [0, 0, 0];
  const foot = [0, 0, 0];

  function update({ time = 0, speed = 0, carrying = false, payloadKind = 'food', payloadBytes = 0, turnRate = 0, distance = 0 } = {}) {
    const dt = lastTime === null ? 0 : clamp(time - lastTime, 0, 0.1);
    lastTime = time;
    gaitPhase += clamp(distance, 0, 12) / 9.5 * TAU;
    const targetMotion = clamp(speed / 65, 0, 1);
    motion += (targetMotion - motion) * (dt ? Math.min(1, dt * 15) : 1);
    const bob = 0.06 * Math.sin(time * 1.8 + id) + motion * 0.18 * Math.sin(gaitPhase * 2);
    body.position.z = bob;
    body.rotation.z = clamp(turnRate * -0.018, -0.1, 0.1) + motion * 0.025 * Math.sin(gaitPhase);
    body.rotation.x = motion * 0.025 * Math.sin(gaitPhase + 0.7);
    gaster.rotation.z = motion * 0.045 * Math.sin(gaitPhase + 1.2) - clamp(turnRate * 0.012, -0.06, 0.06);
    head.rotation.z = motion * 0.018 * Math.sin(gaitPhase + 2.0);
    for (const antenna of antennae) {
      antenna.group.rotation.z = antenna.side * (0.1 + 0.22 * Math.sin(time * 5.1 + id * 0.7 + antenna.side));
      antenna.group.rotation.x = 0.17 * Math.sin(time * 3.7 + id * 0.5 + antenna.side * 2);
    }
    for (const mandible of mandibles) {
      mandible.group.rotation.z = mandible.side * (carrying ? 0.04 : 0.14 + 0.07 * Math.sin(time * 3 + id));
    }
    const carryingFile = carrying && payloadKind === 'file';
    crumb.visible = carrying && !carryingFile;
    crumb.rotation.z = 0.14 * Math.sin(time * 7 + id);
    fileSlice.visible = carryingFile;
    if (carryingFile) {
      const bytes = Number(payloadBytes);
      fileSlice.scale.setScalar(Number.isFinite(bytes) && bytes > 0
        ? clamp(0.84 + Math.log2(bytes + 1) * 0.019, 0.84, 1.16)
        : 1);
      fileSlice.rotation.z = 0.09 * Math.sin(time * 7 + id);
      fileSlice.rotation.x = 0.05 * Math.sin(time * 5 + id * 0.7);
    }

    let segment = 0;
    for (const side of SIDES) {
      for (let leg = 0; leg < 3; leg += 1) {
        // Ants support themselves on alternating front/rear and middle tripods.
        const tripod = (side === 1 ? leg === 1 : leg !== 1) ? Math.PI : 0;
        const cycle = ((gaitPhase + tripod) % TAU + TAU) % TAU / TAU;
        let reach;
        let lift = 0;
        if (cycle < 0.62) {
          reach = 2.85 - 5.7 * cycle / 0.62;
        } else {
          const swing = (cycle - 0.62) / 0.38;
          reach = -2.85 + 5.7 * (1 - Math.cos(Math.PI * swing)) / 2;
          lift = 2.05 * Math.sin(Math.PI * swing);
        }
        reach *= motion;
        lift *= motion;
        const hipX = HIP_X[leg];
        const footX = FOOT_X[leg] + reach;
        const footY = side * (8.35 + motion * 0.18 * Math.sin(gaitPhase + leg));
        hip[0] = hipX; hip[1] = side * 1.24; hip[2] = 2.72 + bob;
        knee[0] = hipX + (footX - hipX) * 0.55; knee[1] = side * 4.72; knee[2] = 2.18 + bob * 0.5 + lift * 0.38;
        ankle[0] = footX - (leg - 1) * 0.2; ankle[1] = side * 7.45; ankle[2] = 0.64 + lift;
        foot[0] = footX + (leg - 1) * 0.12; foot[1] = footY; foot[2] = 0.18 + lift;
        tube(legs.positions, legs.normals, segment++, hip, knee, 0.54, 0.4);
        tube(legs.positions, legs.normals, segment++, knee, ankle, 0.39, 0.27);
        tube(legs.positions, legs.normals, segment++, ankle, foot, 0.26, 0.13);
      }
    }
    legs.position.needsUpdate = true;
    legs.normal.needsUpdate = true;
  }

  update();
  return {
    group: root,
    update,
    dispose() { legs.mesh.geometry.dispose(); }
  };
}
