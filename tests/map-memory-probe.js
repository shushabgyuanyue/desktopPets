const { app, BrowserWindow } = require('electron');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function memory(label) {
  const processes = app.getAppMetrics().map(({ type, memory: usage }) => ({
    type,
    privateMB: Math.round(usage.privateBytes / 1024 * 10) / 10
  }));
  console.log(JSON.stringify({ label, processes }));
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1536, height: 864, show: false, frame: false });
  try {
    await window.loadURL('data:text/html,<canvas id="map"></canvas>');
    await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('map');
      const context = canvas.getContext('2d');
      window.resizeMapProbe = (visible) => {
        canvas.width = visible ? 1920 : 1;
        canvas.height = visible ? 1080 : 1;
        context.fillStyle = '#f00';
        context.fillRect(0, 0, 10, 10);
      };
      window.resizeMapProbe(true);
    })()`);
    await pause(3000);
    memory('full');
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await window.webContents.executeJavaScript('window.resizeMapProbe(false)');
      await pause(3000);
      memory(`tiny-${cycle}`);
      await window.webContents.executeJavaScript('window.resizeMapProbe(true)');
      await pause(3000);
      memory(`full-${cycle}`);
    }
  } finally {
    window.close();
    app.exit();
  }
});
