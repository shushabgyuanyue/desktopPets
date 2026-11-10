const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

test('a 60 MB desktop file is carried in 512 varied, substantial slices', () => {
  const totalBytes = 60_708_140;
  let seed = 17;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const colony = globalThis.createColony({
    width: 100, height: 80, gridSize: 10, count: 36,
    nest: { x: 15, y: 15 }, food: { x: 35, y: 15 }, random
  });
  colony.setFileFood({ id: 'large-desktop-file', totalBytes });

  const sizes = [];
  const carrying = new Array(36).fill(false);
  let progress;
  for (let tick = 0; tick < 20_000; tick += 1) {
    colony.step(0.05);
    const snapshot = colony.snapshot();
    progress = snapshot.fileFood;
    snapshot.ants.forEach((ant) => {
      const hasSlice = ant.payloadKind === 'file';
      if (hasSlice && !carrying[ant.id]) sizes.push(ant.payloadBytes);
      carrying[ant.id] = hasSlice;
    });
    if (progress.deliveredBytes === totalBytes) break;
  }

  assert.equal(progress.chunkCount, 512);
  assert.equal(progress.pickedChunks, 512);
  assert.equal(progress.deliveredChunks, 512);
  assert.equal(progress.pickedBytes, totalBytes);
  assert.equal(progress.deliveredBytes, totalBytes);
  assert.equal(sizes.length, 512, 'every picked slice was visibly carried');
  assert.equal(sizes.reduce((sum, size) => sum + size, 0), totalBytes);
  const average = totalBytes / 512;
  assert.ok(sizes.every((size) => size >= Math.floor(average / 2) && size <= Math.ceil(average * 1.5)));
  assert.ok(sizes.every((size) => size < totalBytes));
  assert.ok(new Set(sizes).size > 100, 'slice sizes vary during transport');
});
