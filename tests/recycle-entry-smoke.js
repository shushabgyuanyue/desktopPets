const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', path.join(os.tmpdir(), 'deskAnts-recycle-entry-smoke'));

const filePath = 'C:\\Users\\Test\\Desktop\\sample.wav';
const icons = [
  { id: 'bin', name: '回收站', x: 32, y: 74, w: 42, h: 48, isRecycleBin: true },
  { id: 'file', name: 'sample.wav', path: filePath, x: 180, y: 74, w: 42, h: 48, isRecycleBin: false }
];

ipcMain.handle('desktop:icons', () => icons);
ipcMain.handle('window:mouse-mode', () => {});
ipcMain.handle('file-food:select-many', () => ({ ok: true, jobs: [
  { id: 'visual-test', name: 'sample.wav', path: filePath, size: 2048 }
], skipped: 0 }));
ipcMain.handle('file-food:finish', () => ({ ok: false, message: 'Test file preserved' }));

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 640,
    height: 480,
    frame: false,
    transparent: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  let failed = false;
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    window.webContents.send('desktop:visibility', true);
    for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'narrow']]) {
      window.setSize(width, height);
      const result = await window.webContents.executeJavaScript(`(async () => {
        if (!state.recycleBin) await syncDesktopIcons();
        state.running = false;
        resizeCanvas();
        clearInterval(state.tickTimer);
        state.food = null;
        state.colony.setFileFoods([]);
        await chooseFileJobs();
        const started = state.fileJobs.get('visual-test')?.status === 'moving';
        let entry = null;
        for (let index = 0; index < 8000; index += 1) {
          state.colony.step(0.05);
          const snapshot = state.colony.snapshot();
          entry = snapshot.ants.find((ant) => ant.mode === 'deposit' &&
            ant.payloadKind === 'file' && ant.entryProgress >= 0.35 && ant.entryProgress < 0.8);
          if (entry) {
            state.snapshot = snapshot;
            break;
          }
        }
        if (!entry) return { started, entry: null };
        const mockBin = document.createElement('div');
        mockBin.style.cssText = 'position:fixed;left:32px;top:74px;width:42px;height:48px;z-index:0;' +
          'border:2px solid #a4c3d0;border-radius:4px 4px 7px 7px;' +
          'background:linear-gradient(120deg,#cce1e9,#7299a7);pointer-events:none';
        document.body.insertBefore(mockBin, document.body.firstChild);
        draw(performance.now());
        state.antRenderer?.render(state.snapshot.ants, state.desktopIcons, performance.now(), false, state.entryPortal);
        const portal = state.entryPortal;
        // The entering ant and membrane live on antCanvas; the map may be
        // transparent while its wallpaper patch is unavailable. Read physical
        // pixels so this assertion also covers Windows display scaling.
        const pixels = antCanvas.getContext('2d').getImageData(
          Math.floor(portal.rect.x * state.dpr), Math.floor(portal.rect.y * state.dpr),
          Math.ceil(portal.rect.w * state.dpr), Math.ceil(portal.rect.h * state.dpr)).data;
        let visiblePixels = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] > 0) visiblePixels += 1;
        }
        const slice = document.querySelector('.entry-file-slice:not([hidden])');
        const sliceRect = slice?.getBoundingClientRect();
        return {
          started,
          entryProgress: entry.entryProgress,
          deliveredBytes: state.snapshot.fileFoods.find((task) => task.id === 'visual-test')?.deliveredBytes,
          food: { ...state.food },
          portal,
          visiblePixels,
          sliceRect: sliceRect ? { x: sliceRect.x, y: sliceRect.y, width: sliceRect.width, height: sliceRect.height } : null,
          sliceVisible: Boolean(sliceRect && sliceRect.width > 0 && sliceRect.height > 0 &&
            Number(getComputedStyle(slice).opacity) > 0 &&
            Number(getComputedStyle(entryPayloadLayer).zIndex) > Number(getComputedStyle(antCanvas).zIndex))
        };
      })()`);
      await pause(100);
      await window.webContents.capturePage();
      const screenshot = await window.webContents.capturePage();
      const output = path.join(os.tmpdir(), `deskAnts-entry-${label}-${process.pid}.png`);
      const zoomOutput = path.join(os.tmpdir(), `deskAnts-entry-${label}-zoom-${process.pid}.png`);
      await fs.writeFile(output, screenshot.toPNG());
      await fs.writeFile(zoomOutput, screenshot.crop({ x: 18, y: 28, width: 130, height: 130 })
        .resize({ width: 520, height: 520 }).toPNG());
      console.log(JSON.stringify({ label, output, zoomOutput, ...result }));
      if (!result.started || !result.entryProgress || !result.visiblePixels ||
        !result.sliceVisible || result.deliveredBytes !== 0) failed = true;
      if (label === 'desktop') {
        await window.webContents.executeJavaScript(`
          clearTimeout(state.toastTimer);
          state.pendingToasts.length = 0;
          document.getElementById('mapToast').classList.remove('show');
          true;
        `);
        window.webContents.send('desktop:visibility', false);
        await pause(60);
        const queued = await window.webContents.executeJavaScript(`
          showToast('只能选择桌面文件');
          state.pendingToasts.length === 1 && !document.getElementById('mapToast').classList.contains('show');
        `);
        window.webContents.send('desktop:visibility', true);
        await pause(80);
        const replayed = await window.webContents.executeJavaScript(`
          document.getElementById('mapToast').textContent === '只能选择桌面文件' &&
            document.getElementById('mapToast').classList.contains('show') &&
            state.fileJobs.get('visual-test')?.status === 'moving';
        `);
        console.log(JSON.stringify({ label: 'hidden-toast', queued, replayed }));
        if (!queued || !replayed) failed = true;
      }
      await window.webContents.executeJavaScript(`
        state.fileJobs.clear();
        state.colony.setFileFoods([]);
        document.body.querySelector('div[style*="linear-gradient(120deg"]')?.remove();
        true;
      `);
    }
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
