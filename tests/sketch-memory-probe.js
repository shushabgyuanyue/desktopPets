const { app, BrowserWindow } = require('electron');
const os = require('node:os');
const path = require('node:path');

const legacy = process.argv.includes('--legacy');
const mode = legacy ? 'legacy-atlas' : 'sketch';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.setPath('userData', path.join(os.tmpdir(), `deskAnts-${mode}-memory-probe`));

function memory(label) {
  console.log(JSON.stringify({
    mode, label,
    processes: app.getAppMetrics().map((entry) => ({
      type: entry.type,
      privateMB: Math.round(entry.memory.privateBytes / 1024 * 10) / 10
    }))
  }));
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1536, height: 864, frame: false, show: false, transparent: true,
    webPreferences: { backgroundThrottling: false }
  });
  let failed = false;
  try {
    await window.loadFile(path.join(__dirname,
      legacy ? 'render-smoke.html' : 'sketch-render-smoke.html'));
    await window.webContents.executeJavaScript(`(() => {
      const renderer = ${legacy ? 'createGroupedAntAtlasRenderer' : 'createSketchAntRenderer'}(
        document.getElementById('ants'));
      renderer.resize(1536, 864, 1.25);
      const ants = Array.from({ length: 36 }, (_, id) => ({
        id, x: 60 + id % 9 * 150, y: 80 + Math.floor(id / 9) * 180,
        angle: id * 0.17, carrying: id % 4 === 0,
        payloadKind: id % 8 === 0 ? 'file' : 'food'
      }));
      window.probeRenderer = renderer;
      window.probeTimer = setInterval(() => {
        ants.forEach((ant) => { ant.x += 0.25; });
        renderer.render(ants, [], performance.now(), true);
      }, 16);
    })()`);
    await pause(3500);
    memory('visible');
    console.log(JSON.stringify({ mode,
      stats: await window.webContents.executeJavaScript('window.probeRenderer.stats()') }));
    await window.webContents.executeJavaScript('window.probeRenderer.setVisible(false)');
    await pause(2500);
    memory('hidden');
    await window.webContents.executeJavaScript('window.probeRenderer.setVisible(true)');
    await pause(2500);
    memory('restored');
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    await window.webContents.executeJavaScript(
      'clearInterval(window.probeTimer); window.probeRenderer?.dispose()');
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
