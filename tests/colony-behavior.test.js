const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/colony.js');

function seededRandom(seed = 7) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function fileColony() {
  const colony = globalThis.createColony({
    width: 160, height: 120, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, food: { x: 45, y: 25 }, random: seededRandom()
  });
  colony.setFileFood({ id: 'first', totalBytes: 2048 });
  return colony;
}

function reachCutting(colony) {
  for (let tick = 0; tick < 4000; tick += 1) {
    colony.step(0.05);
    const snapshot = colony.snapshot();
    if (snapshot.ants[0].action === 'cutting') return snapshot;
  }
  assert.fail('the ant did not begin cutting at the food');
}

test('a file slice is picked only after the ant visibly cuts food', () => {
  const colony = fileColony();
  const atFood = reachCutting(colony);
  const start = atFood.ants[0];
  assert.ok(Math.hypot(start.x - 45, start.y - 25) < 0.5);
  assert.equal(start.carrying, false);
  assert.equal(atFood.fileFood.pickedChunks, 0);
  assert.equal(atFood.fileFood.pickedBytes, 0);
  assert.ok(start.actionProgress >= 0 && start.actionProgress <= 1);

  for (let tick = 0; tick < 6; tick += 1) colony.step(0.05);
  const cutting = colony.snapshot();
  assert.equal(cutting.ants[0].action, 'cutting');
  assert.ok(cutting.ants[0].actionProgress > start.actionProgress);
  assert.ok(Math.hypot(cutting.ants[0].x - start.x, cutting.ants[0].y - start.y) < 0.01);
  assert.equal(cutting.fileFood.pickedChunks, 0);
  assert.equal(cutting.fileFood.pickedBytes, 0);

  let picked;
  for (let tick = 0; tick < 30; tick += 1) {
    colony.step(0.05);
    picked = colony.snapshot();
    if (picked.fileFood.pickedChunks > 0) break;
  }
  assert.equal(picked.fileFood.pickedChunks, 1);
  assert.ok(picked.fileFood.pickedBytes > 0);
  assert.ok(picked.elapsed - atFood.elapsed >= 0.7);
  assert.ok(picked.elapsed - atFood.elapsed <= 1.25);
  assert.equal(picked.ants[0].action, null);
  assert.equal(picked.ants[0].carrying, true);
  colony.step(0.05);
  assert.equal(colony.snapshot().fileFood.pickedChunks, 1);
});

test('nearby ants cannot reserve more cutting work than the remaining file slices', () => {
  const colony = globalThis.createColony({
    width: 100, height: 80, gridSize: 10, count: 36,
    nest: { x: 15, y: 15 }, food: { x: 35, y: 15 }, random: seededRandom(17)
  });
  colony.setFileFood({ id: 'two-slices', totalBytes: 2 });
  let maxCutters = 0;
  let progress;
  for (let tick = 0; tick < 6000; tick += 1) {
    colony.step(0.05);
    const snapshot = colony.snapshot();
    progress = snapshot.fileFood;
    const cutters = snapshot.ants.filter((ant) => ant.action === 'cutting').length;
    maxCutters = Math.max(maxCutters, cutters);
    assert.ok(progress.pickedChunks + cutters <= progress.chunkCount);
    if (progress.deliveredBytes === 2) break;
  }
  assert.ok(maxCutters > 0);
  assert.equal(progress.pickedChunks, 2);
  assert.equal(progress.deliveredChunks, 2);
  assert.equal(progress.deliveredBytes, 2);
});

test('moving food cancels cutting without picking a stale slice', () => {
  const colony = fileColony();
  reachCutting(colony);
  colony.setTerrain({ food: { x: 115, y: 85 } });
  const moved = colony.snapshot();
  assert.equal(moved.ants[0].action, null);
  assert.equal(moved.ants[0].carrying, false);
  assert.equal(moved.fileFood.pickedChunks, 0);
  assert.equal(moved.fileFood.pickedBytes, 0);
  for (let tick = 0; tick < 10; tick += 1) colony.step(0.05);
  assert.equal(colony.snapshot().fileFood.pickedChunks, 0);
});

test('covering food with an icon interrupts cutting', () => {
  const colony = fileColony();
  reachCutting(colony);
  colony.setTerrain({ obstacles: [{ x: 35, y: 15, w: 20, h: 20 }] });
  const covered = colony.snapshot();
  assert.equal(covered.ants[0].action, null);
  assert.equal(covered.fileFood.pickedChunks, 0);
  assert.equal(covered.fileFood.pickedBytes, 0);
  for (let tick = 0; tick < 25; tick += 1) colony.step(0.05);
  assert.equal(colony.snapshot().fileFood.pickedChunks, 0);
});

test('cancelling or replacing a file task abandons cutting', () => {
  for (const replacement of [null, { id: 'second', totalBytes: 4096 }]) {
    const colony = fileColony();
    reachCutting(colony);
    colony.setFileFood(replacement);
    const afterChange = colony.snapshot();
    assert.equal(afterChange.ants[0].action, null);
    assert.equal(afterChange.ants[0].carrying, false);
    if (replacement) {
      assert.equal(afterChange.fileFood.id, 'second');
      assert.equal(afterChange.fileFood.pickedChunks, 0);
      assert.equal(afterChange.fileFood.pickedBytes, 0);
      colony.step(0.05);
      assert.equal(colony.snapshot().fileFood.pickedChunks, 0);
    } else {
      assert.equal(afterChange.fileFood, null);
    }
  }
});

test('sniffing pauses the explorer in place and resumes its search', () => {
  const colony = globalThis.createColony({
    width: 240, height: 180, gridSize: 10, count: 36,
    nest: { x: 25, y: 25 }, random: seededRandom(29)
  });
  let sniffing;
  let antId;
  for (let tick = 0; tick < 6000; tick += 1) {
    colony.step(0.05);
    const snapshot = colony.snapshot();
    const candidate = snapshot.ants.find((ant) => ant.action === 'sniff' &&
      ant.actionProgress <= 0.2 && Math.hypot(ant.x - 25, ant.y - 25) > 35);
    if (candidate) {
      sniffing = snapshot;
      antId = candidate.id;
      break;
    }
  }
  assert.ok(sniffing, 'an exploring ant should sometimes stop to sniff');
  const start = sniffing.ants[antId];
  for (let tick = 0; tick < 3; tick += 1) colony.step(0.05);
  const during = colony.snapshot();
  const paused = during.ants[antId];
  assert.equal(paused.action, 'sniff');
  assert.ok(paused.actionProgress > start.actionProgress);
  assert.ok(Math.hypot(paused.x - start.x, paused.y - start.y) < 0.01);

  let resumed;
  for (let tick = 0; tick < 50; tick += 1) {
    colony.step(0.05);
    resumed = colony.snapshot();
    if (resumed.ants[antId].action === null &&
      Math.hypot(resumed.ants[antId].x - start.x, resumed.ants[antId].y - start.y) > 1) break;
  }
  const searching = resumed.ants[antId];
  assert.equal(searching.action, null);
  assert.equal(searching.mode, 'search');
  assert.ok(Math.hypot(searching.x - start.x, searching.y - start.y) > 1);
  assert.ok(Math.hypot(searching.x - start.x, searching.y - start.y) < 40);
});

test('a moved icon makes an interrupted explorer pause to inspect its new route', () => {
  const colony = globalThis.createColony({
    width: 220, height: 160, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, random: seededRandom(41)
  });
  let before;
  for (let tick = 0; tick < 300; tick += 1) {
    colony.step(0.05);
    before = colony.snapshot().ants[0];
    if (Math.hypot(before.x - 25, before.y - 25) > 45) break;
  }
  assert.ok(Math.hypot(before.x - 25, before.y - 25) > 45);
  colony.setTerrain({ obstacles: [{ x: before.x - 3, y: before.y - 3, w: 6, h: 6 }] });
  const interrupted = colony.snapshot().ants[0];
  assert.equal(interrupted.action, 'sniff');
  colony.step(0.05);
  const inspecting = colony.snapshot().ants[0];
  assert.equal(inspecting.action, 'sniff');
  assert.ok(Math.hypot(inspecting.x - interrupted.x, inspecting.y - interrupted.y) < 0.01);
});

test('the first food scent pauses its finder and briefly alerts only nearby explorers', () => {
  const colony = globalThis.createColony({
    width: 420, height: 180, gridSize: 10, count: 6,
    nest: { x: 25, y: 25 }, food: { x: 75, y: 25 }, random: seededRandom(11)
  });
  colony.step(0.05);
  const first = colony.snapshot({ includePheromone: false });
  assert.equal(first.ants.filter((ant) => ant.action === 'sense').length, 1);
  assert.equal(first.ants.filter((ant) => ant.action === 'alert').length, 5);
  assert.equal(first.discoveries, 0);
  for (let tick = 0; tick < 20; tick += 1) colony.step(0.05);
  assert.ok(colony.snapshot({ includePheromone: false }).ants.some((ant) => ant.action !== 'alert'));
});

test('food near the nest does not stop the whole colony at once', () => {
  const colony = globalThis.createColony({
    width: 420, height: 180, gridSize: 10, count: 36,
    nest: { x: 25, y: 25 }, food: { x: 75, y: 25 }, random: seededRandom(11)
  });
  colony.step(0.05);
  const ants = colony.snapshot({ includePheromone: false }).ants;
  assert.equal(ants.filter((ant) => ant.action === 'sense').length, 1);
  assert.ok(ants.filter((ant) => ant.action === 'alert').length <= 6);
  assert.ok(ants.filter((ant) => ant.action === null).length >= 29);
});

test('a first-arrival survey precedes cutting and does not pick a slice', () => {
  const colony = fileColony();
  let surveyed;
  for (let tick = 0; tick < 4000; tick += 1) {
    colony.step(0.05);
    surveyed = colony.snapshot({ includePheromone: false });
    if (surveyed.ants[0].action === 'survey') break;
  }
  assert.equal(surveyed.ants[0].action, 'survey');
  assert.equal(surveyed.fileFood.pickedChunks, 0);
  const cutting = reachCutting(colony);
  assert.equal(cutting.fileFood.pickedChunks, 0);
});

test('a carrier travels more slowly than the same ant while searching', () => {
  const colony = globalThis.createColony({
    width: 180, height: 110, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, food: { x: 105, y: 25 }, random: seededRandom(7)
  });
  const speeds = { search: [], homing: [] };
  let previous = colony.snapshot({ includePheromone: false }).ants[0];
  for (let tick = 0; tick < 5000; tick += 1) {
    colony.step(0.01);
    const state = colony.snapshot({ includePheromone: false });
    const ant = state.ants[0];
    if (ant.mode === previous.mode && ant.action === null && previous.action === null &&
      (ant.mode === 'search' || ant.mode === 'homing')) {
      const motion = Math.hypot(ant.x - previous.x, ant.y - previous.y);
      if (motion > 0.1) speeds[ant.mode].push(motion);
    }
    previous = ant;
    if (speeds.search.length > 20 && speeds.homing.length > 20) break;
  }
  assert.ok(speeds.search.length > 20 && speeds.homing.length > 20);
  assert.ok(Math.max(...speeds.homing) < Math.max(...speeds.search) * 0.82);
});

test('a trapped explorer turns before backtracking from a dead end', () => {
  const colony = globalThis.createColony({
    width: 90, height: 70, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, random: seededRandom(3),
    obstacles: [
      { x: 10, y: 20, w: 10, h: 10 },
      { x: 20, y: 10, w: 20, h: 10 },
      { x: 20, y: 30, w: 20, h: 10 },
      { x: 40, y: 20, w: 10, h: 10 }
    ]
  });
  let recovering;
  for (let tick = 0; tick < 100; tick += 1) {
    colony.step(0.05);
    recovering = colony.snapshot({ includePheromone: false }).ants[0];
    if (recovering.action === 'recover') break;
  }
  assert.equal(recovering.action, 'recover');
  assert.ok(recovering.x > 30);
});

test('moving a file source makes a nearby searcher look around without resetting work', () => {
  const colony = globalThis.createColony({
    width: 180, height: 100, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, random: seededRandom(5)
  });
  colony.setFileFoods([{ id: 'moving', totalBytes: 4096, position: { x: 95, y: 25 } }]);
  const before = colony.snapshot({ includePheromone: false });
  colony.setFileFoods([{ id: 'moving', totalBytes: 4096, position: { x: 105, y: 25 } }]);
  const after = colony.snapshot({ includePheromone: false });
  assert.equal(after.elapsed, before.elapsed);
  assert.equal(after.ants[0].action, 'reorient');
  assert.equal(after.fileFoods[0].pickedBytes, before.fileFoods[0].pickedBytes);
});

test('moving ordinary food also prompts a nearby searcher to look around', () => {
  const colony = globalThis.createColony({
    width: 180, height: 100, gridSize: 10, count: 1,
    nest: { x: 25, y: 25 }, food: { x: 95, y: 25 }, random: seededRandom(5)
  });
  colony.setTerrain({ food: { x: 105, y: 25 } });
  assert.equal(colony.snapshot({ includePheromone: false }).ants[0].action, 'reorient');
});
