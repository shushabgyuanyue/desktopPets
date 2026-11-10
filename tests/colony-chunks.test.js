const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

function deliverFile(totalBytes, fixedRoll) {
  let seed = 19;
  const seededRandom = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const random = fixedRoll === undefined ? seededRandom : () => fixedRoll;
  const colony = globalThis.createColony({
    width: 60, height: 60, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, food: { x: 25, y: 25 }, random
  });
  colony.setFileFood({ id: 'chunk-test', totalBytes });
  const chunkCount = colony.snapshot().fileFood.chunkCount;
  const chunks = [];

  for (let tick = 0; tick < 40000; tick += 1) {
    colony.step(0.1);
    const snapshot = colony.snapshot();
    if (snapshot.fileFood.pickedChunks > chunks.length) {
      assert.equal(snapshot.fileFood.pickedChunks, chunks.length + 1);
      chunks.push(snapshot.ants[0].payloadBytes);
    }
    if (snapshot.fileFood.deliveredBytes === totalBytes) {
      assert.equal(snapshot.fileFood.deliveredChunks, chunkCount);
      assert.equal(snapshot.fileFood.pickedBytes, totalBytes);
      return { chunkCount, chunks };
    }
  }
  assert.fail(`delivery stalled for ${totalBytes} bytes`);
}

test('two-byte desktop files split into two smaller pieces', () => {
  assert.deepEqual(deliverFile(2), { chunkCount: 2, chunks: [1, 1] });
});

test('one-KiB files retain two transportable slices', () => {
  assert.deepEqual(deliverFile(1024), { chunkCount: 2, chunks: [512, 512] });
});

test('large desktop files use at most 512 variable slices and preserve every byte', () => {
  const size = 60_708_140;
  const { chunkCount, chunks } = deliverFile(size);
  const average = size / chunkCount;
  assert.equal(chunkCount, 512);
  assert.equal(chunks.length, chunkCount);
  assert.equal(chunks.reduce((sum, bytes) => sum + bytes, 0), size);
  assert.ok(chunks.every((bytes) => bytes >= Math.floor(average / 2) &&
    bytes <= Math.ceil(average * 1.5) && bytes < size));
  assert.ok(new Set(chunks).size > 1, 'slice sizes should vary');
});

test('512-KiB boundary and large safe integers keep valid bounds at RNG extremes', () => {
  for (const size of [524_287, 524_288, 524_289, 60_708_140, Number.MAX_SAFE_INTEGER]) {
    for (const roll of [0, 0.999999999]) {
      const { chunkCount, chunks } = deliverFile(size, roll);
      const average = size / chunkCount;
      const minimum = Math.max(512, Math.floor(average / 2));
      const maximum = Math.ceil(average * 1.5);
      assert.ok(chunkCount <= 512);
      assert.equal(chunks.length, chunkCount);
      assert.equal(chunks.reduce((sum, bytes) => sum + bytes, 0), size);
      assert.ok(chunks.every((bytes) => bytes >= minimum && bytes <= maximum && bytes < size),
        `${size} bytes with roll ${roll} has a slice outside the reserved bounds`);
    }
  }
});
