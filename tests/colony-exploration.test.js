const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

function seededRandom(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('distant food coordinates do not direct searching ants', () => {
  const common = { width: 640, height: 480, gridSize: 10, count: 6,
    nest: { x: 30, y: 30 } };
  const north = globalThis.createColony({ ...common, food: { x: 550, y: 100 }, random: seededRandom(9) });
  const south = globalThis.createColony({ ...common, food: { x: 550, y: 400 }, random: seededRandom(9) });
  for (let tick = 0; tick < 20; tick += 1) {
    north.step(0.1);
    south.step(0.1);
  }
  const northSnapshot = north.snapshot({ includeExploration: true });
  const southSnapshot = south.snapshot({ includeExploration: true });
  assert.deepEqual(northSnapshot.ants, southSnapshot.ants);
  assert.deepEqual(northSnapshot.explorationPheromone, southSnapshot.explorationPheromone);
  assert.ok(northSnapshot.explorationPheromone.length > 0);
  assert.equal(northSnapshot.discoveries, 0);
});

test('exploration pheromone survives resize and clears under a moved icon', () => {
  const colony = globalThis.createColony({
    width: 120, height: 100, gridSize: 10, count: 1,
    nest: { x: 15, y: 15 }, random: seededRandom(2)
  });
  for (let tick = 0; tick < 20; tick += 1) colony.step(0.1);
  const before = colony.snapshot({ includeExploration: true }).explorationPheromone;
  assert.ok(before.length > 1);
  colony.resize(140, 120);
  assert.deepEqual(colony.snapshot({ includeExploration: true }).explorationPheromone, before);

  const trace = before[0];
  colony.setTerrain({ obstacles: [{ x: trace.x - 2, y: trace.y - 2, w: 4, h: 4 }] });
  const after = colony.snapshot({ includeExploration: true }).explorationPheromone;
  assert.ok(!after.some((item) => item.x === trace.x && item.y === trace.y));
  assert.ok(after.length > 0);
});

test('explorers spread across the desktop instead of hugging the screen edge', () => {
  const colony = globalThis.createColony({
    width: 1200, height: 800, gridSize: 10, count: 36,
    nest: { x: 900, y: 700 }, random: seededRandom(7)
  });
  for (let tick = 0; tick < 100; tick += 1) colony.step(0.1);

  const ants = colony.snapshot({ includePheromone: false }).ants;
  const edgeCount = ants.filter(({ x, y }) =>
    x < 30 || x > 1170 || y < 30 || y > 770).length;
  const sectors = new Set(ants.map(({ x, y }) =>
    Math.floor(x / 100) + 12 * Math.floor(y / 100)));
  assert.ok(edgeCount < ants.length / 2, `${edgeCount} ants crowded the edge`);
  assert.ok(sectors.size >= 17, `ants reached only ${sectors.size} sectors`);
});

test('a long-running colony keeps exploring away from the far corner', () => {
  const width = 1229;
  const height = 691;
  const colony = globalThis.createColony({
    width, height, gridSize: 10, count: 36,
    nest: { x: 82, y: 38 }, random: seededRandom(7)
  });
  for (let tick = 0; tick < 1200; tick += 1) colony.step(0.1);
  const snapshot = colony.snapshot({ includePheromone: false, includeExploration: true });
  const farCorner = snapshot.ants.filter(({ x, y }) => x > width / 2 && y > height / 2);
  const interiorTrail = snapshot.explorationPheromone.filter(({ x, y, strength }) =>
    x < width / 2 && y < height / 2 && strength > 0.03);
  const brightTrail = snapshot.explorationPheromone.filter(({ strength }) => strength > 0.1);
  const edgeTrail = brightTrail.filter(({ x, y }) =>
    x < 30 || x > width - 30 || y < 30 || y > height - 30);
  assert.ok(farCorner.length < 18, `${farCorner.length} ants remained in the far quadrant`);
  assert.ok(interiorTrail.length > 100,
    `only ${interiorTrail.length} visible exploration cells remained near home`);
  assert.ok(edgeTrail.length < brightTrail.length * 0.35,
    `${edgeTrail.length}/${brightTrail.length} bright exploration cells hugged the edge`);
});

test('an unsuccessful scout walks home without carrying or completing a delivery', () => {
  const colony = globalThis.createColony({
    width: 100, height: 80, gridSize: 10, count: 1,
    nest: { x: 15, y: 15 }, random: seededRandom(9)
  });
  let previous = colony.snapshot({ includePheromone: false }).ants[0];
  let sawRetreat = false;
  let departedAgain = false;
  for (let tick = 0; tick < 4000; tick += 1) {
    colony.step(0.05);
    const snapshot = colony.snapshot({ includePheromone: false });
    const ant = snapshot.ants[0];
    assert.ok(Math.hypot(ant.x - previous.x, ant.y - previous.y) < 4.6,
      'the scout must not jump back to the nest');
    assert.equal(ant.carrying, false);
    assert.equal(snapshot.completedTrips, 0);
    if (ant.mode === 'retreat') sawRetreat = true;
    if (sawRetreat && ant.mode === 'search' &&
      Math.hypot(ant.x - 15, ant.y - 15) < 8) {
      departedAgain = true;
      break;
    }
    previous = ant;
  }
  assert.ok(sawRetreat && departedAgain);
  assert.equal(colony.snapshot().pheromone.length, 0);
});

test('sustained exploration has no opposite-corner attractor for any nest corner', () => {
  const width = 1229, height = 691, count = 36;
  for (const nest of [{ x: 82, y: 38 }, { x: width - 82, y: 38 },
    { x: 82, y: height - 38 }, { x: width - 82, y: height - 38 }]) {
    const quadrants = [0, 0, 0, 0];
    let edges = 0, samples = 0;
    // Hold-out seeds and a two-minute observation window catch persistent
    // drift that a single favourable snapshot cannot establish or exclude.
    for (const seed of [101, 202, 303, 404]) {
      const colony = globalThis.createColony({ width, height, gridSize: 10,
        count, nest, random: seededRandom(seed) });
      for (let tick = 1; tick <= 1800; tick += 1) {
        colony.step(0.1);
        if (tick < 600 || tick % 10) continue;
        const { ants } = colony.snapshot({ includePheromone: false, includeBestPath: false });
        samples += 1;
        for (const ant of ants) {
          quadrants[(ant.x > width / 2 ? 1 : 0) + (ant.y > height / 2 ? 2 : 0)] += 1;
          if (Math.min(ant.x, ant.y, width - ant.x, height - ant.y) < 30) edges += 1;
        }
      }
    }
    const average = quadrants.map((total) => total / samples);
    assert.ok(average.every((value) => value > 3 && value < 15),
      `nest ${JSON.stringify(nest)}: mean quadrant occupancy ${average}`);
    assert.ok(edges / samples < 3, `mean edge occupancy ${edges / samples}`);
  }
});

test('inward exploration turns do not prevent gathering food on the screen edge', () => {
  for (const food of [{ x: 5, y: 180 }, { x: 635, y: 400 },
    { x: 320, y: 5 }, { x: 500, y: 475 }]) {
    const colony = globalThis.createColony({ width: 640, height: 480,
      gridSize: 10, count: 36, nest: { x: 35, y: 35 }, food,
      random: seededRandom(31) });
    let result;
    for (let tick = 0; tick < 1200; tick += 1) {
      colony.step(0.1);
      if (tick % 10) continue;
      result = colony.snapshot({ includePheromone: false, includeBestPath: false });
      if (result.completedTrips) break;
    }
    assert.ok(result.completedTrips > 0, `edge food ${JSON.stringify(food)} must be delivered`);
  }
});

test('a returning scout can discover food placed along its route', () => {
  const colony = globalThis.createColony({
    width: 100, height: 80, gridSize: 10, count: 1,
    nest: { x: 15, y: 15 }, random: seededRandom(9)
  });
  let scout;
  for (let tick = 0; tick < 4000; tick += 1) {
    colony.step(0.05);
    scout = colony.snapshot({ includePheromone: false }).ants[0];
    if (scout.mode === 'retreat') break;
  }
  assert.equal(scout.mode, 'retreat');
  colony.setTerrain({ food: { x: scout.x, y: scout.y } });
  let discovered = false;
  for (let tick = 0; tick < 200; tick += 1) {
    colony.step(0.05);
    if (colony.snapshot({ includePheromone: false }).discoveries > 0) {
      discovered = true;
      break;
    }
  }
  assert.ok(discovered, 'a new food source should interrupt the empty return');
});

test('an icon trap does not teleport a distant scout back to the nest', () => {
  const colony = globalThis.createColony({
    width: 180, height: 120, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, random: seededRandom(5)
  });
  let ant;
  for (let tick = 0; tick < 1000; tick += 1) {
    colony.step(0.05);
    ant = colony.snapshot({ includePheromone: false }).ants[0];
    if (Math.hypot(ant.x - 25, ant.y - 25) > 50 && ant.mode === 'search') break;
  }
  assert.ok(Math.hypot(ant.x - 25, ant.y - 25) > 50);
  const x = Math.floor(ant.x / 10) * 10 + 5;
  const y = Math.floor(ant.y / 10) * 10 + 5;
  const obstacles = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if ((!dx && !dy) || x + dx * 10 < 0 || x + dx * 10 >= 180 ||
        y + dy * 10 < 0 || y + dy * 10 >= 120) continue;
      obstacles.push({ x: x + dx * 10 - 3, y: y + dy * 10 - 3, w: 6, h: 6 });
    }
  }
  colony.setTerrain({ obstacles });
  const trapped = colony.snapshot({ includePheromone: false }).ants[0];
  for (let tick = 0; tick < 30; tick += 1) colony.step(0.1);
  const after = colony.snapshot({ includePheromone: false }).ants[0];
  assert.ok(Math.hypot(after.x - trapped.x, after.y - trapped.y) < 1);
});

test('large desktop search reaches a distant food source without its coordinates', () => {
  let seed = 1;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const colony = globalThis.createColony({
    width: 3840,
    height: 2160,
    gridSize: 10,
    count: 36,
    nest: { x: 45, y: 45 },
    food: { x: 3450, y: 1850 },
    random
  });

  for (let tick = 0; tick < 1200; tick += 1) {
    colony.step(0.1);
    if (colony.snapshot({ includePheromone: false, includeBestPath: false }).discoveries > 0) break;
  }
  const snapshot = colony.snapshot({ includePheromone: false, includeBestPath: false });
  assert.ok(snapshot.discoveries > 0,
    'the target-agnostic exploration should reach a distant 4K food source');
});
