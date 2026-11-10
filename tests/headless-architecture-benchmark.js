// Architecture feasibility probe only: no windows, desktop access or real files.
const fs = require('node:fs');
const path = require('node:path');
require('../renderer/colony.js');

let seed = 9183;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const colony = globalThis.createColony({
  width: 1536, height: 864, gridSize: 10, count: 36,
  nest: { x: 44, y: 94 }, food: { x: 1100, y: 620 }, random,
  obstacles: Array.from({ length: 82 }, (_, i) => ({
    x: 18 + ((i + 1) % 8) * 63, y: 20 + Math.floor((i + 1) / 8) * 71, w: 38, h: 38
  }))
});
for (let i = 0; i < 3600; i++) colony.step(.05);
const start = performance.now(), cpuStart = process.cpuUsage();
let frames = 0, simulatedSeconds = 0, snapshotBytes = 0, traceBytes = 0, workMs = 0;
let peakRss = process.memoryUsage().rss;
const timer = setInterval(() => {
  const frameStart = performance.now();
  colony.step(1 / 60); simulatedSeconds += 1 / 60;
  snapshotBytes += Buffer.byteLength(JSON.stringify(colony.snapshot({
    includePheromone: false, includeExploration: false, includeBestPath: false
  })));
  // A conservative JSON transport estimate, not actual pipe/GPU performance.
  if (frames % 18 === 0) {
    const trails = colony.snapshot({ includePheromone: true, includeExploration: true, includeBestPath: false });
    traceBytes += Buffer.byteLength(JSON.stringify({ food: trails.pheromone, exploration: trails.explorationPheromone }));
  }
  workMs += performance.now() - frameStart;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (++frames < 600) return;
  clearInterval(timer);
  const wallMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
  const result = {
    node: process.version, frames, simulatedSeconds, wallMs, workMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    cpuPercentOneCore: (cpu.user + cpu.system) / (wallMs * 10),
    snapshotKiBPerSecond: snapshotBytes / 1024 / (wallMs / 1000),
    tracesKiBPerSecond: traceBytes / 1024 / (wallMs / 1000),
    memory: process.memoryUsage(), peakRss,
    limitation: 'Headless simulation and JSON serialization only; RSS is not private memory. No native renderer, panel, actual IPC or file service.'
  };
  fs.writeFileSync(path.join(__dirname, '../diagnostics/architecture-headless.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}, 1000 / 60);
