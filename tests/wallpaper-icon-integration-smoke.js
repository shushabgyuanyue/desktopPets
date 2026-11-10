const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain, nativeImage, screen } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const jobs = [
  { id: 'fixture-a', name: 'rainfall.wav', path: 'C:\\Users\\Fixture\\Desktop\\rainfall.wav', size: 1_000_000 },
  { id: 'fixture-b', name: 'travel-notes.txt', path: 'C:\\Users\\Fixture\\Desktop\\travel-notes.txt', size: 2_000_000 }
];
const icons = [];
const patchCalls = [];
let iconReads = 0;
let resolveMovedPatch;
let reportMovedPatchRequest;
const movedPatchRequested = new Promise((resolve) => { reportMovedPatchRequest = resolve; });

function patchPng(red, green, blue) {
  const pixels = Buffer.alloc(4 * 4 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width: 4, height: 4 }).toDataURL();
}

const firstPatch = patchPng(24, 215, 24);
const secondPatch = patchPng(210, 95, 210);
const movedPatch = patchPng(220, 32, 220);

function makeIcon(job, x, y, scale) {
  const imageRect = { x: x + 5, y: y + 4, w: 42, h: 42 };
  return {
    id: job.id, name: job.name, path: job.path, x, y, w: 52, h: 52,
    imageRect, labelRect: { x: x - 4, y: y + 49, w: 60, h: 18 },
    physicalX: Math.round(imageRect.x * scale),
    physicalY: Math.round(imageRect.y * scale),
    physicalW: Math.round(imageRect.w * scale),
    physicalH: Math.round(imageRect.h * scale),
    isRecycleBin: false
  };
}

ipcMain.handle('desktop:icons', () => { iconReads += 1; return icons; });
ipcMain.handle('desktop:wallpaper-patches', (_event, requests) => {
  patchCalls.push(requests.map((request) => ({ ...request })));
  const patches = requests.map((request) => ({
    id: request.id,
    dataUrl: request.id === jobs[0].id
      ? patchCalls.length > 1 ? movedPatch : firstPatch
      : secondPatch
  }));
  if (patchCalls.length === 2) {
    reportMovedPatchRequest();
    return new Promise((resolve) => { resolveMovedPatch = () => resolve(patches); });
  }
  return patches;
});
ipcMain.handle('window:mouse-mode', () => {});
ipcMain.handle('file-food:select-many', () => ({ ok: true, jobs, skipped: 0 }));
ipcMain.handle('file-food:finish', () => ({ ok: false, message: 'fixture only' }));
ipcMain.handle('file-food:cancel', () => ({ ok: true }));

async function waitFor(window, expression, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function inspectPatch(window, id) {
  return window.webContents.executeJavaScript(`(() => {
    const showPheromones = state.showPheromones;
    state.showPheromones = false;
    draw(performance.now());
    const job = state.fileJobs.get(${JSON.stringify(id)});
    const rect = job.iconRect;
    const sample = (x, y) => Array.from(context.getImageData(
      Math.round(x * state.dpr), Math.round(y * state.dpr), 1, 1).data);
    const result = {
      backdrop: sample(rect.x + 1, rect.y + 1),
      label: sample(rect.x + rect.w / 2, rect.y + rect.h + 12),
      imageReady: state.wallpaperPatches.get(job.id)?.image.complete,
      cacheKey: state.wallpaperPatches.get(job.id)?.key,
      rect
    };
    state.showPheromones = showPheromones;
    return result;
  })()`);
}

app.setPath('userData', path.join(os.tmpdir(), 'deskAnts-wallpaper-integration-smoke'));
app.whenReady().then(async () => {
  const scale = screen.getPrimaryDisplay().scaleFactor;
  icons.push(
    { id: 'bin', name: 'Recycle Bin', x: 22, y: 18, w: 52, h: 52, isRecycleBin: true },
    makeIcon(jobs[0], 155, 100, scale),
    makeIcon(jobs[1], 310, 165, scale)
  );
  const window = new BrowserWindow({
    width: 800, height: 600, show: false, transparent: false,
    backgroundColor: '#243039',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false
    }
  });
  let failed = false;
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    window.webContents.send('desktop:visibility', true);
    await waitFor(window, 'state.visible && state.desktopIcons.length === 3');
    await window.webContents.executeJavaScript(`(() => {
      state.running = false;
      clearInterval(state.tickTimer);
      clearInterval(state.iconTimer);
      document.getElementById('fileFoodBtn').click();
    })()`);
    await waitFor(window, 'state.fileJobs.size === 2 && state.wallpaperPatches.size === 2');
    assert.equal(patchCalls.length, 1, 'two jobs should share one patch request');
    assert.deepEqual(patchCalls[0].map((request) => request.id), jobs.map((job) => job.id));
    assert.ok(patchCalls[0].every((request) => Number.isInteger(request.physicalX) &&
      Number.isInteger(request.physicalY) && request.physicalW > 0 && request.physicalH > 0));

    const before = await inspectPatch(window, jobs[0].id);
    assert.equal(before.imageReady, true);
    assert.deepEqual(before.backdrop, [24, 215, 24, 255], 'wallpaper image must replace the dark icon square');
    assert.equal(before.label[3], 0, 'native filename area must stay clear');
    await window.webContents.executeJavaScript('syncDesktopIcons()');
    assert.equal(patchCalls.length, 1, 'unchanged icon sync must reuse the patch');

    await window.webContents.insertCSS('html, body { background: #243039 !important; }');
    await window.webContents.executeJavaScript(`new Promise((resolve) => {
      const original = state.colony.snapshot.bind(state.colony);
      state.colony.snapshot = (options) => {
        const value = original(options);
        if (options?.includePheromone) {
          value.explorationPheromone = Array.from({ length: 38 }, (_, i) =>
            ({ x: 78 + i * 10, y: 74 + Math.sin(i * 0.3) * 18 + i * 2,
              strength: 0.4 + (i % 3) * 0.15 }));
          value.pheromone = Array.from({ length: 32 }, (_, i) =>
            ({ x: 195 + i * 7, y: 135 + Math.sin(i * 0.25) * 12 + i * 3,
              strength: 0.55 + (i % 4) * 0.08 }));
        }
        return value;
      };
      state.lastPheromoneCapture = 0;
      draw(performance.now() + 500);
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })`);
    const screenshot = await window.webContents.capturePage();
    const screenshotPath = path.join(os.tmpdir(), 'deskAnts-wallpaper-integration.png');
    await fs.writeFile(screenshotPath, screenshot.resize({ width: 800, height: 600 }).toPNG());
    console.log(JSON.stringify({ screenshotPath, firstBatch: patchCalls[0], before }));

    const moved = icons[1];
    moved.x += 95;
    moved.imageRect.x += 95;
    moved.labelRect.x += 95;
    moved.physicalX += Math.round(95 * scale);
    await window.webContents.executeJavaScript('syncDesktopIcons(); true');
    await movedPatchRequested;
    const movedKey = [moved.physicalX, moved.physicalY,
      moved.physicalW, moved.physicalH].join(':');
    const during = await inspectPatch(window, jobs[0].id);
    assert.equal(during.rect.x, moved.imageRect.x, 'bun must track the moved icon before patch arrives');
    assert.equal(during.backdrop[3], 0,
      'never stretch the old wallpaper onto the new icon position while loading');
    assert.equal(during.label[3], 0);
    await window.webContents.executeJavaScript(`
      cancelAnimationFrame(state.frameId);state.frameId=null;true;
    `);
    resolveMovedPatch();
    await waitFor(window,
      `state.wallpaperPatches.get('${jobs[0].id}')?.key === ${JSON.stringify(movedKey)}`);
    const automaticPaint = await window.webContents.executeJavaScript(`Array.from(context.getImageData(
      Math.round(${moved.imageRect.x+1}*state.dpr),Math.round(${moved.imageRect.y+1}*state.dpr),1,1).data)`);
    assert.deepEqual(automaticPaint,[220,32,220,255],
      'patch completion must paint itself even without a click or pending animation frame');
    assert.equal(patchCalls.length, 2, 'moved icon should request one replacement patch');
    assert.deepEqual(patchCalls[1].map((request) => request.id), [jobs[0].id]);
    const after = await inspectPatch(window, jobs[0].id);
    assert.deepEqual(after.backdrop, [220, 32, 220, 255], 'moved icon must use its new wallpaper patch');
    assert.equal(after.label[3], 0);
    await window.webContents.executeJavaScript('syncDesktopIcons()');
    assert.equal(patchCalls.length, 2, 'second stable sync must not refetch the patch');
    console.log(JSON.stringify({ secondBatch: patchCalls[1], during, after, patchCalls: patchCalls.length }));

    await window.webContents.executeJavaScript('clearInterval(state.iconTimer)');
    const idleReads = iconReads;
    window.webContents.send('desktop:cursor', { x: 20, y: 450 });
    window.webContents.send('desktop:cursor', { x: 90, y: 450 });
    await new Promise((resolve) => setTimeout(resolve, 140));
    const outsideMovementReads = iconReads - idleReads;
    assert.equal(outsideMovementReads, 0, 'cursor movement away from buns must not poll icons');

    const start = { x: moved.imageRect.x + 12, y: moved.imageRect.y + 12 };
    window.webContents.send('desktop:cursor', start);
    await waitFor(window, 'state.trackedIconDrag?.origin.x === ' + start.x);
    const dragCpuStart = process.cpuUsage();
    const dragStart = Date.now();
    moved.x += 42;
    moved.imageRect.x += 42;
    moved.labelRect.x += 42;
    moved.physicalX += Math.round(42 * scale);
    const beforeDragReads = iconReads;
    for (let step = 1; step <= 6; step += 1) {
      window.webContents.send('desktop:cursor', { x: start.x + step * 10, y: start.y });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await waitFor(window,
      `state.fileJobs.get('${jobs[0].id}')?.iconRect?.x === ${moved.imageRect.x}`);
    const dragReads = iconReads - beforeDragReads;
    assert.ok(dragReads >= 2 && dragReads <= 6,
      `short drag should use bounded adaptive reads, got ${dragReads}`);

    await new Promise((resolve) => setTimeout(resolve, 55));
    await window.webContents.executeJavaScript('clearInterval(state.iconTimer)');
    const beforeTrailingReads = iconReads;
    moved.x += 28;
    moved.imageRect.x += 28;
    moved.labelRect.x += 28;
    moved.physicalX += Math.round(28 * scale);
    await waitFor(window,
      `state.fileJobs.get('${jobs[0].id}')?.iconRect?.x === ${moved.imageRect.x}`);
    assert.equal(iconReads - beforeTrailingReads, 1,
      'the final icon position should be read once after cursor motion stops');
    const dragCpu = process.cpuUsage(dragCpuStart);
    console.log(JSON.stringify({ adaptiveDrag: {
      durationMs: Date.now() - dragStart, dragReads,
      trailingReads: iconReads - beforeTrailingReads,
      outsideMovementReads,
      mainCpuMs: (dragCpu.user + dragCpu.system) / 1000
    } }));
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
