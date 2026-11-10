const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', path.join(os.tmpdir(), 'deskAnts-preload-drop-smoke'));

let receivedPaths = null;
ipcMain.handle('file-food:add-paths', (_event, paths) => {
  receivedPaths = paths;
  return { ok: false, message: '虚拟文件不能作为桌面文件' };
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 400, height: 300, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  let failed = false;
  try {
    await window.loadURL('data:text/html,<div id="controlPanel"><button id="drop">文件</button></div>');
    const result = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const panel = document.getElementById('controlPanel');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['virtual'], 'virtual.txt', { type: 'text/plain' }));
      window.antDesk.onFileFoodDrop((response) => resolve({ response,
        activeAfterDrop: panel.classList.contains('file-drop-active') }));
      const hover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.getElementById('drop').dispatchEvent(hover);
      const activeOnHover = panel.classList.contains('file-drop-active');
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.getElementById('drop').dispatchEvent(drop);
      setTimeout(() => reject(new Error('drop callback timed out')), 3000);
      window.dropHoverResult = { activeOnHover, hoverPrevented: hover.defaultPrevented,
        dropPrevented: drop.defaultPrevented };
    })`);
    const hover = await window.webContents.executeJavaScript('window.dropHoverResult');
    console.log(JSON.stringify({ hover, result, receivedPaths }));
    failed = !hover.activeOnHover || !hover.hoverPrevented || !hover.dropPrevented ||
      result.activeAfterDrop || result.response?.ok !== false ||
      (receivedPaths !== null && !Array.isArray(receivedPaths));
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
