const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

function seededRandom(seed = 11) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function makeColony(count = 8) {
  return globalThis.createColony({
    width: 120, height: 100, gridSize: 10, count,
    nest: { x: 25, y: 25 }, random: seededRandom()
  });
}

function progress(colony, id) {
  return colony.snapshot().fileFoods.find((task) => task.id === id);
}

function stepUntil(colony, predicate, limit = 5000) {
  for (let tick = 0; tick < limit; tick += 1) {
    colony.step(0.05);
    if (predicate(colony.snapshot())) return;
  }
  assert.fail('colony did not reach the expected state');
}

test('separate file sources are explored and delivered independently', () => {
  const colony = makeColony();
  colony.setFileFoods([
    { id: 'left', totalBytes: 2048, position: { x: 45, y: 25 } },
    { id: 'lower', totalBytes: 3072, position: { x: 25, y: 55 } }
  ]);
  assert.equal(colony.snapshot().fileFood, null);
  stepUntil(colony, ({ fileFoods }) => fileFoods.every((task) =>
    task.deliveredBytes === task.totalBytes));
  const [left, lower] = colony.snapshot().fileFoods;
  assert.equal(left.id, 'left');
  assert.equal(left.pickedBytes, 2048);
  assert.equal(left.deliveredBytes, 2048);
  assert.equal(lower.id, 'lower');
  assert.equal(lower.pickedBytes, 3072);
  assert.equal(lower.deliveredBytes, 3072);
  assert.ok(colony.snapshot().discoveries >= left.chunkCount + lower.chunkCount);
});

test('each file records a route only after its own carrier reaches the nest', () => {
  const colony = makeColony(1);
  const near = { id: 'near', totalBytes: 2048, position: { x: 45, y: 25 } };
  const far = { id: 'far', totalBytes: 2048, position: null };
  colony.setFileFoods([near, far]);

  stepUntil(colony, ({ fileFoods }) => fileFoods[0].pickedChunks > 0);
  assert.equal(progress(colony, 'near').bestLength, Infinity);
  assert.equal(progress(colony, 'near').successfulReturns, 0);
  assert.equal(progress(colony, 'far').bestLength, Infinity);

  stepUntil(colony, ({ fileFoods }) => fileFoods[0].deliveredBytes === near.totalBytes);
  const nearRoute = progress(colony, 'near').bestLength;
  assert.ok(Number.isFinite(nearRoute));
  assert.ok(progress(colony, 'near').successfulReturns > 0);
  assert.equal(progress(colony, 'far').bestLength, Infinity);

  colony.setFileFoods([near, { ...far, position: { x: 95, y: 85 } }]);
  stepUntil(colony, ({ fileFoods }) => fileFoods[1].pickedChunks > 0);
  assert.equal(progress(colony, 'far').bestLength, Infinity);
  assert.equal(progress(colony, 'near').bestLength, nearRoute);
  stepUntil(colony, ({ fileFoods }) => fileFoods[1].successfulReturns > 0);
  assert.ok(progress(colony, 'far').bestLength > nearRoute);
  assert.equal(progress(colony, 'near').bestLength, nearRoute);
});

test('moving one file resets only its route while preserving both transport records', () => {
  const colony = makeColony();
  const first = { id: 'first', totalBytes: 1_000_000, position: { x: 45, y: 25 } };
  const second = { id: 'second', totalBytes: 1_000_000, position: { x: 25, y: 55 } };
  colony.setFileFoods([first, second]);
  stepUntil(colony, ({ fileFoods }) => fileFoods.every((task) => task.successfulReturns > 0));
  const before = colony.snapshot().fileFoods;
  assert.ok(before.every((task) => Number.isFinite(task.bestLength)));

  colony.setFileFoods([{ ...first, position: { x: 65, y: 25 } }, second]);
  const after = colony.snapshot().fileFoods;
  assert.equal(after[0].bestLength, Infinity);
  assert.equal(after[0].successfulReturns, before[0].successfulReturns);
  assert.deepEqual(after[1], before[1]);
  for (let index = 0; index < after.length; index += 1) {
    for (const key of ['pickedBytes', 'deliveredBytes', 'pickedChunks', 'deliveredChunks']) {
      assert.equal(after[index][key], before[index][key]);
    }
  }
});

test('moving a source preserves each task and in-transit slices', () => {
  const colony = makeColony();
  const first = { id: 'first', totalBytes: 2048, position: { x: 45, y: 25 } };
  const second = { id: 'second', totalBytes: 2048, position: { x: 25, y: 55 } };
  colony.setFileFoods([first, second]);
  stepUntil(colony, ({ fileFoods }) => fileFoods.some((task) => task.pickedChunks > 0));
  const before = colony.snapshot().fileFoods;
  colony.setFileFoods([{ ...first, position: { x: 65, y: 25 } }, second]);
  assert.deepEqual(colony.snapshot().fileFoods, before);
  stepUntil(colony, ({ fileFoods }) => fileFoods.every((task) =>
    task.deliveredBytes === task.totalBytes));
  assert.equal(progress(colony, 'first').deliveredBytes, 2048);
  assert.equal(progress(colony, 'second').deliveredBytes, 2048);
});

test('a missing icon stops pickup while an already carried slice reaches the nest', () => {
  const colony = makeColony(1);
  const file = { id: 'paused', totalBytes: 2048, position: { x: 45, y: 25 } };
  colony.setFileFoods([file]);
  stepUntil(colony, ({ fileFoods }) => fileFoods[0].pickedChunks === 1);
  const pickedBytes = progress(colony, 'paused').pickedBytes;
  colony.setFileFoods([{ ...file, position: null }]);
  stepUntil(colony, ({ fileFoods }) => fileFoods[0].deliveredBytes === pickedBytes);
  for (let tick = 0; tick < 100; tick += 1) colony.step(0.05);
  assert.equal(progress(colony, 'paused').pickedChunks, 1);
  colony.setFileFoods([file]);
  stepUntil(colony, ({ fileFoods }) => fileFoods[0].deliveredBytes === 2048);
});

test('removing one file cannot credit its carried slice to another file', () => {
  const colony = makeColony(1);
  colony.setFileFoods([
    { id: 'removed', totalBytes: 2048, position: { x: 45, y: 25 } },
    { id: 'waiting', totalBytes: 2048, position: null }
  ]);
  stepUntil(colony, ({ fileFoods }) => fileFoods[0].pickedChunks === 1);
  colony.setFileFoods([{ id: 'waiting', totalBytes: 2048, position: null }]);
  for (let tick = 0; tick < 150; tick += 1) colony.step(0.05);
  assert.equal(colony.snapshot().fileFoods.length, 1);
  assert.equal(progress(colony, 'waiting').pickedBytes, 0);
  assert.equal(progress(colony, 'waiting').deliveredBytes, 0);
});

test('moving another file does not interrupt a cut already in progress', () => {
  const colony = makeColony(1);
  const near = { id: 'near', totalBytes: 2048, position: { x: 45, y: 25 } };
  const far = { id: 'far', totalBytes: 2048, position: { x: 95, y: 85 } };
  colony.setFileFoods([near, far]);
  stepUntil(colony, ({ ants }) => ants[0].action === 'cutting');
  colony.setFileFoods([near, { ...far, position: { x: 85, y: 75 } }]);
  assert.equal(colony.snapshot().ants[0].action, 'cutting');
  stepUntil(colony, ({ fileFoods }) => fileFoods[0].pickedChunks === 1);
  assert.ok(progress(colony, 'near').pickedBytes > 0);
});

test('moving ordinary food leaves an active file task intact', () => {
  const colony = globalThis.createColony({
    width: 120, height: 100, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, food: { x: 95, y: 85 }, random: seededRandom()
  });
  colony.setFileFoods([{ id: 'file', totalBytes: 2048, position: { x: 45, y: 25 } }]);
  stepUntil(colony, ({ fileFoods }) => fileFoods[0].pickedChunks === 1);
  const before = progress(colony, 'file');
  colony.setTerrain({ food: { x: 95, y: 75 } });
  assert.deepEqual(progress(colony, 'file'), before);
  stepUntil(colony, ({ fileFoods }) => fileFoods[0].deliveredBytes === 2048);
});
