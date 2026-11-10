const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

function colonyWithFile() {
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const colony = globalThis.createColony({
    width: 160, height: 120, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, food: { x: 45, y: 25 }, random
  });
  colony.setFileFood({ id: 'entry-file', totalBytes: 2048 });
  let atEntry;
  for (let tick = 0; tick < 4000; tick += 1) {
    colony.step(0.05);
    atEntry = colony.snapshot();
    if (atEntry.ants[0].mode === 'deposit') break;
  }
  assert.equal(atEntry.ants[0].mode, 'deposit', 'a carrier reaches the entry');
  assert.equal(atEntry.ants[0].payloadKind, 'file');
  assert.ok(atEntry.ants[0].payloadBytes > 0);
  return { colony, atEntry };
}

test('a file slice counts only after the visible entry finishes', () => {
  const { colony, atEntry } = colonyWithFile();
  assert.equal(atEntry.fileFood.deliveredBytes, 0);
  assert.equal(atEntry.completedTrips, 0);

  for (let tick = 0; tick < 5; tick += 1) colony.step(0.05);
  const entering = colony.snapshot();
  assert.equal(entering.ants[0].mode, 'deposit');
  assert.ok(entering.ants[0].entryProgress > 0 && entering.ants[0].entryProgress < 1);
  assert.equal(entering.fileFood.deliveredBytes, 0);

  for (let tick = 0; tick < 6; tick += 1) colony.step(0.05);
  const arrived = colony.snapshot();
  assert.equal(arrived.fileFood.deliveredBytes, atEntry.ants[0].payloadBytes);
  assert.equal(arrived.completedTrips, 1);
});

test('moving the nest during entry keeps the slice in transit', () => {
  const { colony, atEntry } = colonyWithFile();
  colony.setTerrain({ nest: { x: 85, y: 25 } });
  const rerouted = colony.snapshot();
  assert.equal(rerouted.fileFood.deliveredBytes, 0);
  assert.equal(rerouted.ants[0].payloadBytes, atEntry.ants[0].payloadBytes);
  assert.equal(rerouted.ants[0].mode, 'homing');

  let delivered;
  for (let tick = 0; tick < 4000; tick += 1) {
    colony.step(0.05);
    delivered = colony.snapshot();
    if (delivered.fileFood.deliveredBytes > 0) break;
  }
  assert.equal(delivered.fileFood.deliveredBytes, atEntry.ants[0].payloadBytes);
});

test('resizing during entry preserves payload and entry progress', () => {
  const { colony, atEntry } = colonyWithFile();
  colony.step(0.05);
  const beforeResize = colony.snapshot();
  colony.resize(130, 100);
  const resized = colony.snapshot();
  assert.equal(resized.ants[0].mode, 'deposit');
  assert.equal(resized.ants[0].entryProgress, beforeResize.ants[0].entryProgress);
  assert.equal(resized.ants[0].payloadBytes, atEntry.ants[0].payloadBytes);
  assert.equal(resized.fileFood.deliveredBytes, 0);
});
