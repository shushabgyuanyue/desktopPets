const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function memorySnapshot(label) {
  const processes = app.getAppMetrics().map((entry) => ({
    type: entry.type,
    pid: entry.pid,
    workingMB: Math.round(entry.memory?.workingSetSize / 1024 * 10) / 10,
    privateMB: Math.round(entry.memory?.privateBytes / 1024 * 10) / 10
  }));
  console.log(JSON.stringify({ label, processes }));
}

app.whenReady().then(async () => {
  const samples = process.argv.includes('--native-msaa') || process.argv.includes('--no-msaa') ? 0 : 2;
  const antialias = samples === 0 && !process.argv.includes('--no-msaa');
  const cycles = Number(process.argv.find((arg) => arg.startsWith('--cycles='))?.split('=')[1]) || 3;
  const hiddenMs = Number(process.argv.find((arg) => arg.startsWith('--hidden-ms='))?.split('=')[1]) || 3000;
  const window = new BrowserWindow({
    width: 1536, height: 864, frame: false, show: false, transparent: true,
    webPreferences: { backgroundThrottling: false }
  });
  try {
    await window.loadFile(path.join(__dirname, 'render-smoke.html'));
    await window.webContents.executeJavaScript(`(() => {
      const renderer = createAntRenderer(document.getElementById('ants'), {
        antialias: ${antialias}, msaaSamples: ${samples}
      });
      renderer.resize(1536, 864, 1.25);
      const ants = Array.from({ length: 36 }, (_, id) => ({
        id, x: 60 + id % 9 * 150, y: 80 + Math.floor(id / 9) * 180,
        angle: id * 0.17, carrying: id % 4 === 0,
        payloadKind: id % 8 === 0 ? 'file' : 'food', payloadBytes: 1024
      }));
      window.probeRenderer = renderer;
      window.probeTimer = setInterval(() =>
        renderer.render(ants, [], performance.now(), true), 16);
    })()`);
    await sleep(5000);
    memorySnapshot('full');
    if (process.argv.includes('--capture')) {
      const screenshot = await window.webContents.capturePage();
      const imagePath = path.join(process.env.TEMP || __dirname,
        `deskAnts-render-${samples ? 'msaa2' : antialias ? 'msaa' : 'no-msaa'}.png`);
      await fs.writeFile(imagePath, screenshot.toPNG());
      console.log(JSON.stringify({ imagePath }));
    }
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      await window.webContents.executeJavaScript('window.probeRenderer.setVisible(false)');
      await sleep(hiddenMs);
      memorySnapshot(`hidden-${cycle}`);
      await window.webContents.executeJavaScript('window.probeRenderer.setVisible(true)');
      await sleep(3000);
      memorySnapshot(`restored-${cycle}`);
    }
  } catch (error) {
    console.error(error);
  } finally {
    await window.webContents.executeJavaScript('clearInterval(window.probeTimer); window.probeRenderer?.dispose()');
    window.close();
    app.exit();
  }
});
