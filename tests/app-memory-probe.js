const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

ipcMain.handle('desktop:icons', () => []);
ipcMain.handle('window:mouse-mode', () => {});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function memory(label) {
  const processes = app.getAppMetrics().map(({ type, memory: usage }) => ({
    type,
    workingMB: Math.round(usage.workingSetSize / 1024 * 10) / 10,
    privateMB: Math.round(usage.privateBytes / 1024 * 10) / 10
  }));
  console.log(JSON.stringify({ label, processes }));
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1536, height: 864, show: false, frame: false, transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false
    }
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await pause(3000);
    memory('initial-hidden');
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      window.webContents.send('desktop:visibility', true);
      await pause(3000);
      memory(`visible-${cycle}`);
      window.webContents.send('desktop:visibility', false);
      await pause(3000);
      memory(`hidden-${cycle}`);
    }
  } finally {
    window.close();
    app.exit();
  }
});
