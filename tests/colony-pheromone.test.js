const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

function transportProgress({ pickedBytes, deliveredBytes, pickedChunks, deliveredChunks }) {
  return { pickedBytes, deliveredBytes, pickedChunks, deliveredChunks };
}

test('pheromone survives resize and clears only under new obstacles', () => {
  let seed = 3;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const colony = globalThis.createColony({
    width: 80,
    height: 60,
    gridSize: 10,
    nest: { x: 15, y: 15 },
    food: { x: 35, y: 15 },
    count: 1,
    random
  });

  let found;
  for (let step = 0; step < 300; step += 1) {
    colony.step(0.05);
    found = colony.snapshot();
    if (found.completedTrips > 0) break;
  }
  assert.ok(found.completedTrips > 0);
  assert.ok(found.pheromone.some((trace) => trace.x === 35 && trace.y === 15));

  colony.setTerrain({ food: null, obstacles: [{ x: 34, y: 14, w: 2, h: 2 }] });
  const cleared = colony.snapshot();
  assert.ok(!cleared.pheromone.some((trace) => trace.x === 35 && trace.y === 15));
  assert.ok(cleared.pheromone.some((trace) => trace.x === 15 && trace.y === 15));

  colony.resize(100, 80);
  assert.deepEqual(colony.snapshot().pheromone, cleared.pheromone);
  colony.step(0.1);
  const decayed = colony.snapshot();
  for (const trace of cleared.pheromone) {
    const next = decayed.pheromone.find((item) => item.x === trace.x && item.y === trace.y);
    assert.ok(next && next.strength < trace.strength);
  }
});

test('moving a file source fades its old trail without resetting the colony', () => {
  let seed = 17;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const colony = globalThis.createColony({
    width: 140, height: 100, gridSize: 10, count: 4,
    nest: { x: 25, y: 25 }, random
  });
  const source = { id: 'moving', totalBytes: 20_480, position: { x: 45, y: 25 } };
  colony.setFileFoods([source]);
  let before;
  for (let tick = 0; tick < 2000; tick += 1) {
    colony.step(0.05);
    before = colony.snapshot();
    if (before.completedTrips >= 2) break;
  }
  assert.ok(before.completedTrips >= 2);
  const oldFoodSignal = before.pheromone.find((trace) => trace.x === 45 && trace.y === 25)?.strength;
  assert.ok(oldFoodSignal > 0.1);

  colony.setFileFoods([{ ...source, position: { x: 105, y: 75 } }]);
  const after = colony.snapshot();
  const fadedSignal = after.pheromone.find((trace) => trace.x === 45 && trace.y === 25)?.strength || 0;
  assert.ok(fadedSignal < oldFoodSignal * 0.5);
  assert.equal(after.elapsed, before.elapsed);
  assert.equal(after.completedTrips, before.completedTrips);
  assert.deepEqual(transportProgress(after.fileFoods[0]), transportProgress(before.fileFoods[0]));
  assert.equal(after.fileFoods[0].bestLength, Infinity);
  assert.equal(after.fileFoods[0].successfulReturns, before.fileFoods[0].successfulReturns);
  assert.deepEqual(after.ants.map(({ x, y }) => ({ x, y })),
    before.ants.map(({ x, y }) => ({ x, y })));
});

test('moving one file preserves a second source at the same food cell', () => {
  let seed = 31;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const colony = globalThis.createColony({
    width: 140, height: 100, gridSize: 10, count: 4,
    nest: { x: 25, y: 25 }, random
  });
  const first = { id: 'first', totalBytes: 20_480, position: { x: 45, y: 25 } };
  const second = { id: 'second', totalBytes: 20_480, position: { x: 45, y: 25 } };
  colony.setFileFoods([first, second]);
  let before;
  for (let tick = 0; tick < 2000; tick += 1) {
    colony.step(0.05);
    before = colony.snapshot();
    if (before.completedTrips >= 2) break;
  }
  assert.ok(before.completedTrips >= 2);
  const signal = before.pheromone.find((trace) => trace.x === 45 && trace.y === 25)?.strength;
  assert.ok(signal > 0);

  colony.setFileFoods([{ ...first, position: { x: 105, y: 75 } }, second]);
  const after = colony.snapshot();
  assert.equal(after.pheromone.find((trace) => trace.x === 45 && trace.y === 25)?.strength, signal);
  assert.deepEqual(after.fileFoods.map(transportProgress), before.fileFoods.map(transportProgress));
  assert.equal(after.fileFoods[1].bestLength, before.fileFoods[1].bestLength);
});
