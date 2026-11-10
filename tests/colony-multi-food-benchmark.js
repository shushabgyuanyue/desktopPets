// Deterministic, read-only multi-food foraging benchmark.
// Usage: node tests/colony-multi-food-benchmark.js [seeds] [seconds] [--scenarios=near-depletes,far-only]
const { performance } = require('node:perf_hooks');

require('../renderer/colony.js');
const createColony = globalThis.createColony;

const seeds = Math.max(1, Number(process.argv[2]) || 12);
const seconds = Math.max(60, Number(process.argv[3]) || 180);
const selectedScenarios = process.argv.find((value) => value.startsWith('--scenarios='))
  ?.slice('--scenarios='.length).split(',').filter(Boolean);
const scenarios = [
  {
    name: 'balanced', width: 640, height: 480,
    nest: { x: 35, y: 235 },
    obstacles: [{ x: 145, y: 175, w: 42, h: 115 }],
    foods: [
      { id: 'upper', x: 285, y: 95 },
      { id: 'lower', x: 285, y: 385 }
    ]
  },
  {
    name: 'near-far', width: 640, height: 480,
    nest: { x: 35, y: 235 },
    obstacles: [{ x: 265, y: 125, w: 38, h: 230 }],
    foods: [
      { id: 'near', x: 175, y: 105 },
      { id: 'far', x: 545, y: 385 }
    ]
  },
  {
    name: 'far-only', width: 640, height: 480,
    nest: { x: 35, y: 235 },
    obstacles: [{ x: 265, y: 125, w: 38, h: 230 }],
    foods: [{ id: 'far', x: 545, y: 385 }]
  },
  {
    name: 'late-far', width: 640, height: 480,
    nest: { x: 35, y: 235 },
    obstacles: [{ x: 265, y: 125, w: 38, h: 230 }],
    foods: [
      { id: 'near', x: 175, y: 105 },
      { id: 'far', x: 545, y: 385, introducedAt: 60 }
    ]
  },
  {
    name: 'near-depletes', width: 640, height: 480,
    nest: { x: 35, y: 235 },
    obstacles: [{ x: 265, y: 125, w: 38, h: 230 }],
    foods: [
      { id: 'near', x: 175, y: 105, totalBytes: 128 * 1024 },
      { id: 'far', x: 545, y: 385, introducedAt: 30 }
    ]
  },
  {
    name: 'finite-file-only', width: 640, height: 480,
    nest: { x: 35, y: 235 },
    obstacles: [{ x: 265, y: 125, w: 38, h: 230 }],
    foods: [{ id: 'far-file', x: 545, y: 385, totalBytes: 64 * 1024 }]
  },
  {
    name: 'ordinary-plus-file', width: 640, height: 480,
    nest: { x: 35, y: 235 },
    obstacles: [{ x: 265, y: 125, w: 38, h: 230 }],
    ordinaryFood: { x: 175, y: 105 },
    foods: [{ id: 'far-file', x: 545, y: 385, totalBytes: 64 * 1024 }]
  }
];

function seededRandom(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
}

function rounded(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

const startedAt = performance.now();
let peakRssBytes = process.memoryUsage.rss();

function run(scenario, seed) {
  const colony = createColony({
    width: scenario.width, height: scenario.height, gridSize: 10, count: 36,
    nest: scenario.nest, food: scenario.ordinaryFood || null,
    obstacles: scenario.obstacles, random: seededRandom(seed)
  });
  const taskFor = (food) => ({
    id: food.id, totalBytes: food.totalBytes || 1_000_000_000,
    position: { x: food.x, y: food.y }
  });
  colony.setFileFoods(scenario.foods.filter((food) => !food.introducedAt).map(taskFor));
  const records = Object.fromEntries(scenario.foods.map(({ id }) => [id, {
    firstPickup: null, fifthPickup: null, firstDelivery: null,
    pickupTimes: [], deliveryTimes: [], routes: []
  }]));
  const previousPicked = Object.fromEntries(scenario.foods.map(({ id }) => [id, 0]));
  const previousDelivered = Object.fromEntries(scenario.foods.map(({ id }) => [id, 0]));
  const carrying = new Map();

  for (let tick = 1; tick <= seconds * 10; tick += 1) {
    if (tick % 100 === 0) peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
    if (scenario.foods.some((food) => food.introducedAt * 10 === tick)) {
      colony.setFileFoods(scenario.foods.filter((food) =>
        !food.introducedAt || food.introducedAt * 10 <= tick).map(taskFor));
    }
    colony.step(0.1);
    const time = tick / 10;
    const snapshot = colony.snapshot({ includePheromone: false, includeBestPath: false });
    for (const task of snapshot.fileFoods) {
      const record = records[task.id];
      for (let count = previousPicked[task.id]; count < task.pickedChunks; count += 1) {
        record.pickupTimes.push(time);
      }
      for (let count = previousDelivered[task.id]; count < task.deliveredChunks; count += 1) {
        record.deliveryTimes.push(time);
      }
      previousPicked[task.id] = task.pickedChunks;
      previousDelivered[task.id] = task.deliveredChunks;
    }
    for (const ant of snapshot.ants) {
      const previous = carrying.get(ant.id);
      if (ant.carrying && ant.payloadTaskId && records[ant.payloadTaskId]) {
        if (!previous || previous.id !== ant.payloadTaskId) {
          carrying.set(ant.id, { id: ant.payloadTaskId, x: ant.x, y: ant.y, length: 0 });
        } else {
          previous.length += Math.hypot(ant.x - previous.x, ant.y - previous.y);
          previous.x = ant.x;
          previous.y = ant.y;
        }
      } else if (previous) {
        if (ant.mode === 'deposit' && ant.payloadTaskId === previous.id) {
          previous.length += Math.hypot(ant.x - previous.x, ant.y - previous.y);
          records[previous.id].routes.push(previous.length);
        }
        carrying.delete(ant.id);
      }
    }
  }
  for (const record of Object.values(records)) {
    record.firstPickup = record.pickupTimes[0] ?? null;
    record.fifthPickup = record.pickupTimes[4] ?? null;
    record.firstDelivery = record.deliveryTimes[0] ?? null;
  }
  return records;
}

const report = {};
for (const scenario of scenarios.filter(({ name }) =>
  !selectedScenarios || selectedScenarios.includes(name))) {
  const runs = Array.from({ length: seeds }, (_, index) => run(scenario, index + 1));
  report[scenario.name] = Object.fromEntries(scenario.foods.map(({ id }) => {
    const records = runs.map((run) => run[id]);
    const earlyRoutes = records.map((record) => median(record.routes.slice(0, 5)));
    const lateRoutes = records.map((record) => median(record.routes.slice(-5)));
    return [id, {
      foundSeeds: records.filter((record) => record.firstPickup !== null).length,
      deliveredSeeds: records.filter((record) => record.firstDelivery !== null).length,
      firstPickupMedian: rounded(median(records.map((record) => record.firstPickup))),
      firstPickupAfterIntroductionMedian: rounded(median(records.map((record) =>
        record.firstPickup === null ? null : record.firstPickup - (scenario.foods.find((food) => food.id === id).introducedAt || 0)))),
      firstDeliveryMedian: rounded(median(records.map((record) => record.firstDelivery))),
      timeToFifthPickupMedian: rounded(median(records.map((record) =>
        record.fifthPickup === null ? null : record.fifthPickup - record.firstPickup))),
      pickups30AfterFirstDeliveryMedian: median(records.map((record) =>
        record.firstDelivery === null ? null : record.pickupTimes.filter((time) =>
          time > record.firstDelivery && time <= record.firstDelivery + 30).length)),
      pickupsMedian: median(records.map((record) => record.pickupTimes.length)),
      deliveriesMedian: median(records.map((record) => record.deliveryTimes.length)),
      earlyHomeRouteMedian: rounded(median(earlyRoutes)),
      lateHomeRouteMedian: rounded(median(lateRoutes))
    }];
  }));
  if (scenario.name === 'near-depletes') {
    const exhaustIndex = scenario.foods[0].totalBytes / 1024 - 1;
    const exhaustion = runs.map((run) => run.near.pickupTimes[exhaustIndex] ?? null);
    report[scenario.name].handoff = {
      nearExhaustedSeeds: exhaustion.filter(Number.isFinite).length,
      nearExhaustedAtMedian: rounded(median(exhaustion)),
      farPickups30AfterNearExhaustMedian: median(runs.map((run, index) =>
        exhaustion[index] === null ? null : run.far.pickupTimes.filter((time) =>
          time > exhaustion[index] && time <= exhaustion[index] + 30).length)),
      farPickups60AfterNearExhaustMedian: median(runs.map((run, index) =>
        exhaustion[index] === null ? null : run.far.pickupTimes.filter((time) =>
          time > exhaustion[index] && time <= exhaustion[index] + 60).length))
    };
  }
}
peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
console.log(JSON.stringify({ seeds, seconds, wallMs: Math.round(performance.now() - startedAt),
  peakRssMB: rounded(peakRssBytes / 1024 / 1024), report }, null, 2));
