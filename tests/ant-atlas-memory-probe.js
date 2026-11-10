const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');

const direct = process.argv.includes('--direct');
const atlasSize = process.argv.includes('--size640') ? 640 : 512;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.setPath('userData', path.join(os.tmpdir(), 'deskAnts-atlas-memory-probe'));

function memory(label) {
  console.log(JSON.stringify({
    mode: direct ? 'direct' : 'atlas', atlasSize, label,
    processes: app.getAppMetrics().map((entry) => ({
      type: entry.type,
      privateMB: Math.round(entry.memory.privateBytes / 1024 * 10) / 10
    }))
  }));
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1536, height: 864, show: false, frame: false, transparent: true,
    webPreferences: { backgroundThrottling: false }
  });
  try {
    await window.loadFile(path.join(__dirname, 'render-smoke.html'));
    await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('ants');
      const renderer = ${direct ? 'createAntRenderer' : 'createGroupedAntAtlasRenderer'}(
        canvas, { atlasSize: ${atlasSize} });
      renderer.resize(1536, 864, 1.25);
      const ants = Array.from({ length: 36 }, (_, id) => ({
        id, x: 60 + id % 9 * 150, y: 80 + Math.floor(id / 9) * 180,
        angle: id * 0.17, carrying: id % 4 === 0,
        payloadKind: id % 8 === 0 ? 'file' : 'food', payloadBytes: 1024
      }));
      window.probeRenderer = renderer;
      window.probeTimer = setInterval(() => {
        ants.forEach((ant) => { ant.x += 0.1; });
        renderer.render(ants, [], performance.now(), true);
      }, 16);
    })()`);
    await pause(5000);
    memory('initial');
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await window.webContents.executeJavaScript('window.probeRenderer.setVisible(false)');
      await pause(3000);
      memory(`hidden-${cycle}`);
      await window.webContents.executeJavaScript('window.probeRenderer.setVisible(true)');
      await pause(3000);
      memory(`restored-${cycle}`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await window.webContents.executeJavaScript('clearInterval(window.probeTimer); window.probeRenderer.dispose()');
    window.close();
    app.exit(process.exitCode || 0);
  }
});
