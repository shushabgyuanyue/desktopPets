const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

function seededRandom(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('a long-roaming ant can revisit its path to collect newly placed food', () => {
  const colony = globalThis.createColony({
    width: 640, height: 480, gridSize: 10, count: 1,
    nest: { x: 15, y: 15 }, random: seededRandom(2)
  });
  // Arrange the behavior we test, rather than depending on a fixed-time position
  // that used to be guaranteed by the unwanted drift toward the far corner.
  let before;
  for (let tick = 0; tick < 1800; tick += 1) {
    colony.step(0.1);
    before = colony.snapshot({ includePheromone: false });
    if (tick >= 600 && before.ants[0].mode === 'search' &&
      Math.hypot(before.ants[0].x - 15, before.ants[0].y - 15) > 500) break;
  }
  const source = { x: before.ants[0].x, y: before.ants[0].y };
  assert.ok(Math.hypot(source.x - 15, source.y - 15) > 500);
  colony.setFileFoods([{ id: 'late-food', totalBytes: 2048, position: source }]);
  const placed = colony.snapshot({ includePheromone: false });
  assert.equal(placed.elapsed, before.elapsed);
  assert.equal(placed.ants[0].x, source.x);
  assert.equal(placed.ants[0].y, source.y);

  for (let tick = 0; tick < 40; tick += 1) colony.step(0.1);
  assert.ok(colony.snapshot().fileFoods[0].pickedChunks > 0,
    'the ant should turn toward food placed on its explored route');

  for (let tick = 0; tick < 160; tick += 1) colony.step(0.1);
  const delivered = colony.snapshot();
  assert.ok(delivered.fileFoods[0].deliveredChunks > 0,
    'the carrier should find its way home without retracing the entire roaming path');
  assert.ok(delivered.pheromone.length > 10,
    'the discovered homeward route should receive food pheromone');
});

test('best route is measured from a completed food-to-nest journey', () => {
  const colony = globalThis.createColony({
    width: 180, height: 120, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, food: { x: 75, y: 45 },
    random: seededRandom(7)
  });
  let found;
  for (let tick = 0; tick < 5000; tick += 1) {
    colony.step(0.05);
    found = colony.snapshot({ includePheromone: false });
    if (found.discoveries > 0) break;
  }
  assert.ok(found.discoveries > 0);
  assert.equal(found.completedTrips, 0);
  assert.equal(found.bestLength, Infinity);
  assert.equal(found.bestPath, null);

  let returned;
  for (let tick = 0; tick < 5000; tick += 1) {
    colony.step(0.05);
    returned = colony.snapshot({ includePheromone: false });
    if (returned.completedTrips > 0) break;
  }
  assert.ok(returned.completedTrips > 0);
  assert.ok(Number.isFinite(returned.bestLength));
  assert.deepEqual(returned.bestPath[0], { x: 25, y: 25 });
  assert.deepEqual(returned.bestPath.at(-1), { x: 75, y: 45 });
  const pathLength = returned.bestPath.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - returned.bestPath[index].x,
      point.y - returned.bestPath[index].y), 0);
  assert.ok(Math.abs(pathLength - returned.bestLength) < 0.01);
});
