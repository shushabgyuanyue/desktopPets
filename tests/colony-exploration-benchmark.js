// Usage: node tests/colony-exploration-benchmark.js [seedCount] [maxSeconds] [fileName]
// Reads desktop icon positions and runs deterministic simulations. It never changes files.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

require('../renderer/colony.js');

const seedCount = Math.max(1, Number(process.argv[2]) || 30);
const maxSeconds = Math.max(1, Number(process.argv[3]) || 180);
const fileName = process.argv[4] || '录音机-20点22分.wav';
const probe = path.join(__dirname, '..', 'desktop-icons.ps1');
const icons = JSON.parse(execFileSync('powershell', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe
], { encoding: 'utf8' }));
const target = icons.find((icon) => icon.name === fileName);
const recycleBin = icons.find((icon) => icon.isRecycleBin);
if (!target || !recycleBin) throw new Error('Target file icon or recycle bin was not found on the desktop');

const screen = JSON.parse(execFileSync('powershell', [
  '-NoProfile', '-NonInteractive', '-Command',
  'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds | Select-Object Width,Height | ConvertTo-Json'
], { encoding: 'utf8' }));
const scale = recycleBin.dpiScale || 1;
const width = screen.Width / scale;
const height = screen.Height / scale;
const obstacles = icons.filter((icon) => !icon.isRecycleBin);
const blocked = (point) => icons.some((icon) =>
  point.x >= icon.x - 5 && point.x <= icon.x + icon.w + 5 &&
  point.y >= icon.y - 5 && point.y <= icon.y + icon.h + 5);
const binBlocked = (point) => obstacles.some((icon) =>
  point.x >= icon.x - 5 && point.x <= icon.x + icon.w + 5 &&
  point.y >= icon.y - 5 && point.y <= icon.y + icon.h + 5);

const cx = recycleBin.x + recycleBin.w / 2;
const cy = recycleBin.y + recycleBin.h / 2;
const nestCandidates = [
  { x: cx, y: recycleBin.y - 14 },
  { x: recycleBin.x - 14, y: cy },
  { x: recycleBin.x + recycleBin.w + 14, y: cy },
  { x: cx, y: recycleBin.y + recycleBin.h + 14 }
];
const inBounds = (point) => point.x >= 14 && point.y >= 14 &&
  point.x <= width - 14 && point.y <= height - 14;
const nest = nestCandidates.find((point) => inBounds(point) && !binBlocked(point)) ||
  nestCandidates.find(inBounds) || nestCandidates[0];

let food = null;
for (const gap of [16, 26, 40, 58, 80, 112, 160]) {
  const tx = target.x + target.w / 2;
  const ty = target.y + target.h / 2;
  const candidates = [
    { x: target.x - gap, y: ty }, { x: target.x + target.w + gap, y: ty },
    { x: tx, y: target.y - gap }, { x: tx, y: target.y + target.h + gap },
    { x: target.x - gap, y: target.y - gap },
    { x: target.x + target.w + gap, y: target.y - gap },
    { x: target.x - gap, y: target.y + target.h + gap },
    { x: target.x + target.w + gap, y: target.y + target.h + gap }
  ];
  candidates.sort((left, right) =>
    Math.hypot(left.x - nest.x, left.y - nest.y) - Math.hypot(right.x - nest.x, right.y - nest.y));
  food = candidates.find((point) => inBounds(point) && !blocked(point) &&
    globalThis.createColony({ width, height, gridSize: 10, count: 1, nest, obstacles })
      .canReach(point));
  if (food) break;
}
if (!food) throw new Error('No reachable food point was found beside the target icon');

function seededRandom(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const times = [];
const tripTimes = [];
const deliveredTrips = [];
const bestLengths = [];
const delta = 0.1;
for (let seed = 1; seed <= seedCount; seed += 1) {
  const colony = globalThis.createColony({
    width, height, gridSize: 10, count: 36, nest, food, obstacles,
    random: seededRandom(seed)
  });
  let foundAt = null;
  let tripAt = null;
  for (let tick = 1; tick <= maxSeconds / delta; tick += 1) {
    colony.step(delta);
    if (tick % 10 === 0) {
      const snapshot = colony.snapshot({ includePheromone: false, includeBestPath: false });
      if (foundAt === null && snapshot.discoveries > 0) foundAt = tick * delta;
      if (tripAt === null && snapshot.completedTrips > 0) tripAt = tick * delta;
    }
  }
  times.push(foundAt);
  tripTimes.push(tripAt);
  const final = colony.snapshot({ includePheromone: false, includeBestPath: false });
  deliveredTrips.push(final.completedTrips);
  bestLengths.push(final.bestLength);
}

const quantile = (values, fraction) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length !== values.length) return null;
  return sorted[Math.ceil(fraction * sorted.length) - 1];
};
console.log(JSON.stringify({
  icons: icons.length, target: fileName, nest, food, seeds: seedCount,
  maxSeconds, found: times.filter((time) => time !== null).length,
  median: quantile(times, 0.5), p95: quantile(times, 0.95),
  max: quantile(times, 1), times,
  firstTripMedian: quantile(tripTimes, 0.5),
  firstTripP95: quantile(tripTimes, 0.95),
  deliveredTripsMedian: quantile(deliveredTrips, 0.5),
  bestLengthMedian: quantile(bestLengths, 0.5)
}, null, 2));
