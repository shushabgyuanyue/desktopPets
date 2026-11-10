// Isolated visual workload: real colony algorithm, synthetic obstacles and files.
// No OS paths are opened and no desktop file operations are performed.
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(path.join(root, 'renderer', 'colony.js'));

const width = Math.max(640, Number(process.argv[2]) || 1280);
const height = Math.max(480, Number(process.argv[3]) || 800);
let seed = 73621;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const nest = { x: width - 92, y: height - 112 };
const food = [
  { id: 'preview-near', totalBytes: 96 * 1024, position: { x: width * 0.60, y: height * 0.30 } },
  { id: 'preview-far', totalBytes: 192 * 1024, position: { x: width * 0.32, y: height * 0.69 } }
];

// Regular desktop-like icon spacing leaves several open corridors for scouts.
const obstacles = [];
for (let y = 66; y < height - 170; y += 96) {
  for (let x = 34; x < width * 0.66; x += 90) {
    if (random() < 0.24 || Math.hypot(x - nest.x, y - nest.y) < 130 ||
        food.some((item) => Math.hypot(x - item.position.x, y - item.position.y) < 105)) continue;
    obstacles.push({ x, y, w: 40, h: 48 });
  }
}

const colony = globalThis.createColony({
  width, height, gridSize: 14, count: 36, nest, obstacles, random
});
colony.setFileFoods(food);

let paused = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  for (const command of chunk.trim().split(/\s+/)) {
    if (command === 'pause') paused = true;
    if (command === 'resume') paused = false;
  }
});

let ticks = 0;
const timer = setInterval(() => {
  if (!paused) colony.step(0.05);
  ticks += 1;
  const includeTrails = ticks % 6 === 0;
  const snapshot = colony.snapshot({
    includePheromone: includeTrails,
    includeExploration: includeTrails,
    includeBestPath: false
  });
  const ants = snapshot.ants.map((ant) => [
    ant.id, ant.x, ant.y, ant.angle,
    ant.mode === 'deposit' ? 3 : ant.mode === 'search' ? 0 : 2,
    ant.action === 'cutting' ? 4 : ['sniff', 'survey', 'reorient', 'recover'].includes(ant.action) ? 3 :
      ['sense', 'alert'].includes(ant.action) ? 5 : -1,
    ant.actionProgress, ant.carrying ? 1 : 0,
    ant.payloadKind === 'file' ? 2 : ant.payloadKind === 'food' ? 1 : 0,
    ant.entryProgress, ant.departureProgress
  ]);
  const body = {
    a: ants,
    f: food.map((item) => {
      const progress = snapshot.fileFoods.find((task) => task.id === item.id);
      return [item.position.x, item.position.y, progress?.totalBytes || item.totalBytes,
        progress?.pickedBytes || 0, progress?.deliveredBytes || 0];
    }),
    d: snapshot.discoveries,
    t: snapshot.completedTrips,
    e: snapshot.elapsed
  };
  if (includeTrails) {
    body.x = snapshot.explorationPheromone.map((point) => [point.x, point.y, point.strength]);
    body.p = snapshot.pheromone.map((point) => [point.x, point.y, point.strength]);
  }
  process.stdout.write(JSON.stringify(body) + '\n');
}, 50);

process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });
