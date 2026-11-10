const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

test('resize preserves a file delivery while rebuilding the grid', () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const colony = globalThis.createColony({
    width: 430,
    height: 320,
    gridSize: 10,
    nest: { x: 35, y: 65 },
    food: { x: 410, y: 95 },
    obstacles: [{ x: 170, y: 200, w: 45, h: 45 }],
    count: 36,
    random
  });
  colony.setFileFood({ id: 'resize-test', totalBytes: 2048 });

  let before;
  for (let step = 0; step < 3000; step += 1) {
    colony.step(0.05);
    before = colony.snapshot();
    if (before.fileFood.pickedChunks > 0) break;
  }
  assert.ok(before.fileFood.pickedChunks > 0, 'an ant must collect a chunk');
  const carrier = before.ants.find((ant) => ant.payloadKind === 'file');
  assert.ok(carrier && carrier.x > 300, 'a carrier must be outside the smaller viewport');

  colony.resize(300, 300, { food: { x: 288, y: 95 } });
  const shrunk = colony.snapshot();
  assert.deepEqual(shrunk.fileFood, before.fileFood);
  assert.equal(shrunk.elapsed, before.elapsed);
  assert.equal(shrunk.iterations, before.iterations);
  assert.deepEqual([shrunk.cols, shrunk.rows], [30, 30]);
  assert.ok(shrunk.ants.every((ant) => ant.x >= 0 && ant.x < 300 && ant.y >= 0 && ant.y < 300));
  assert.equal(shrunk.ants.find((ant) => ant.id === carrier.id).payloadBytes, carrier.payloadBytes);

  let delivering;
  for (let step = 0; step < 4000; step += 1) {
    colony.step(0.05);
    delivering = colony.snapshot();
    if (delivering.fileFood.deliveredBytes > 0) break;
  }
  assert.ok(delivering.fileFood.deliveredBytes > 0, 'the carried chunk must reach the nest');
  assert.ok(delivering.pheromone.length > 0, 'returning ants must leave pheromone');

  colony.resize(500, 360);
  const grown = colony.snapshot();
  assert.deepEqual([grown.cols, grown.rows], [50, 36]);
  assert.deepEqual(grown.fileFood, delivering.fileFood);
  assert.equal(grown.elapsed, delivering.elapsed);
  assert.equal(grown.iterations, delivering.iterations);
  assert.deepEqual(grown.pheromone, delivering.pheromone);
  assert.deepEqual(grown.ants, delivering.ants);

  let finished;
  for (let step = 0; step < 4000; step += 1) {
    colony.step(0.05);
    finished = colony.snapshot();
    if (finished.fileFood.deliveredBytes === 2048) break;
  }
  assert.equal(finished.fileFood.deliveredBytes, 2048);
  assert.equal(finished.fileFood.pickedChunks, finished.fileFood.deliveredChunks);
});
