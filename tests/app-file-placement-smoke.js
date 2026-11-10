const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', path.join(os.tmpdir(), 'deskAnts-app-file-placement-smoke'));

const desktopPath = 'C:\\Users\\Alice\\Desktop\\';
const jobs = [
  { id: 'fixture-a', name: 'food-a.wav', path: `${desktopPath}food-a.wav`, size: 60_708_140 },
  { id: 'fixture-b', name: 'food-b.txt', path: `${desktopPath}food-b.txt`, size: 2048 },
  { id: 'fixture-c', name: 'dropped.txt', path: `${desktopPath}dropped.txt`, size: 3072 }
];
const icon = (id, job, x, y) => ({
  id, name: job.name, path: job.path, x, y, w: 50, h: 50,
  imageRect: { x: x + 8, y: y + 4, w: 34, h: 34 },
  labelRect: { x: x - 5, y: y + 39, w: 60, h: 20 },
  isRecycleBin: false
});
const icons = [
  { id: 'bin', name: 'Recycle Bin', x: 18, y: 12, w: 50, h: 50, isRecycleBin: true },
  icon('a', jobs[0], 140, 80),
  icon('b', jobs[1], 300, 280),
  icon('c', jobs[2], 420, 340),
  { id: 'folder', name: 'folder', x: 220, y: 120, w: 50, h: 50, isRecycleBin: false }
];

let droppedPaths;
let pickerCalls = 0;
ipcMain.handle('desktop:icons', () => icons);
ipcMain.handle('window:mouse-mode', () => {});
ipcMain.handle('file-food:select-many', () => {
  pickerCalls += 1;
  return { ok: true, jobs: jobs.slice(0, 2), skipped: 0 };
});
ipcMain.handle('file-food:add-paths', (_event, paths) => {
  droppedPaths = paths;
  return { ok: true, jobs: [jobs[2]], skipped: 0 };
});
ipcMain.handle('file-food:finish', () => ({ ok: false, message: 'fixture only; no file changed' }));
ipcMain.handle('file-food:cancel', () => ({ ok: true }));

function assertState(condition, description, detail) {
  if (condition) return false;
  console.error(`FAIL: ${description}`, detail);
  return true;
}

async function waitFor(window, expression, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function inspect(window, expression) {
  return window.webContents.executeJavaScript(`(() => ${expression})()`);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 800, height: 600, show: false, transparent: true,
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
    await waitFor(window, 'state.desktopIcons.length === 5 && state.visible');
    await window.webContents.executeJavaScript(`(() => {
      state.running = false;
      clearInterval(state.tickTimer);
      clearInterval(state.iconTimer);
      document.getElementById('fileFoodBtn').click();
    })()`);
    await waitFor(window, 'state.fileJobs.size === 2 && state.snapshot?.fileFoods?.length === 2');

    const selected = await inspect(window, `({
      jobs: [...state.fileJobs.values()].map((job) => ({
        id: job.id, status: job.status, position: job.position, iconRect: job.iconRect,
        accessPoints: job.accessPoints,
        sides: [...new Set(job.accessPoints.map((point) => point.x < job.iconRect.x ? 'left'
          : point.x > job.iconRect.x + job.iconRect.w ? 'right'
            : point.y < job.iconRect.y ? 'top' : 'bottom'))],
        reachable: state.colony.canReach(job.position), blocked: isBlocked(job.position)
      })),
      sources: state.snapshot.fileFoods.map((task) => task.id),
      rows: document.querySelectorAll('#fileJobs .file-job').length,
      ants: state.snapshot.ants.length,
      entry: { tag: document.getElementById('fileFoodBtn').tagName,
        text: document.getElementById('fileFoodBtn').textContent.trim() }
    })`);
    console.log(JSON.stringify({ selected }));
    failed ||= assertState(selected.jobs.length === 2 && selected.jobs.every((job) =>
      job.status === 'moving' && job.position && job.reachable && !job.blocked) &&
      (selected.jobs[0].position.x !== selected.jobs[1].position.x ||
        selected.jobs[0].position.y !== selected.jobs[1].position.y) &&
      selected.jobs.every((job) => job.accessPoints.length >= 3 && job.sides.length >= 3),
    'both selected files must be reachable food sources', selected);
    failed ||= assertState(selected.jobs[0].iconRect.x === icons[1].imageRect.x &&
      selected.jobs[1].iconRect.x === icons[2].imageRect.x,
    'food icon geometry must use native image rectangles', selected);
    failed ||= assertState(selected.sources.join(',') === 'fixture-a,fixture-b' &&
      selected.rows === 2 && selected.ants === 36,
    'both jobs must appear in simulation and panel', selected);

    const leftSideBlocker = { id: 'blocked-side', name: 'blocked side',
      x: 90, y: 70, w: 49, h: 70, isRecycleBin: false };
    icons.push(leftSideBlocker);
    await window.webContents.executeJavaScript('syncDesktopIcons()');
    const blockedSide = await inspect(window, `(() => {
      const job = state.fileJobs.get('fixture-a');
      return {
        points: job.accessPoints,
        sides: [...new Set(job.accessPoints.map((point) => point.x < job.iconRect.x ? 'left'
          : point.x > job.iconRect.x + job.iconRect.w ? 'right'
            : point.y < job.iconRect.y ? 'top' : 'bottom'))],
        reachable: job.accessPoints.every((point) => state.colony.canReach(point)),
        blocked: job.accessPoints.some((point) => isBlocked(point)),
        picked: state.snapshot.fileFoods.find((task) => task.id === 'fixture-a').pickedChunks
      };
    })()`);
    console.log(JSON.stringify({ blockedSide }));
    failed ||= assertState(blockedSide.points.length >= 2 &&
      !blockedSide.sides.includes('left') && blockedSide.sides.length >= 2 &&
      blockedSide.reachable && !blockedSide.blocked,
    'blocking one icon side must leave other reachable pickup points', blockedSide);
    const pickedWithBlockedSide = await inspect(window, `(() => {
      const before = state.snapshot.fileFoods.find((task) => task.id === 'fixture-a').pickedChunks;
      for (let tick = 0; tick < 3000; tick += 1) {
        state.colony.step(0.05);
        const progress = state.colony.snapshot({ includePheromone: false }).fileFoods
          .find((task) => task.id === 'fixture-a');
        if (progress.pickedChunks > before) {
          state.snapshot = snapshotForDisplay();
          return progress.pickedChunks;
        }
      }
      return null;
    })()`);
    failed ||= assertState(pickedWithBlockedSide > blockedSide.picked,
      'ants must still collect from unblocked icon sides', { blockedSide, pickedWithBlockedSide });
    icons.splice(icons.indexOf(leftSideBlocker), 1);
    await window.webContents.executeJavaScript('syncDesktopIcons()');

    const beforeMove = await inspect(window, `(() => {
      for (let tick = 0; tick < 4000; tick += 1) {
        state.colony.step(0.05);
        const task = state.colony.snapshot({ includePheromone: false }).fileFoods[0];
        if (task.pickedChunks) {
          state.snapshot = snapshotForDisplay();
          return { progress: task, position: state.fileJobs.get('fixture-b').position };
        }
      }
      return null;
    })()`);
    failed ||= assertState(Boolean(beforeMove?.progress.pickedChunks),
      'at least one slice should be picked before the icon moves', beforeMove);

    for (const rect of [icons[1], icons[1].imageRect, icons[1].labelRect]) rect.x += 100;
    await window.webContents.executeJavaScript('syncDesktopIcons()');
    const moved = await inspect(window, `({
      position: state.fileJobs.get('fixture-a').position,
      iconRect: state.fileJobs.get('fixture-a').iconRect,
      progress: state.snapshot.fileFoods.find((task) => task.id === 'fixture-a'),
      otherPosition: state.fileJobs.get('fixture-b').position
    })`);
    console.log(JSON.stringify({ moved }));
    failed ||= assertState(moved.iconRect.x === icons[1].imageRect.x &&
      moved.position.x !== selected.jobs[0].position.x &&
      moved.progress.pickedBytes === beforeMove.progress.pickedBytes &&
      moved.otherPosition.x === beforeMove.position.x,
    'moving one native icon must move only its food and preserve progress', moved);

    const removed = icons.splice(1, 1)[0];
    await window.webContents.executeJavaScript('syncDesktopIcons()');
    const missing = await inspect(window, `({
      first: { status: state.fileJobs.get('fixture-a').status,
        position: state.fileJobs.get('fixture-a').position },
      second: { status: state.fileJobs.get('fixture-b').status,
        position: state.fileJobs.get('fixture-b').position },
      progress: state.snapshot.fileFoods.find((task) => task.id === 'fixture-a')
    })`);
    console.log(JSON.stringify({ missing }));
    failed ||= assertState(missing.first.status === 'waiting' && missing.first.position === null &&
      missing.second.status === 'moving' && missing.second.position &&
      missing.progress.pickedBytes === beforeMove.progress.pickedBytes,
    'a missing icon pauses only its own task', missing);

    icons.push(removed);
    await window.webContents.executeJavaScript('syncDesktopIcons()');
    const restored = await inspect(window, `({
      status: state.fileJobs.get('fixture-a').status,
      position: state.fileJobs.get('fixture-a').position,
      progress: state.snapshot.fileFoods.find((task) => task.id === 'fixture-a')
    })`);
    console.log(JSON.stringify({ restored }));
    failed ||= assertState(restored.status === 'moving' && restored.position &&
      restored.progress.pickedBytes === beforeMove.progress.pickedBytes,
    'restoring the icon resumes its task without resetting it', restored);

    const dragHint = await inspect(window, `(() => {
      const target = document.getElementById('fileFoodBtn');
      const toast = document.getElementById('mapToast');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['virtual'], 'hint.txt', { type: 'text/plain' }));
      window.localStorage.removeItem(FILE_DRAG_HINT_KEY);
      state.fileDragHintShown = false;
      state.pendingToasts.length = 0;
      clearTimeout(state.toastTimer);
      toast.classList.remove('show');
      const hover = () => target.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: transfer
      }));
      hover();
      const first = toast.classList.contains('show') &&
        toast.textContent === '松开鼠标即可添加文件食物';
      clearTimeout(state.toastTimer);
      toast.classList.remove('show');
      hover();
      const second = toast.classList.contains('show');
      return { first, second, stored: window.localStorage.getItem(FILE_DRAG_HINT_KEY) === '1' };
    })()`);
    console.log(JSON.stringify({ dragHint }));
    failed ||= assertState(dragHint.first && !dragHint.second && dragHint.stored,
      'file drag hint appears only once', dragHint);

    const dropped = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const target = document.getElementById('fileFoodBtn');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['virtual'], 'dropped.txt', { type: 'text/plain' }));
      const stop = window.antDesk.onFileFoodDrop((response) => {
        stop();
        resolve(response);
      });
      const hover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
      target.dispatchEvent(hover);
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      target.dispatchEvent(drop);
      window.smokeDropEvents = { hoverPrevented: hover.defaultPrevented,
        dropPrevented: drop.defaultPrevented };
      setTimeout(() => reject(new Error('drop callback timed out')), 3000);
    })`);
    await waitFor(window, 'state.fileJobs.size === 3 && state.snapshot?.fileFoods?.length === 3');
    const dragEvents = await window.webContents.executeJavaScript('window.smokeDropEvents');
    const added = await inspect(window, `({
      ids: [...state.fileJobs.keys()],
      third: state.fileJobs.get('fixture-c')?.position,
      rows: document.querySelectorAll('#fileJobs .file-job').length,
      sources: state.snapshot.fileFoods.map((task) => task.id)
    })`);
    console.log(JSON.stringify({ dragEvents, dropped, droppedPaths, added }));
    failed ||= assertState(dragEvents.hoverPrevented && dragEvents.dropPrevented &&
      dropped?.ok === true && Array.isArray(droppedPaths) && droppedPaths.length === 1,
    'panel drag must invoke the file-drop callback through IPC', { dragEvents, dropped, droppedPaths });
    failed ||= assertState(added.ids.join(',') === 'fixture-a,fixture-b,fixture-c' &&
      added.third && added.rows === 3 && added.sources.length === 3 &&
      (added.third.x !== moved.position.x || added.third.y !== moved.position.y) &&
      (added.third.x !== moved.otherPosition.x || added.third.y !== moved.otherPosition.y) &&
      pickerCalls === 1 && selected.entry.tag === 'BUTTON',
    'dropped file must join existing tasks', added);

    const visual = await inspect(window, `(() => {
      draw(performance.now());
      const image = state.fileJobs.get('fixture-a').iconRect;
      const label = state.desktopIcons.find((item) => item.path === state.fileJobs.get('fixture-a').path).labelRect;
      const imageAlpha = context.getImageData(Math.round((image.x + image.w / 2) * state.dpr),
        Math.round((image.y + image.h / 2) * state.dpr), 1, 1).data[3];
      const labelAlpha = context.getImageData(Math.round((label.x + label.w / 2) * state.dpr),
        Math.round((label.y + label.h / 2) * state.dpr), 1, 1).data[3];
      return { imageAlpha, labelAlpha };
    })()`);
    console.log(JSON.stringify({ visual }));
    failed ||= assertState(visual.imageAlpha > 0 && visual.labelAlpha === 0,
      'mantou must cover the icon image while preserving the native filename area', visual);

    const pheromones = await inspect(window, `(() => {
      const toggle = document.getElementById('pheromoneToggle');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      draw(performance.now());
      const released = !state.showPheromones && state.pheromoneLayer === null;
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      draw(performance.now() + 500);
      return { released, recreated: state.showPheromones &&
        state.pheromoneLayer?.width > 1 && state.pheromoneLayer?.height > 1 };
    })()`);
    console.log(JSON.stringify({ pheromones }));
    failed ||= assertState(pheromones.released && pheromones.recreated,
      'pheromone toggle must release and recreate its draw layer without a crash', pheromones);

    ipcMain.removeHandler('file-food:finish');
    ipcMain.handle('file-food:finish', () => ({ ok: true }));
    const recycled = await window.webContents.executeJavaScript(`(async () => {
      const job = state.fileJobs.get('fixture-b');
      job.status = 'ready';
      await finishFileJob(job);
      return {
        remaining: [...state.fileJobs.keys()],
        rows: [...document.querySelectorAll('#fileJobs .file-name')].map((item) => item.textContent),
        sources: state.snapshot.fileFoods.map((task) => task.id)
      };
    })()`);
    console.log(JSON.stringify({ recycled }));
    failed ||= assertState(!recycled.remaining.includes('fixture-b') &&
      recycled.remaining.length === 2 && recycled.rows.length === 2 &&
      !recycled.rows.includes('food-b.txt') && !recycled.sources.includes('fixture-b'),
    'recycled files leave progress while other file tasks continue', recycled);
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
