const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

function seededRandom(seed = 41) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function makeColony(obstacles = [], count = 6) {
  return globalThis.createColony({
    width: 130, height: 100, gridSize: 10, count,
    nest: { x: 25, y: 25 }, obstacles, random: seededRandom()
  });
}

function until(colony, predicate, limit = 5000) {
  for (let tick = 0; tick < limit; tick += 1) {
    colony.step(0.05);
    if (predicate(colony.snapshot({ includePheromone: false }))) return;
  }
  assert.fail('expected colony state was not reached');
}

function transportProgress({ pickedBytes, deliveredBytes, pickedChunks, deliveredChunks }) {
  return { pickedBytes, deliveredBytes, pickedChunks, deliveredChunks };
}

test('a bun can be collected from a reachable side when its representative point is blocked', () => {
  const colony = makeColony([{ x: 40, y: 20, w: 10, h: 10 }]);
  const source = {
    id: 'bun', totalBytes: 2048, position: { x: 45, y: 25 },
    accessPoints: [{ x: 45, y: 25 }, { x: 75, y: 25 }]
  };
  assert.equal(colony.canReach(source.accessPoints[0]), false);
  assert.equal(colony.canReach(source.accessPoints[1]), true);
  colony.setFileFoods([source]);
  until(colony, ({ fileFoods }) => fileFoods[0].deliveredBytes > 0);
  const before = colony.snapshot({ includePheromone: false }).fileFoods[0];
  colony.setFileFoods([{ ...source, accessPoints: [{ x: 75, y: 25 }, { x: 75, y: 65 }] }]);
  const after = colony.snapshot({ includePheromone: false }).fileFoods[0];
  assert.deepEqual(transportProgress(after), transportProgress(before));
  assert.equal(after.bestLength, Infinity);
  assert.equal(after.successfulReturns, before.successfulReturns);
  until(colony, ({ fileFoods }) => fileFoods[0].deliveredBytes === 2048);
});

test('adding another entrance preserves a cut already in progress', () => {
  const colony = makeColony([], 1);
  const source = {
    id: 'bun', totalBytes: 2048, position: { x: 45, y: 25 },
    accessPoints: [{ x: 45, y: 25 }]
  };
  colony.setFileFoods([source]);
  until(colony, ({ ants }) => ants[0].action === 'cutting');
  colony.setFileFoods([{ ...source, accessPoints: [
    { x: 45, y: 25 }, { x: 85, y: 65 }
  ] }]);
  assert.equal(colony.snapshot({ includePheromone: false }).ants[0].action, 'cutting');
  until(colony, ({ fileFoods }) => fileFoods[0].pickedChunks > 0);
  assert.equal(colony.snapshot({ includePheromone: false }).fileFoods[0].pickedChunks, 1);
});

test('removing one entrance cancels only its stale cut and keeps task progress', () => {
  const colony = makeColony([], 1);
  const source = {
    id: 'bun', totalBytes: 2048, position: { x: 45, y: 25 },
    accessPoints: [{ x: 45, y: 25 }, { x: 85, y: 65 }]
  };
  colony.setFileFoods([source]);
  until(colony, ({ ants }) => ants[0].action === 'cutting');
  const before = colony.snapshot({ includePheromone: false }).fileFoods[0];
  colony.setFileFoods([{ ...source, accessPoints: [{ x: 85, y: 65 }] }]);
  assert.equal(colony.snapshot({ includePheromone: false }).ants[0].action, null);
  assert.deepEqual(colony.snapshot({ includePheromone: false }).fileFoods[0], before);
  until(colony, ({ fileFoods }) => fileFoods[0].deliveredBytes > 0);
});
