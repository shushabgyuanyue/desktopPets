const { contextBridge, ipcRenderer, webUtils } = require('electron');

const fileDropCallbacks = new Set();
const fileDragCallbacks = new Set();
let dropHoverTimer;

function overControlPanel(target) {
  return target instanceof Element && Boolean(target.closest('#controlPanel'));
}

function markFileDropActive() {
  const panel = document.getElementById('controlPanel');
  if (!panel) return;
  panel.classList.add('file-drop-active');
  for (const callback of fileDragCallbacks) callback();
  clearTimeout(dropHoverTimer);
  dropHoverTimer = setTimeout(() => panel.classList.remove('file-drop-active'), 180);
}

document.addEventListener('dragover', (event) => {
  if (!overControlPanel(event.target) || !Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  markFileDropActive();
}, true);

document.addEventListener('drop', async (event) => {
  if (!overControlPanel(event.target)) return;
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  clearTimeout(dropHoverTimer);
  document.getElementById('controlPanel')?.classList.remove('file-drop-active');
  let result;
  try {
    const paths = files.map((file) => webUtils.getPathForFile(file));
    result = await ipcRenderer.invoke('file-food:add-paths', paths);
  } catch (error) {
    result = { ok: false, message: `无法读取拖入的文件：${error.message}` };
  }
  for (const callback of fileDropCallbacks) callback(result);
}, true);

contextBridge.exposeInMainWorld('antDesk', {
  listDesktopIcons: () => ipcRenderer.invoke('desktop:icons'),
  getWallpaperPatches: (icons) => ipcRenderer.invoke('desktop:wallpaper-patches', icons),
  desktopFrameReady: () => ipcRenderer.send('desktop:frame-ready'),
  selectFileFood: () => ipcRenderer.invoke('file-food:select'),
  selectFileFoods: () => ipcRenderer.invoke('file-food:select-many'),
  addFileFoodPaths: (paths) => ipcRenderer.invoke('file-food:add-paths', paths),
  finishFileFood: (id, deliveredBytes) => ipcRenderer.invoke('file-food:finish', id, deliveredBytes),
  cancelFileFood: (id) => ipcRenderer.invoke('file-food:cancel', id),
  onFileFoodDrop: (callback) => {
    fileDropCallbacks.add(callback);
    return () => fileDropCallbacks.delete(callback);
  },
  onFileFoodDrag: (callback) => {
    fileDragCallbacks.add(callback);
    return () => fileDragCallbacks.delete(callback);
  },
  checkForUpdates: () => ipcRenderer.invoke('app:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('app:update-download'),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  },
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  setMouseMode: (passThrough) => ipcRenderer.invoke('window:mouse-mode', passThrough),
  onSystemEvent: (name, callback) => ipcRenderer.on(name, (_event, ...args) => callback(...args))
});
