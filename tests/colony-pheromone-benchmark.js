// Read-only A/B benchmark on the current desktop icon geometry.
// Usage: node tests/colony-pheromone-benchmark.js [seeds] [seconds] [desktop file name] [--variants=current,baselineNoQuality] [--move]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const seeds = Math.max(1, Number(process.argv[2]) || 20);
const seconds = Math.max(60, Number(process.argv[3]) || 180);
const moveFood = process.argv.includes('--move');
const variantNames = process.argv.find((value) => value.startsWith('--variants='))
  ?.slice('--variants='.length).split(',').filter(Boolean) || ['current', 'baselineNoQuality'];
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'colony.js'), 'utf8');
const rewardStart = '      if (recordCompletedRoute(ant) && ant.payloadKind && ant.trail.length > 1) {';
const rewardEnd = "      ant.mode = 'deposit';";
const hasBuiltInReward = source.includes(rewardStart);
const rewardStartIndex = source.indexOf(rewardStart);
const rewardEndIndex = source.indexOf(rewardEnd, rewardStartIndex);
const removeBuiltInRewardPatch = hasBuiltInReward && rewardEndIndex > rewardStartIndex
  ? [source.slice(rewardStartIndex, rewardEndIndex), '      recordCompletedRoute(ant);\n'] : null;
const diffusionLocation = '      activeExploration.length = write;\n      for (const ant of ants) {';
function diffusionPatch(rate) {
  return [diffusionLocation, `      activeExploration.length = write;
      diffusionClock += dt;
      if (diffusionClock >= 0.5) {
        diffusionClock -= 0.5;
        const additions = new Map();
        for (const id of activePheromone.slice()) {
          const excess = pheromone[id] - BASE_PHEROMONE;
          const spread = excess * ${rate};
          const neighbours = neighbourCounts[id];
          if (spread < 0.001 || !neighbours) continue;
          pheromone[id] -= spread;
          const share = spread / neighbours;
          for (let offset = 0; offset < neighbours; offset += 1) {
            const next = neighbourIds[id * DIRECTIONS.length + offset];
            additions.set(next, (additions.get(next) || 0) + share);
          }
        }
        for (const [id, amount] of additions) depositAt(id, amount);
      }
      for (const ant of ants) {`];
}
const diffusionClockPatch = ['let elapsed = 0;', 'let elapsed = 0;\n    let diffusionClock = 0;'];
const reentryPatch = [
  "if (!ant.visited[id] || (ant.mode === 'search' && sensedSource)) fresh.push(id);",
  "if (!ant.visited[id] || (ant.mode === 'search' && sensedSource) || " +
    "(ant.mode === 'search' && pheromone[id] > BASE_PHEROMONE + 0.08 && " +
    "pheromone[id] > pheromone[ant.cell] * 1.25)) fresh.push(id);"
];
function qualityRewardPatch(rate) {
  if (hasBuiltInReward) {
    return ['ant.deposit * 0.5 * quality', `ant.deposit * ${rate} * quality`];
  }
  return ["    function beginDeposit(ant) {\n      ant.mode = 'deposit';", `    function beginDeposit(ant) {
      if (ant.payloadKind && ant.trail.length > 1) {
        let routeLength = 0;
        for (let index = 1; index < ant.trail.length; index += 1) {
          routeLength += distance(center(ant.trail[index - 1]), center(ant.trail[index]));
        }
        const straight = distance(center(ant.trail[0]), spawnPoint);
        const quality = Math.max(0.1, Math.min(1, straight / Math.max(gridSize, routeLength)));
        for (const id of ant.trail) depositAt(id, ant.deposit * ${rate} * quality);
      }
      ant.mode = 'deposit';`];
}
function lookaheadPatch(rate) {
  return ['const tau = explore ? BASE_PHEROMONE : pheromone[id];', `let forwardTrail = 0;
        if (ant.mode === 'search' && !explore) {
          for (let offset = 0; offset < neighbourCounts[id]; offset += 1) {
            const successor = neighbourIds[id * DIRECTIONS.length + offset];
            if (successor === ant.cell || ant.visited[successor]) continue;
            forwardTrail = Math.max(forwardTrail, pheromone[successor] - BASE_PHEROMONE);
          }
        }
        const tau = explore ? BASE_PHEROMONE : pheromone[id] + ${rate} * forwardTrail;`];
}
const discoveredLengthPatch = [
  '460 / Math.max(gridSize, distance(source.position, spawnPoint))',
  '460 / Math.max(gridSize, knowsNest ? length : distance(source.position, spawnPoint))'
];
const variants = {
  current: [],
  baselineNoQuality: removeBuiltInRewardPatch ? [removeBuiltInRewardPatch] : [],
  noFoodSignal: [['const tau = explore ? BASE_PHEROMONE : pheromone[id];',
    'const tau = BASE_PHEROMONE;']],
  foodHalfLife28s: [['const EVAPORATION_PER_SECOND = 0.085;',
    'const EVAPORATION_PER_SECOND = 0.025;']],
  foodHalfLife28sExplore10s: [
    ['const EVAPORATION_PER_SECOND = 0.085;', 'const EVAPORATION_PER_SECOND = 0.025;'],
    ['const EXPLORATION_EVAPORATION_PER_SECOND = 0.28;',
      'const EXPLORATION_EVAPORATION_PER_SECOND = 0.07;']
  ],
  foodHalfLife28sDiffuse3pct: [
    ['const EVAPORATION_PER_SECOND = 0.085;', 'const EVAPORATION_PER_SECOND = 0.025;'],
    diffusionClockPatch, diffusionPatch(0.03)
  ],
  foodHalfLife28sDiffuse8pct: [
    ['const EVAPORATION_PER_SECOND = 0.085;', 'const EVAPORATION_PER_SECOND = 0.025;'],
    diffusionClockPatch, diffusionPatch(0.08)
  ],
  foodHalfLife28sReentry: [
    ['const EVAPORATION_PER_SECOND = 0.085;', 'const EVAPORATION_PER_SECOND = 0.025;'],
    reentryPatch
  ],
  foodHalfLife28sDiffuse3pctReentry: [
    ['const EVAPORATION_PER_SECOND = 0.085;', 'const EVAPORATION_PER_SECOND = 0.025;'],
    diffusionClockPatch, diffusionPatch(0.03), reentryPatch
  ],
  foodHalfLife17s: [
    ['const EVAPORATION_PER_SECOND = 0.085;', 'const EVAPORATION_PER_SECOND = 0.04;']
  ],
  qualityRewardHalf: [qualityRewardPatch(0.5)],
  qualityRewardOne: [qualityRewardPatch(1)],
  foodHalfLife28sQualityRewardHalf: [
    ['const EVAPORATION_PER_SECOND = 0.085;', 'const EVAPORATION_PER_SECOND = 0.025;'],
    qualityRewardPatch(0.5)
  ],
  lookaheadQuarter: [lookaheadPatch(0.25)],
  lookaheadQuarterQualityRewardHalf: [lookaheadPatch(0.25), qualityRewardPatch(0.5)],
  alphaTwo: [['const ALPHA = 1.6;', 'const ALPHA = 2.0;']],
  discoveredLengthDeposit: [discoveredLengthPatch],
  discoveredLengthDepositQualityRewardHalf: [discoveredLengthPatch, qualityRewardPatch(0.5)],
};

function factory(replacements) {
  let code = source;
  for (const [before, after] of replacements) {
    if (!code.includes(before)) throw new Error(`Benchmark patch target missing: ${before}`);
    code = code.replace(before, after);
  }
  const context = vm.createContext({});
  vm.runInContext(code, context, { filename: 'colony.js' });
  return context.createColony;
}

const icons = JSON.parse(execFileSync('powershell', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(__dirname, '..', 'desktop-icons.ps1')
], { encoding: 'utf8' }));
const bin = icons.find((icon) => icon.isRecycleBin);
if (!bin) throw new Error('Recycle Bin icon is missing');
const targetName = process.argv[4];
const targets = targetName ? icons.filter((icon) => icon.name === targetName) :
  icons.filter((icon) => icon.path && !icon.isFolder && !icon.isRecycleBin)
    .sort((left, right) => Math.hypot(right.x - bin.x, right.y - bin.y) -
      Math.hypot(left.x - bin.x, left.y - bin.y));
if (!targets.length) throw new Error('No suitable target file icon found');
const screen = JSON.parse(execFileSync('powershell', [
  '-NoProfile', '-NonInteractive', '-Command',
  'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds | Select-Object Width,Height | ConvertTo-Json'
], { encoding: 'utf8' }));
const width = screen.Width / (bin.dpiScale || 1);
const height = screen.Height / (bin.dpiScale || 1);
const obstacles = icons.filter((icon) => !icon.isRecycleBin);
const binCenter = { x: bin.x + bin.w / 2, y: bin.y + bin.h / 2 };
const nestCandidates = [
  { x: binCenter.x, y: bin.y - 14 }, { x: bin.x - 14, y: binCenter.y },
  { x: bin.x + bin.w + 14, y: binCenter.y }, { x: binCenter.x, y: bin.y + bin.h + 14 }
];
const inBounds = (point) => point.x >= 14 && point.y >= 14 &&
  point.x <= width - 14 && point.y <= height - 14;
const blocked = (point, items) => items.some((icon) =>
  point.x >= icon.x - 5 && point.x <= icon.x + icon.w + 5 &&
  point.y >= icon.y - 5 && point.y <= icon.y + icon.h + 5);
const nest = nestCandidates.find((point) => inBounds(point) && !blocked(point, obstacles)) ||
  nestCandidates.find(inBounds);
const currentFactory = factory([]);
let food;
let target;
for (const candidateTarget of targets) {
  for (const gap of [16, 26, 40, 58, 80, 112, 160]) {
    const cx = candidateTarget.x + candidateTarget.w / 2;
    const cy = candidateTarget.y + candidateTarget.h / 2;
    const candidates = [
      { x: candidateTarget.x - gap, y: cy }, { x: candidateTarget.x + candidateTarget.w + gap, y: cy },
      { x: cx, y: candidateTarget.y - gap }, { x: cx, y: candidateTarget.y + candidateTarget.h + gap }
    ].sort((left, right) => Math.hypot(left.x - nest.x, left.y - nest.y) -
      Math.hypot(right.x - nest.x, right.y - nest.y));
    food = candidates.find((point) => inBounds(point) && !blocked(point, icons) &&
      currentFactory({ width, height, gridSize: 10, count: 1, nest, obstacles }).canReach(point));
    if (food) {
      target = candidateTarget;
      break;
    }
  }
  if (food) break;
}
if (!food) throw new Error('No reachable food position found');

function seededRandom(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
}
const median = (values) => quantile(values, 0.5);

const results = {};
for (const [name, replacements] of Object.entries(variants)
  .filter(([name]) => variantNames.includes(name))) {
  const createColony = factory(replacements);
  const runs = [];
  const began = performance.now();
  for (let seed = 1; seed <= seeds; seed += 1) {
    const colony = createColony({ width, height, gridSize: 10, count: 36,
      nest, food, obstacles, random: seededRandom(seed) });
    let firstDiscovery = null;
    let firstTrip = null;
    let trips60AfterDiscovery = null;
    let trips60AfterFirstTrip = null;
    let firstTripTrail = null;
    for (let tick = 1; tick <= seconds * 10; tick += 1) {
      colony.step(0.1);
      if (tick % 10) continue;
      const state = colony.snapshot({ includePheromone: false, includeBestPath: false });
      const elapsed = tick / 10;
      if (firstDiscovery === null && state.discoveries) firstDiscovery = elapsed;
      if (firstTrip === null && state.completedTrips) {
        firstTrip = elapsed;
        const trail = colony.snapshot({ includeBestPath: false }).pheromone;
        firstTripTrail = { count: trail.length,
          meanStrength: trail.reduce((sum, trace) => sum + trace.strength, 0) / trail.length };
      }
      if (firstDiscovery !== null && trips60AfterDiscovery === null &&
        elapsed >= firstDiscovery + 60) trips60AfterDiscovery = state.completedTrips;
      if (firstTrip !== null && trips60AfterFirstTrip === null &&
        elapsed >= firstTrip + 60) trips60AfterFirstTrip = state.completedTrips - 1;
    }
    const final = colony.snapshot({ includePheromone: false, includeBestPath: false });
    runs.push({ firstDiscovery, firstTrip, trips60AfterDiscovery, trips60AfterFirstTrip,
      trips: final.completedTrips, discoveries: final.discoveries,
      bestLength: final.bestLength, firstTripTrail });
  }
  results[name] = {
    foundCount: runs.filter((run) => run.firstDiscovery !== null).length,
    firstTripCount: runs.filter((run) => run.firstTrip !== null).length,
    postTripWindowCount: runs.filter((run) => run.trips60AfterFirstTrip !== null).length,
    firstDiscoveryMedian: median(runs.map((run) => run.firstDiscovery)),
    firstDiscoveryP90: quantile(runs.map((run) => run.firstDiscovery), 0.9),
    firstTripMedian: median(runs.map((run) => run.firstTrip)),
    firstTripP90: quantile(runs.map((run) => run.firstTrip), 0.9),
    trips60AfterDiscoveryMedian: median(runs.map((run) => run.trips60AfterDiscovery)),
    trips60AfterFirstTripMedian: median(runs.map((run) => run.trips60AfterFirstTrip)),
    tripsMedian: median(runs.map((run) => run.trips)),
    tripsP10: quantile(runs.map((run) => run.trips), 0.1),
    discoveriesMedian: median(runs.map((run) => run.discoveries)),
    bestLengthMedian: median(runs.map((run) => run.bestLength)),
    firstTripTrailCellsMedian: median(runs.map((run) => run.firstTripTrail?.count)),
    firstTripTrailStrengthMedian: median(runs.map((run) => run.firstTripTrail?.meanStrength)),
    wallMs: Math.round(performance.now() - began)
  };
}

function runMoveProbe() {
  const oldFood = { x: 265, y: 45 };
  const newFood = { x: 265, y: 255 };
  const setupSeconds = 90;
  const observationSeconds = 60;
  const selected = ['current', 'noFoodSignal', 'foodHalfLife28s',
    'qualityRewardHalf', 'discoveredLengthDeposit', 'discoveredLengthDepositQualityRewardHalf'];
  const outcomes = {};
  for (const name of selected) {
    const createColony = factory(variants[name]);
    const runs = [];
    for (let seed = 1; seed <= seeds; seed += 1) {
      const colony = createColony({ width: 320, height: 300, gridSize: 10, count: 36,
        nest: { x: 35, y: 150 }, obstacles: [{ x: 125, y: 120, w: 70, h: 60 }],
        random: seededRandom(seed) });
      colony.setFileFoods([{ id: 'moving-food', totalBytes: 10000000, position: oldFood }]);
      for (let tick = 0; tick < setupSeconds * 10; tick += 1) colony.step(0.1);
      const before = colony.snapshot({ includePheromone: false, includeBestPath: false });
      colony.setFileFoods([{ id: 'moving-food', totalBytes: 10000000, position: newFood }]);
      let firstNewDiscovery = null;
      let oldOccupancy = 0;
      let newOccupancy = 0;
      for (let tick = 1; tick <= observationSeconds * 10; tick += 1) {
        colony.step(0.1);
        if (tick % 10) continue;
        const state = colony.snapshot({ includePheromone: false, includeBestPath: false });
        if (firstNewDiscovery === null && state.discoveries > before.discoveries) {
          firstNewDiscovery = tick / 10;
        }
        if (tick > 200) continue;
        for (const ant of state.ants) {
          if (ant.mode !== 'search') continue;
          if (Math.hypot(ant.x - oldFood.x, ant.y - oldFood.y) < 35) oldOccupancy += 1;
          if (Math.hypot(ant.x - newFood.x, ant.y - newFood.y) < 35) newOccupancy += 1;
        }
      }
      const after = colony.snapshot({ includePheromone: false, includeBestPath: false });
      runs.push({ firstNewDiscovery, oldOccupancy, newOccupancy,
        tripsBeforeMove: before.completedTrips,
        newDiscoveries: after.discoveries - before.discoveries,
        tripsAfterMove: after.completedTrips - before.completedTrips });
    }
    outcomes[name] = {
      establishedTrailCount: runs.filter((run) => run.tripsBeforeMove > 0).length,
      firstNewDiscoveryCount: runs.filter((run) => run.firstNewDiscovery !== null).length,
      firstNewDiscoveryMedian: median(runs.map((run) => run.firstNewDiscovery)),
      oldOccupancyFirst20Median: median(runs.map((run) => run.oldOccupancy)),
      newOccupancyFirst20Median: median(runs.map((run) => run.newOccupancy)),
      newDiscoveriesMedian: median(runs.map((run) => run.newDiscoveries)),
      tripsAfterMoveMedian: median(runs.map((run) => run.tripsAfterMove))
    };
  }
  return { setupSeconds, observationSeconds, oldFood, newFood, outcomes };
}

console.log(JSON.stringify({ icons: icons.length, target: target.name, nest, food, seeds, seconds,
  foodSignalHalfLifeSeconds: Math.log(2) / 0.085,
  explorationHalfLifeSeconds: Math.log(2) / 0.28,
  foodSignalRemainingAfter40s: Math.exp(-0.085 * 40),
  explorationRemainingAfter40s: Math.exp(-0.28 * 40),
  results, movedFood: moveFood ? runMoveProbe() : undefined }, null, 2));
