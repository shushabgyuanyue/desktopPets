const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const direct = process.argv.includes('--direct');
const atlasSize = process.argv.includes('--size640') ? 640 : 512;

const icons = JSON.parse(execFileSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(__dirname, '..', 'desktop-icons.ps1')
], { encoding: 'utf8', timeout: 15000 }));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1536, height: 864, show: false, transparent: true,
    webPreferences: { backgroundThrottling: false }
  });
  try {
    await window.loadFile(path.join(__dirname, 'ant-atlas-workload.html'));
    const result = await window.webContents.executeJavaScript(`(() => {
      const icons = ${JSON.stringify(icons)};
      let seed = 17;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const colony = createColony({ width: 1536, height: 864, gridSize: 10,
        count: 36, nest: { x: 82, y: 37.6 }, food: { x: 680.8, y: 271.2 },
        obstacles: icons.filter((icon) => !icon.isRecycleBin), random });
      colony.setFileFood({ id: 'workload', totalBytes: 60_708_140 });
      const renderer = ${direct ? 'createAntRenderer' : 'createGroupedAntAtlasRenderer'}(
        document.getElementById('ants'), { atlasSize: ${atlasSize} });
      renderer.resize(1536, 864, 1.25);
      const times = [];
      const pages = {};
      let fallbacks = 0;
      let tiledFrames = 0;
      let maxTiles = 0;
      for (let tick = 0; tick < 7200; tick += 1) {
        colony.step(0.05);
        if (tick % 60 !== 59) continue;
        const before = performance.now();
        renderer.render(colony.snapshot().ants, icons, tick * 50, true);
        times.push(performance.now() - before);
        const stats = renderer.stats();
        pages[stats.atlasPages] = (pages[stats.atlasPages] || 0) + 1;
        if (stats.fallback) fallbacks += 1;
        if (stats.atlasTiles) tiledFrames += 1;
        maxTiles = Math.max(maxTiles, stats.atlasTiles || 0);
      }
      times.sort((a, b) => a - b);
      const result = {
        iconCount: icons.length, frames: times.length, fallbacks, tiledFrames,
        maxTiles, pages,
        p50Ms: times[Math.floor(times.length * 0.5)],
        p95Ms: times[Math.floor(times.length * 0.95)],
        maxMs: times[times.length - 1],
        deliveredBytes: colony.snapshot().fileFood.deliveredBytes
      };
      renderer.dispose();
      return result;
    })()`);
    console.log(JSON.stringify({ mode: direct ? 'direct' : 'atlas', atlasSize, ...result }));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window.close();
    app.exit(process.exitCode || 0);
  }
});
