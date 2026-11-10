const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

test('icon image bounds leave a visible corridor passable', () => {
  const colony = globalThis.createColony({
    width: 120, height: 80, gridSize: 10, count: 1,
    nest: { x: 60, y: 5 },
    obstacles: [
      { x: 20, y: 0, w: 30, h: 80 },
      { x: 70, y: 0, w: 30, h: 80 }
    ]
  });
  assert.equal(colony.canReach({ x: 60, y: 75 }), true);
  assert.equal(colony.canReach({ x: 35, y: 45 }), false);
});

test('a thin barrier cannot disappear between grid centres', () => {
  const colony = globalThis.createColony({
    width: 100, height: 80, gridSize: 10, count: 1,
    nest: { x: 15, y: 45 },
    obstacles: [{ x: 49, y: 0, w: 2, h: 80 }]
  });
  assert.equal(colony.canReach({ x: 85, y: 45 }), false);
});
