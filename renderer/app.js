const canvas = document.getElementById('mapCanvas');
const context = canvas.getContext('2d');
let mapPaint = null;
let antCanvas = document.getElementById('antCanvas');
const entryPayloadLayer = document.getElementById('entryPayloadLayer');
const entrySlices = new Map();
const panel = document.getElementById('controlPanel');
const objectList = document.getElementById('objectList');
const updateButton = document.getElementById('updateBtn');
const fileRows = new Map();
const nest = { x: 44, y: 94 };
const ANT_COUNT = 36;
const HIDDEN_TICK_MS = 500;
const VISIBLE_ICON_SYNC_MS = 1100;
const VISIBLE_FILE_ICON_SYNC_MS = 250;
const HIDDEN_ICON_SYNC_MS = 5000;
const ACTIVE_ICON_SYNC_MS = 100;
const ICON_DRAG_IDLE_MS = 180;
const PHEROMONE_REFRESH_MS = 300;
const PHEROMONE_TRACES_PER_FRAME = 400;
const PHEROMONE_SCALE = 0.4;
const PHEROMONE_STAMP_LEVELS = 256;
const PHEROMONE_STAMP_SIZE = 10;
let pheromoneStamps = null;
const FILE_DRAG_HINT_KEY = 'ant-colony-file-drag-hint-v1';
let updateAction = 'check';
let updateResetTimer = null;

const state = {
  width: 0,
  height: 0,
  dpr: 1,
  obstacles: [],
  desktopIcons: [],
  recycleBin: null,
  entryPortal: null,
  iconSignature: '',
  syncing: false,
  antRenderer: null,
  rendererUnavailable: false,
  colony: null,
  snapshot: null,
  food: null,
  fileJobs: new Map(),
  finishingFileJobId: null,
  wallpaperPatches: new Map(),
  wallpaperPending: new Set(),
  wallpaperRetryAt: 0,
  portalBackdrop: null,
  portalBackdropPending: false,
  portalBackdropRetryAt: 0,
  pheromoneLayer: null,
  pheromoneScratch: null,
  pheromoneWork: null,
  lastPheromoneCapture: 0,
  showPheromones: true,
  running: true,
  visible: false,
  placingFood: false,
  draggingFood: null,
  showBounds: false,
  captured: false,
  lastTick: 0,
  tickTimer: null,
  iconTimer: null,
  lastIconSyncStarted: 0,
  trackedIconDrag: null,
  adaptiveIconSyncWanted: false,
  adaptiveIconSyncTimer: null,
  frameId: null,
  lastMetrics: 0,
  toastTimer: null,
  pendingToasts: [],
  fileDragHintShown: false
};

function snapshotForDisplay() {
  return state.colony.snapshot({ includePheromone: false, includeBestPath: false });
}

function fileFoodSources() {
  return [...state.fileJobs.values()].map((job) => ({
    id: job.id, totalBytes: job.size,
    position: job.status === 'moving' || job.status === 'ready' ? job.position : null,
    accessPoints: job.status === 'moving' || job.status === 'ready' ? job.accessPoints : []
  }));
}

function samePoint(left, right) {
  return left === right || Boolean(left && right &&
    Math.abs(left.x - right.x) < 0.01 && Math.abs(left.y - right.y) < 0.01);
}

function samePoints(left, right) {
  return left === right || Boolean(left && right && left.length === right.length &&
    left.every((point, index) => samePoint(point, right[index])));
}

function syncFileFoodSources() {
  if (!state.colony) return;
  state.colony.setFileFoods(fileFoodSources());
  state.lastPheromoneCapture = 0;
  if (state.visible) {
    state.snapshot = snapshotForDisplay();
    updateMetrics();
    requestFrame();
  }
}

function hasTrackedFileIcons() {
  return [...state.fileJobs.values()].some((job) => job.status !== 'completed');
}

function terrainObstacles() {
  return state.obstacles.map((icon) => icon.imageRect || icon);
}

function inside(point, rect, padding = 0) {
  return point.x >= rect.x - padding && point.x <= rect.x + rect.w + padding &&
    point.y >= rect.y - padding && point.y <= rect.y + rect.h + padding;
}

function isBlocked(point, includeNestIcon = true) {
  const icons = includeNestIcon ? state.desktopIcons : state.obstacles;
  return icons.some((item) => inside(point, item.imageRect || item, 2.6));
}

function findNest() {
  if (state.recycleBin) {
    const { x, y, w, h } = state.recycleBin.imageRect || state.recycleBin;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const candidates = [
      { side: 'top', outside: { x: cx, y: y - 14 }, rim: { x: cx, y: y + 2 }, mouth: { x: cx, y: y + 12 } },
      { side: 'left', outside: { x: x - 14, y: cy }, rim: { x: x + 2, y: cy }, mouth: { x: x + 12, y: cy } },
      { side: 'right', outside: { x: x + w + 14, y: cy }, rim: { x: x + w - 2, y: cy }, mouth: { x: x + w - 12, y: cy } },
      { side: 'bottom', outside: { x: cx, y: y + h + 14 }, rim: { x: cx, y: y + h - 2 }, mouth: { x: cx, y: y + h - 12 } }
    ];
    const inBounds = ({ outside }) => outside.x >= 14 && outside.x <= state.width - 14 &&
      outside.y >= 14 && outside.y <= state.height - 14;
    state.entryPortal = candidates.find((candidate) => inBounds(candidate) && !isBlocked(candidate.outside, false)) ||
      candidates.find(inBounds) || candidates[0];
    state.entryPortal = { ...state.entryPortal, mouth: { x: cx, y: cy }, rect: { x, y, w, h } };
    return state.entryPortal.outside;
  }
  state.entryPortal = null;
  const candidates = [{ x: 44, y: 94 }];
  for (let y = 28; y < Math.min(state.height / 3, 240); y += 14) {
    for (let x = 30; x < Math.min(state.width / 3, 340); x += 14) candidates.push({ x, y });
  }
  return candidates.find((point) => !isBlocked(point, false)) || { x: 16, y: 16 };
}

function createSimulation() {
  if (!state.width || !state.height) return;
  const position = findNest();
  nest.x = position.x;
  nest.y = position.y;
  state.colony = window.createColony({
    width: state.width,
    height: state.height,
    gridSize: 10,
    nest,
    food: state.food,
    obstacles: terrainObstacles(),
    count: ANT_COUNT
  });
  state.colony.setFileFoods(fileFoodSources());
  if (state.visible) {
    state.snapshot = snapshotForDisplay();
    updateMetrics();
  }
}

function setTerrain(changes) {
  if (!state.colony) createSimulation();
  else state.colony.setTerrain(changes);
  state.lastPheromoneCapture = 0;
  if (state.visible) {
    state.snapshot = snapshotForDisplay();
    updateMetrics();
    requestFrame();
  }
}

function resizeMapBacking() {
  const width = state.visible ? Math.round(state.width * state.dpr) : 1;
  const height = state.visible ? Math.round(state.height * state.dpr) : 1;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
}

function resizeCanvas() {
  mapPaint = null;
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  resizeMapBacking();
  if (state.visible) state.antRenderer?.resize(state.width, state.height, state.dpr);
  document.getElementById('mapSize').textContent = `${state.width} × ${state.height}`;
  if (state.food) {
    state.food.x = Math.max(12, Math.min(state.width - 12, state.food.x));
    state.food.y = Math.max(12, Math.min(state.height - 12, state.food.y));
  }
  const position = findNest();
  nest.x = position.x;
  nest.y = position.y;
  if (!state.colony) createSimulation();
  else {
    state.colony.resize(state.width, state.height, { food: state.food, nest, obstacles: state.obstacles });
    state.colony.setFileFoods(fileFoodSources());
    state.lastPheromoneCapture = 0;
    if (state.visible) {
      state.snapshot = snapshotForDisplay();
      updateMetrics();
    }
  }
  requestFrame();
}

function ensureAntRenderer() {
  if (state.antRenderer || state.rendererUnavailable) return;
  try {
    state.antRenderer = window.AntSketchRenderer.createSketchAntRenderer(antCanvas);
    state.antRenderer.resize(state.width, state.height, state.dpr);
  } catch (error) {
    console.error('Sketch ants unavailable:', error);
    state.rendererUnavailable = true;
    antCanvas.hidden = true;
    antCanvas.width = 1;
    antCanvas.height = 1;
  }
}

function showToast(message) {
  if (!state.visible) {
    state.pendingToasts.push(message);
    return;
  }
  const toast = document.getElementById('mapToast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    if (state.pendingToasts.length) {
      state.toastTimer = setTimeout(() => showToast(state.pendingToasts.shift()), 180);
    }
  }, 1800);
}

function setUpdateAction(action, label, disabled = false) {
  updateAction = action;
  updateButton.querySelector('span').textContent = label;
  updateButton.disabled = disabled;
  updateButton.title = label;
  if (action !== 'current' && action !== 'error') clearTimeout(updateResetTimer);
}

function resetUpdateButtonSoon() {
  clearTimeout(updateResetTimer);
  updateResetTimer = setTimeout(() => setUpdateAction('check', '检查更新'), 3500);
}

function handleUpdateStatus(event) {
  switch (event?.status) {
    case 'checking':
      setUpdateAction('checking', '检查中…', true);
      break;
    case 'available':
      setUpdateAction('download', event.version ? `下载 ${event.version}` : '下载更新');
      showToast(event.version ? `发现新版本 ${event.version}` : '发现新版本，点击下载');
      break;
    case 'current':
      setUpdateAction('current', '已是最新');
      showToast('当前已是最新版本');
      resetUpdateButtonSoon();
      break;
    case 'downloading':
      setUpdateAction('downloading', `下载 ${event.percent || 0}%`, true);
      break;
    case 'downloaded':
      setUpdateAction('install', '重启并更新');
      showToast('更新已下载，点击重启完成安装');
      break;
    case 'installing':
      setUpdateAction('installing', '正在重启…', true);
      break;
    case 'error':
      setUpdateAction('error', '重试检查');
      showToast(event.message || '更新失败，请检查网络后重试');
      resetUpdateButtonSoon();
      break;
  }
}

function updateFailureMessage(reason) {
  if (reason === 'development') return '开发运行版不能检查更新，请使用官网安装版。';
  if (reason === 'not-configured') return '此安装包尚未配置官网更新地址。';
  if (reason === 'no-update') return '没有可下载的更新，请先检查版本。';
  if (reason === 'active-file-jobs') return '文件仍在搬运中，请完成或取消任务后再重启更新。';
  if (reason === 'not-ready') return '更新尚未下载完成。';
  return '更新失败，请检查网络后重试。';
}

updateButton.addEventListener('click', async () => {
  if (updateAction === 'checking' || updateAction === 'downloading' || updateAction === 'installing') return;
  clearTimeout(updateResetTimer);
  if (updateAction === 'download') {
    setUpdateAction('downloading', '准备下载…', true);
    const result = await window.antDesk.downloadUpdate();
    if (!result?.ok) {
      setUpdateAction('download', '重试下载');
      showToast(updateFailureMessage(result?.reason));
    }
    return;
  }
  if (updateAction === 'install') {
    const result = await window.antDesk.installUpdate();
    if (!result?.ok) {
      showToast(updateFailureMessage(result?.reason));
      if (result?.reason === 'active-file-jobs') setUpdateAction('install', '重启并更新');
    }
    return;
  }
  setUpdateAction('checking', '检查中…', true);
  const result = await window.antDesk.checkForUpdates();
  if (!result?.ok) {
    setUpdateAction('error', '重试检查');
    showToast(updateFailureMessage(result?.reason));
    resetUpdateButtonSoon();
  } else if (result.status === 'available' && updateAction === 'checking') {
    handleUpdateStatus({ status: 'available', version: result.version });
  }
});

window.antDesk.onUpdateStatus(handleUpdateStatus);

function showFirstFileDragHint() {
  let alreadyShown = false;
  try {
    alreadyShown = window.localStorage.getItem(FILE_DRAG_HINT_KEY) === '1';
    if (!alreadyShown) window.localStorage.setItem(FILE_DRAG_HINT_KEY, '1');
  } catch {
    // A restricted storage context should still get one hint per page load.
    alreadyShown = state.fileDragHintShown;
  }
  if (alreadyShown) return;
  state.fileDragHintShown = true;
  showToast('松开鼠标即可添加文件食物');
}

function replayPendingToasts() {
  if (state.visible && state.pendingToasts.length) showToast(state.pendingToasts.shift());
}

function renderObjectList() {
  objectList.replaceChildren();
  document.getElementById('objectCount').textContent = String(state.obstacles.length);
  if (state.obstacles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'object-empty';
    empty.textContent = '未检测到桌面图标';
    objectList.append(empty);
    return;
  }
  state.obstacles.slice(0, 16).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'object-row';
    const icon = document.createElement('span');
    icon.className = `object-icon ${item.isFolder ? 'folder' : 'file'}`;
    icon.textContent = item.isFolder ? '▰' : '▧';
    const name = document.createElement('span');
    name.className = 'object-name';
    name.textContent = item.name;
    row.append(icon, name);
    objectList.append(row);
  });
  if (state.obstacles.length > 16) {
    const more = document.createElement('div');
    more.className = 'object-empty';
    more.textContent = `还有 ${state.obstacles.length - 16} 个图标`;
    objectList.append(more);
  }
}

async function syncDesktopIcons() {
  if (state.syncing) return;
  state.syncing = true;
  state.lastIconSyncStarted = performance.now();
  try {
    const icons = await window.antDesk.listDesktopIcons();
    if (!Array.isArray(icons)) return;
    const visible = icons.filter((item) => [item.x, item.y, item.w, item.h].every(Number.isFinite) && item.w > 0 && item.h > 0);
    const signature = JSON.stringify(visible.map(({ id, path, x, y, w, h, imageRect,
      physicalX, physicalY, physicalW, physicalH, isRecycleBin }) =>
      [id, path, x, y, w, h, imageRect, physicalX, physicalY, physicalW, physicalH, isRecycleBin]));
    if (signature !== state.iconSignature) {
      state.iconSignature = signature;
      state.desktopIcons = visible;
      state.recycleBin = visible.find((item) => item.isRecycleBin) || null;
      state.obstacles = visible.filter((item) => !item.isRecycleBin);
      const position = findNest();
      nest.x = position.x;
      nest.y = position.y;
      renderObjectList();
      setTerrain({ nest, obstacles: terrainObstacles() });
      let sourcesChanged = false;
      for (const job of state.fileJobs.values()) {
        const icon = fileIconForPath(job.path);
        job.iconRect = icon ? icon.imageRect || { x: icon.x, y: icon.y, w: icon.w, h: icon.h } : null;
        if (job.status !== 'moving' && job.status !== 'waiting') continue;
        const accessPoints = icon ? openFoodPoints(job.path) : [];
        const nextFood = accessPoints[0] || null;
        const wasMissing = job.iconMissing;
        if (nextFood) {
          if (!samePoint(job.position, nextFood) ||
            !samePoints(job.accessPoints, accessPoints) || job.status !== 'moving') sourcesChanged = true;
          job.position = nextFood;
          job.accessPoints = accessPoints;
          job.status = 'moving';
          job.iconMissing = false;
          if (wasMissing) showToast(`已重新找到“${job.name}”，继续搬运`);
        } else {
          if (job.position || job.accessPoints?.length || job.status !== 'waiting') sourcesChanged = true;
          job.position = null;
          job.accessPoints = [];
          job.status = 'waiting';
          job.iconMissing = true;
          if (!wasMissing) showToast(`“${job.name}”四周不可达，已暂停拾取`);
        }
      }
      if (sourcesChanged) syncFileFoodSources();
      document.getElementById('topStatus').textContent = state.recycleBin ? '回收站巢穴' : `${visible.length} 个真实图标`;
      if (state.food && isBlocked(state.food)) showToast('食物被桌面图标覆盖');
    }
    updatePortalBackdrop();
    if (state.fileJobs.size && Date.now() >= state.wallpaperRetryAt) updateWallpaperPatches();
  } catch {
    document.getElementById('topStatus').textContent = '等待桌面图标';
  } finally {
    state.syncing = false;
    if (state.adaptiveIconSyncWanted) queueAdaptiveIconSync();
  }
}

function updateMetrics() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  document.getElementById('runDot').classList.toggle('live', state.running);
  document.getElementById('runLabel').textContent = state.running ? '蚁群正在探索' : '蚁群已暂停';
  const hasFood = Boolean(state.food || [...state.fileJobs.values()].some((job) => job.position));
  const waitingForFood = [...state.fileJobs.values()].some((job) => job.status === 'waiting');
  document.getElementById('runDetail').textContent = !state.running ? '已暂停探索与搬运'
    : !hasFood ? waitingForFood ? '文件食物四周暂不可达' : '在桌面放一颗食物'
      : snapshot.blockedFood ? '食物被图标覆盖'
      : snapshot.discoveries ? '已发现食物，正在沿信息素返巢' : '正在四处寻找食物';
  document.getElementById('runIcon').textContent = state.running ? 'Ⅱ' : '▶';
  document.getElementById('runText').textContent = state.running ? '暂停' : '继续';
  document.getElementById('runBtn').setAttribute('aria-pressed', String(state.running));
  renderFileJobs();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFileJobs() {
  const container = document.getElementById('fileJobs');
  const visibleJobs = [...state.fileJobs.values()].filter((job) => job.status !== 'completed');
  container.hidden = visibleJobs.length === 0;
  const progressById = new Map((state.snapshot?.fileFoods || []).map((item) => [item.id, item]));
  for (const job of visibleJobs) {
    let row = fileRows.get(job.id);
    if (!row) {
      row = document.getElementById('fileJobTemplate').content.firstElementChild.cloneNode(true);
      row.querySelector('.file-cancel-btn').addEventListener('click', () => cancelFileJob(job.id));
      row.querySelector('.file-place-btn').addEventListener('click', () => {
        state.iconSignature = '';
        syncDesktopIcons();
      });
      row.querySelector('.file-retry-btn').addEventListener('click', () => finishFileJob(job));
      fileRows.set(job.id, row);
      container.append(row);
    }
    const progress = progressById.get(job.id);
    const delivered = job.status === 'completed' ? job.size : progress?.deliveredBytes || 0;
    const percent = delivered / job.size * 100;
    const percentLabel = delivered === 0 ? '0%' : percent < 0.01
      ? `${percent.toFixed(4)}%` : percent < 1 ? `${percent.toFixed(2)}%`
        : percent < 10 ? `${percent.toFixed(1)}%` : `${Math.floor(percent)}%`;
    const inTransit = progress ? progress.pickedChunks - progress.deliveredChunks : 0;
    const name = row.querySelector('.file-name');
    name.textContent = job.name;
    name.title = job.name;
    const filePath = row.querySelector('.file-path');
    filePath.textContent = job.path;
    filePath.title = job.path;
    const meter = row.querySelector('progress');
    meter.max = job.size;
    meter.value = delivered;
    row.querySelector('.file-progress-text').textContent = percentLabel;
    const messages = {
      waiting: '文件图标四周暂不可达，已暂停拾取',
      moving: `${formatBytes(delivered)} / ${formatBytes(job.size)}\n已送达 ${progress?.deliveredChunks || 0}/${progress?.chunkCount || 0} 片 · ${inTransit} 片在途`,
      ready: '全部送达，等待回收确认',
      finishing: '全部送达，等待回收确认',
      completed: '已移入回收站',
      error: job.error || '原文件保留'
    };
    const status = row.querySelector('.file-job-status');
    status.textContent = messages[job.status] || '';
    status.title = status.textContent;
    row.querySelector('.file-place-btn').hidden = job.status !== 'waiting';
    row.querySelector('.file-retry-btn').hidden = job.status !== 'error';
    row.querySelector('.file-cancel-btn').disabled = job.status === 'finishing';
    row.querySelector('.file-cancel-btn').title = job.status === 'completed' ? '清除记录' : '取消搬运';
  }
  for (const [id, row] of fileRows) {
    if (state.fileJobs.has(id) && state.fileJobs.get(id).status !== 'completed') continue;
    row.remove();
    fileRows.delete(id);
  }
}

async function finishFileJob(job) {
  if (state.finishingFileJobId || !state.visible ||
    !['ready', 'error'].includes(job.status)) return;
  state.finishingFileJobId = job.id;
  job.status = 'finishing';
  renderFileJobs();
  let result;
  try {
    result = await window.antDesk.finishFileFood(job.id, job.size);
  } catch (error) {
    result = { ok: false, message: error.message };
  }
  if (state.fileJobs.get(job.id) === job) {
    if (result?.ok) {
      state.fileJobs.delete(job.id);
      state.wallpaperPatches.delete(job.id);
      showToast(`“${job.name}”已移入回收站`);
    } else {
      job.status = 'error';
      job.error = result?.message || '移入回收站失败，原文件保留';
      showToast(job.error);
    }
    syncFileFoodSources();
    renderFileJobs();
    scheduleIconSync();
  }
  state.finishingFileJobId = null;
  checkFileCompletion();
}

function checkFileCompletion() {
  const progressById = new Map((state.snapshot?.fileFoods || []).map((item) => [item.id, item]));
  for (const job of state.fileJobs.values()) {
    if (job.status !== 'moving' && job.status !== 'ready') continue;
    if (progressById.get(job.id)?.deliveredBytes !== job.size) continue;
    job.status = 'ready';
    if (state.visible && !state.finishingFileJobId) {
      finishFileJob(job);
      break;
    }
  }
}

async function cancelFileJob(id) {
  const job = state.fileJobs.get(id);
  if (!job || job.status === 'finishing') return false;
  if (job.status !== 'completed') {
    let result;
    try {
      result = await window.antDesk.cancelFileFood(id);
    } catch (error) {
      result = { ok: false, message: error.message };
    }
    if (!result?.ok) {
      showToast(result?.message || '无法取消文件搬运');
      return false;
    }
  }
  if (state.fileJobs.get(id) === job) {
    state.fileJobs.delete(id);
    state.wallpaperPatches.delete(id);
    syncFileFoodSources();
    renderFileJobs();
    scheduleIconSync();
    showToast('已取消搬运，原文件保留');
  }
  return true;
}

function fileIconForPath(filePath) {
  const key = String(filePath || '').replace(/\//g, '\\').toLowerCase();
  return state.desktopIcons.find((icon) => icon.path &&
    String(icon.path).replace(/\//g, '\\').toLowerCase() === key);
}

function wallpaperPatchKey(icon) {
  if (!icon || ![icon.physicalX, icon.physicalY, icon.physicalW, icon.physicalH]
    .every(Number.isInteger)) return null;
  return [icon.physicalX, icon.physicalY, icon.physicalW, icon.physicalH].join(':');
}

async function updatePortalBackdrop() {
  const icon = state.recycleBin;
  const key = wallpaperPatchKey(icon);
  if (!key || !window.antDesk.getWallpaperPatches || state.portalBackdropPending ||
    state.portalBackdrop?.key === key || Date.now() < state.portalBackdropRetryAt) return;
  state.portalBackdropPending = true;
  try {
    const patches = await window.antDesk.getWallpaperPatches([{ id: '__portal__',
      physicalX:icon.physicalX, physicalY:icon.physicalY, physicalW:icon.physicalW, physicalH:icon.physicalH }]);
    const patch = patches.find((value) => value.id === '__portal__');
    if (!patch) throw new Error('Portal wallpaper patch unavailable');
    const image = new Image(); image.src = patch.dataUrl; await image.decode();
    if (wallpaperPatchKey(state.recycleBin) === key) {
      state.portalBackdrop = { key, image };
      paintVisibleNow();
      if (state.visible) window.antDesk.desktopFrameReady?.();
    }
  } catch {
    state.portalBackdropRetryAt = Date.now() + 10000;
  } finally {
    state.portalBackdropPending = false;
    if (key !== wallpaperPatchKey(state.recycleBin)) updatePortalBackdrop();
  }
}

async function updateWallpaperPatches() {
  if (!window.antDesk.getWallpaperPatches || Date.now() < state.wallpaperRetryAt) return;
  const requests = [];
  const requestKeys = new Map();
  for (const job of state.fileJobs.values()) {
    if (job.status === 'completed') continue;
    const icon = fileIconForPath(job.path);
    const key = wallpaperPatchKey(icon);
    if (!key) continue;
    if (state.wallpaperPatches.get(job.id)?.key === key) continue;
    const pendingKey = `${job.id}:${key}`;
    if (state.wallpaperPending.has(pendingKey)) continue;
    state.wallpaperPending.add(pendingKey);
    requests.push({ id: job.id, physicalX: icon.physicalX, physicalY: icon.physicalY,
      physicalW: icon.physicalW, physicalH: icon.physicalH });
    requestKeys.set(job.id, key);
  }
  if (!requests.length) return;
  let patches;
  try {
    patches = await window.antDesk.getWallpaperPatches(requests);
  } catch {
    patches = [];
    state.wallpaperRetryAt = Date.now() + 10000;
  }
  if (patches.length !== requests.length) state.wallpaperRetryAt = Date.now() + 10000;
  try {
    for (const patch of patches) {
      const key = requestKeys.get(patch.id);
      const job = state.fileJobs.get(patch.id);
      if (!job || !key || wallpaperPatchKey(fileIconForPath(job.path)) !== key) continue;
      const image = new Image();
      image.src = patch.dataUrl;
      try {
        await image.decode();
      } catch {
        state.wallpaperRetryAt = Date.now() + 10000;
        continue;
      }
      if (state.fileJobs.get(patch.id) === job &&
        wallpaperPatchKey(fileIconForPath(job.path)) === key) {
        state.wallpaperPatches.set(patch.id, { key, image });
      }
    }
    paintVisibleNow();
    if (state.visible) window.antDesk.desktopFrameReady?.();
  } finally {
    for (const [id, key] of requestKeys) state.wallpaperPending.delete(`${id}:${key}`);
  }
}

function openFoodPoints(filePath) {
  const icon = fileIconForPath(filePath);
  if (!icon) return [];
  const rect = icon.imageRect || icon;
  const points = [];
  const fractions = [0.2, 0.5, 0.8];
  const sides = [
    (gap, fraction) => ({ x: rect.x - gap, y: rect.y + rect.h * fraction }),
    (gap, fraction) => ({ x: rect.x + rect.w + gap, y: rect.y + rect.h * fraction }),
    (gap, fraction) => ({ x: rect.x + rect.w * fraction, y: rect.y - gap }),
    (gap, fraction) => ({ x: rect.x + rect.w * fraction, y: rect.y + rect.h + gap })
  ];
  for (const fraction of fractions) {
    for (const side of sides) {
      for (const gap of [10, 16, 24, 34, 44]) {
        const point = side(gap, fraction);
        if (point.x < 14 || point.y < 14 || point.x > state.width - 14 ||
          point.y > state.height - 14 || isBlocked(point) ||
          (state.colony && !state.colony.canReach(point))) continue;
        points.push(point);
        break;
      }
    }
  }
  return points;
}

async function addFileJobs(result) {
  if (!result) return;
  if (result.ok === false) {
    showToast(result.message || '无法添加桌面文件');
    return;
  }
  if (!result.jobs?.length) {
    if (result.skipped) showToast('这些文件已经在搬运列表中');
    return;
  }
  await syncDesktopIcons();
  let readyCount = 0;
  for (const selected of result.jobs) {
    if (state.fileJobs.has(selected.id)) continue;
    const icon = fileIconForPath(selected.path);
    const accessPoints = icon ? openFoodPoints(selected.path) : [];
    const position = accessPoints[0] || null;
    state.fileJobs.set(selected.id, {
      ...selected, position, accessPoints,
      iconRect: icon ? icon.imageRect || { x: icon.x, y: icon.y, w: icon.w, h: icon.h } : null,
      status: position ? 'moving' : 'waiting',
      iconMissing: !position,
      error: null
    });
    if (position) readyCount += 1;
  }
  syncFileFoodSources();
  renderFileJobs();
  scheduleIconSync();
  updateWallpaperPatches();
  showToast(readyCount === result.jobs.length
    ? `已添加 ${readyCount} 个文件食物，蚂蚁正在寻找`
    : `已添加 ${result.jobs.length} 个文件，${result.jobs.length - readyCount} 个图标尚未定位`);
}

async function chooseFileJobs() {
  const button = document.getElementById('fileFoodBtn');
  button.disabled = true;
  let result;
  try {
    result = await window.antDesk.selectFileFoods();
  } catch (error) {
    result = { ok: false, message: error.message };
  } finally {
    button.disabled = false;
  }
  await addFileJobs(result);
}

function drawNest(time) {
  if (state.entryPortal?.rect) {
    // Keep the real shell icon until its exact background is ready. A solid
    // placeholder or a patch from the previous position becomes a visible box.
    if (state.portalBackdrop?.key !== wallpaperPatchKey(state.recycleBin) || !state.portalBackdrop?.image) return;
    window.AntSketchRenderer.drawPortalIcon(context, state.entryPortal.rect, time, state.portalBackdrop?.image);
    return;
  }
  const pulse = state.recycleBin ? 10 + Math.sin(time * 0.004) * 1.5 : 14 + Math.sin(time * 0.004) * 2;
  context.save();
  context.translate(nest.x, nest.y);
  if (state.entryPortal?.side === 'left' || state.entryPortal?.side === 'right') context.rotate(Math.PI / 2);
  context.beginPath();
  context.arc(0, 0, pulse, 0, Math.PI * 2);
  context.fillStyle = state.recycleBin ? 'rgba(255, 139, 79, .13)' : 'rgba(255, 139, 79, .18)';
  context.fill();
  context.beginPath();
  context.ellipse(0, 2, state.recycleBin ? 10 : 7, state.recycleBin ? 4 : 7, 0, 0, Math.PI * 2);
  context.fillStyle = '#1c1712';
  context.strokeStyle = '#ff9a5f';
  context.lineWidth = state.recycleBin ? 2 : 3;
  context.fill();
  context.stroke();
  context.restore();
}

function drawNestEntry(time) {
  const arrivals = state.snapshot?.ants?.filter((ant) => ant.mode === 'deposit') || [];
  const mouth = state.entryPortal?.mouth || nest;
  for (const slice of entrySlices.values()) slice.hidden = true;
  for (const ant of arrivals) {
    const progress = Math.min(1, Math.max(0, ant.entryProgress));
    const pose = window.AntSketchRenderer.portalPose(ant, state.entryPortal || { mouth });
    const { x, y } = pose;
    const angle = Math.atan2(mouth.y-ant.y,mouth.x-ant.x);
    const stretch = Math.sin(progress*Math.PI)*.12;
    const offsetX=10*pose.scale*(1+stretch), offsetY=-11.2*pose.scale*(1-stretch);
    const foodX=x+Math.cos(angle)*offsetX-Math.sin(angle)*offsetY;
    const foodY=y+Math.sin(angle)*offsetX+Math.cos(angle)*offsetY;
    if (ant.payloadKind === 'file') {
      let slice = entrySlices.get(ant.id);
      if (!slice) {
        slice = document.createElement('canvas');
        slice.className = 'entry-file-slice';
        slice.width = slice.height = 32;
        window.AntSketchRenderer.drawSpaceSnack(slice.getContext('2d'),16,16,32);
        entryPayloadLayer.append(slice);
        entrySlices.set(ant.id, slice);
      }
      slice.hidden = false;
      slice.style.left = `${foodX}px`;
      slice.style.top = `${foodY}px`;
      slice.style.opacity = String(pose.alpha);
      slice.style.transform = `translate(-50%, -50%) rotate(${angle}rad) scale(${pose.scale*(1+stretch)}, ${pose.scale*(1-stretch)})`;
    } else {
      context.save();
      context.translate(foodX, foodY);
      context.rotate(angle);
      context.scale(pose.scale, pose.scale);
      context.globalAlpha = pose.alpha;
      window.AntSketchRenderer.drawSpaceSnack(context,0,0,10);
      context.restore();
    }
    if (progress >= 0.55) {
      const lift = (progress - 0.55) / 0.45;
      context.save();
      context.fillStyle = `rgba(180, 255, 91, ${0.58 * (1 - lift)})`;
      for (let index = 0; index < 3; index += 1) {
        const spread = (index - 1) * 4 + ((ant.id % 3) - 1) * 1.2;
        context.beginPath();
        context.arc(mouth.x + spread, mouth.y - 1.5 - lift * (3 + index),
          0.6 + (index % 2) * 0.35, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }
  }
  if (!state.entryPortal || state.entryPortal.rect) return;
  const active = arrivals.length > 0;
  const { rim, side } = state.entryPortal;
  context.save();
  context.translate(rim.x, rim.y);
  if (side === 'left' || side === 'right') context.rotate(Math.PI / 2);
  context.beginPath();
  context.ellipse(0, 0, active ? 9.5 + Math.sin(time * 0.02) : 8, 3, 0, 0, Math.PI * 2);
  context.fillStyle = 'rgba(18, 29, 30, .58)';
  context.strokeStyle = active ? 'rgba(255, 197, 111, .92)' : 'rgba(226, 234, 232, .62)';
  context.lineWidth = 1.2;
  context.fill();
  context.stroke();
  context.restore();
}

function drawFood(time) {
  if (!state.food) return;
  window.AntSketchRenderer.drawSpaceSnack(context,state.food.x,state.food.y,23,time);
}

function drawAnt(ant) {
  context.save();
  context.translate(ant.x, ant.y);
  context.rotate(ant.angle);
  context.strokeStyle = 'rgba(22, 17, 13, .95)';
  context.lineWidth = 1.1;
  for (const side of [-1, 1]) {
    for (const offset of [-3, 0, 3]) {
      context.beginPath();
      context.moveTo(offset, side * 1.3);
      context.lineTo(offset - 1.5, side * 4.7);
      context.stroke();
    }
  }
  context.fillStyle = ant.carrying ? '#f6bd5c' : '#7f321e';
  context.strokeStyle = '#1b1511';
  for (const [x, y, radius] of [[-4, 0, 3], [0, 0, 2.6], [4, 0, 2.4]]) {
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  context.restore();
}

function releasePheromoneLayer() {
  for (const layer of new Set([
    state.pheromoneLayer, state.pheromoneScratch, state.pheromoneWork?.layer
  ])) {
    if (!layer) continue;
    layer.width = 1;
    layer.height = 1;
  }
  state.pheromoneLayer = null;
  state.pheromoneScratch = null;
  state.pheromoneWork = null;
  state.lastPheromoneCapture = 0;
}

function refreshPheromones(time) {
  if (!state.showPheromones || !state.colony || !state.visible) return;
  if (!state.pheromoneWork) {
    if(!state.running && state.pheromoneLayer && state.lastPheromoneCapture>0) return;
    if (state.pheromoneLayer && time - state.lastPheromoneCapture < PHEROMONE_REFRESH_MS) return;
    const layer = state.pheromoneScratch || document.createElement('canvas');
    const width = Math.max(1, Math.ceil(state.width * PHEROMONE_SCALE));
    const height = Math.max(1, Math.ceil(state.height * PHEROMONE_SCALE));
    if (layer.width !== width) layer.width = width;
    if (layer.height !== height) layer.height = height;
    const trailContext = layer.getContext('2d', { alpha: true });
    trailContext.setTransform(PHEROMONE_SCALE, 0, 0, PHEROMONE_SCALE, 0, 0);
    trailContext.clearRect(0, 0, state.width, state.height);
    trailContext.globalCompositeOperation = 'lighter';
    const traces = state.colony.snapshot({
      includePheromone: true, includeExploration: true, includeBestPath: false
    });
    state.pheromoneWork = { layer, context: trailContext,
      exploration: traces.explorationPheromone, food: traces.pheromone, index: 0 };
    state.pheromoneScratch = null;
    state.lastPheromoneCapture = time;
  }
  const work = state.pheromoneWork;
  const trailContext = work.context;
  const explorationCount = work.exploration.length;
  const end = Math.min(explorationCount + work.food.length,
    work.index + PHEROMONE_TRACES_PER_FRAME);
  if(!pheromoneStamps) {
    // Cache only the broad halo. Keep the bright core vector-drawn to preserve
    // Chromium's additive-light coverage at small desktop sizes.
    pheromoneStamps=document.createElement('canvas');
    pheromoneStamps.width=16*PHEROMONE_STAMP_SIZE;
    pheromoneStamps.height=32*PHEROMONE_STAMP_SIZE;
    const ink=pheromoneStamps.getContext('2d');ink.globalCompositeOperation='lighter';
    for(let kind=0;kind<2;kind++)for(let level=0;level<PHEROMONE_STAMP_LEVELS;level++) {
      const strength=level/(PHEROMONE_STAMP_LEVELS-1),exploring=kind===0;
      const index=kind*PHEROMONE_STAMP_LEVELS+level;
      ink.setTransform(PHEROMONE_SCALE,0,0,PHEROMONE_SCALE,(index%16)*PHEROMONE_STAMP_SIZE,Math.floor(index/16)*PHEROMONE_STAMP_SIZE);
      const x=5/PHEROMONE_SCALE,y=5/PHEROMONE_SCALE;
      ink.fillStyle=exploring?'rgba(0,255,246,'+strength*.08+')':'rgba(255,134,0,'+strength*.12+')';
      ink.beginPath();ink.arc(x,y,((exploring?4.5:5.5)+strength*2.5),0,Math.PI*2);ink.fill();

    }
  }
  const start=work.index;
  for (; work.index < end; work.index += 1) {
    const exploring = work.index < explorationCount;
    const trace = exploring ? work.exploration[work.index] :
      work.food[work.index - explorationCount];
    const strength = Math.min(1, Math.max(0, trace.strength));
    const index=(exploring?0:PHEROMONE_STAMP_LEVELS)+Math.round(strength*(PHEROMONE_STAMP_LEVELS-1));
    const size=PHEROMONE_STAMP_SIZE/PHEROMONE_SCALE;
    trailContext.drawImage(pheromoneStamps,(index%16)*PHEROMONE_STAMP_SIZE,
      Math.floor(index/16)*PHEROMONE_STAMP_SIZE,PHEROMONE_STAMP_SIZE,PHEROMONE_STAMP_SIZE,
      trace.x-size/2,trace.y-size/2,size,size);
  }
  // Keep texture copies and vector cores in separate batches. Alternating
  // between them forces Chromium's raster pipeline to flush for every trace.
  for(let index=start;index<end;index++) {
    const exploring=index<explorationCount;
    const trace=exploring?work.exploration[index]:work.food[index-explorationCount];
    const strength=Math.min(1,Math.max(0,trace.strength));
    trailContext.fillStyle = exploring
      ? 'rgba(80,255,250,'+strength*.42+')' : 'rgba(255,224,92,'+strength*.58+')';
    trailContext.beginPath();
    trailContext.arc(trace.x,trace.y,(exploring?1.2:1.5)+strength*(exploring?.8:1),0,Math.PI*2);
    trailContext.fill();
  }
  if (work.index === explorationCount + work.food.length) {
    trailContext.globalCompositeOperation = 'source-over';
    state.pheromoneScratch = state.pheromoneLayer;
    state.pheromoneLayer = work.layer;
    state.pheromoneWork = null;
  }
}

function drawMantouIcons(time) {
  const drawMantou = window.AntSketchRenderer?.drawMantouIcon || window.drawMantouIcon;
  if (!drawMantou) return;
  const progressById = new Map((state.snapshot?.fileFoods || []).map((item) => [item.id, item]));
  for (const job of state.fileJobs.values()) {
    if (!job.iconRect || job.status === 'completed') continue;
    const patch = state.wallpaperPatches.get(job.id);
    if (!patch?.image || patch.key !== wallpaperPatchKey(fileIconForPath(job.path))) continue;
    const backdrop = patch.image;
    const progress = progressById.get(job.id);
    // The source bun shrinks when a slice is cut and picked up. Keep a
    // quarter visible while that last slice is travelling to the nest.
    const picked = progress?.pickedBytes || 0;
    const remaining = job.size > 0 ? Math.max(0, 1 - picked / job.size) : 1;
    const portion = remaining <= 0 ? 0.25 : Math.max(0.25, Math.min(1, Math.ceil(remaining * 4) / 4));
    drawMantou(context, job.iconRect, time, backdrop, portion);
  }
}

function animatedMapRegions() {
  const regions=[];
  const add=(x,y,w,h)=>{
    const left=Math.max(0,Math.floor((x-2)*state.dpr)/state.dpr);
    const top=Math.max(0,Math.floor((y-2)*state.dpr)/state.dpr);
    const right=Math.min(state.width,Math.ceil((x+w+2)*state.dpr)/state.dpr);
    const bottom=Math.min(state.height,Math.ceil((y+h+2)*state.dpr)/state.dpr);
    if(right>left&&bottom>top)regions.push({x:left,y:top,w:right-left,h:bottom-top});
  };
  if(state.entryPortal?.rect){const r=state.entryPortal.rect;add(r.x,r.y,r.w,r.h);}
  else add(nest.x-25,nest.y-25,50,50);
  if(state.food)add(state.food.x-16,state.food.y-16,32,32);
  for(const job of state.fileJobs.values()) {
    if(job.iconRect&&job.status!=='completed'){const r=job.iconRect;add(r.x,r.y,r.w,r.h);}
  }
  for(const ant of state.snapshot.ants) {
    if(ant.mode!=='deposit')continue;
    const pose=window.AntSketchRenderer.portalPose(ant,state.entryPortal||{mouth:nest});
    add(pose.x-26,pose.y-26,52,52);
  }
  return regions;
}

function draw(time) {
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  if (!state.snapshot) {
    context.clearRect(0,0,state.width,state.height);mapPaint=null;
    for (const slice of entrySlices.values()) slice.hidden = true;
    return;
  }
  if(state.showPheromones)refreshPheromones(time);
  const regions=animatedMapRegions();
  const full=state.showBounds || !state.antRenderer || !mapPaint || mapPaint.width!==canvas.width || mapPaint.height!==canvas.height ||
    mapPaint.layer!==state.pheromoneLayer || mapPaint.pheromones!==state.showPheromones ||
    mapPaint.bounds!==state.showBounds || mapPaint.icons!==state.iconSignature;
  const dirty=full?null:[...mapPaint.regions,...regions];
  if(full)context.clearRect(0,0,state.width,state.height);
  else {
    for(const r of dirty) {
      context.clearRect(r.x,r.y,r.w,r.h);
      if(state.showPheromones&&state.pheromoneLayer) {
        const layer=state.pheromoneLayer,sx=layer.width/state.width,sy=layer.height/state.height;
        context.drawImage(layer,r.x*sx,r.y*sy,r.w*sx,r.h*sy,r.x,r.y,r.w,r.h);
      }
    }
  }
  mapPaint={width:canvas.width,height:canvas.height,layer:state.pheromoneLayer,
    pheromones:state.showPheromones,bounds:state.showBounds,icons:state.iconSignature,regions};
  if (full && state.showPheromones) {
    if (state.pheromoneLayer) context.drawImage(state.pheromoneLayer, 0, 0, state.width, state.height);
  }
  drawFood(time);
  if (!state.antRenderer) state.snapshot.ants.forEach(drawAnt);
  state.desktopIcons.forEach((icon) => {
    const { x, y, w, h } = icon.imageRect || icon;
    if(dirty&&!dirty.some(r=>r.x<x+w&&r.x+r.w>x&&r.y<y+h&&r.y+r.h>y))return;
    context.clearRect(x, y, w, h);
  });
  drawNest(state.snapshot.elapsed * 1000);
  if (state.showBounds) {
    context.setLineDash([4, 4]);
    context.strokeStyle = 'rgba(240, 168, 73, .65)';
    context.lineWidth = 1;
    state.desktopIcons.forEach((icon) => {
      const { x, y, w, h } = icon.imageRect || icon;
      context.strokeRect(x, y, w, h);
    });
    context.setLineDash([]);
  }
  drawMantouIcons(state.snapshot.elapsed*1000);
  drawNestEntry(time);
}

function tickSimulation(captureSnapshot = state.visible) {
  const now = performance.now();
  const elapsed = state.lastTick
    ? Math.min(state.visible ? 0.25 : 2, (now - state.lastTick) / 1000) : 0;
  state.lastTick = now;
  if (state.running && state.colony) {
    for (let remaining = elapsed; remaining > 0.0001;) {
      const step = Math.min(0.1, remaining);
      state.colony.step(step);
      remaining -= step;
    }
    if (captureSnapshot) {
      state.snapshot = snapshotForDisplay();
      checkFileCompletion();
    }
  }
}

function scheduleSimulation() {
  clearInterval(state.tickTimer);
  state.tickTimer = null;
  if (!state.lastTick) state.lastTick = performance.now();
  if (!state.visible && state.running) state.tickTimer = setInterval(() => tickSimulation(false), HIDDEN_TICK_MS);
}

function scheduleIconSync() {
  clearInterval(state.iconTimer);
  if (!state.visible || !hasTrackedFileIcons()) clearTrackedIconDrag();
  const delay = !state.visible ? HIDDEN_ICON_SYNC_MS
    : hasTrackedFileIcons() ? VISIBLE_FILE_ICON_SYNC_MS : VISIBLE_ICON_SYNC_MS;
  state.iconTimer = setInterval(syncDesktopIcons, delay);
}

function clearTrackedIconDrag() {
  clearTimeout(state.trackedIconDrag?.idleTimer);
  state.trackedIconDrag = null;
  state.adaptiveIconSyncWanted = false;
  clearTimeout(state.adaptiveIconSyncTimer);
  state.adaptiveIconSyncTimer = null;
}

function queueAdaptiveIconSync() {
  if (!state.visible || !hasTrackedFileIcons()) return;
  state.adaptiveIconSyncWanted = true;
  if (state.syncing || state.adaptiveIconSyncTimer !== null) return;
  const delay = Math.max(0, ACTIVE_ICON_SYNC_MS -
    (performance.now() - state.lastIconSyncStarted));
  state.adaptiveIconSyncTimer = setTimeout(() => {
    state.adaptiveIconSyncTimer = null;
    if (!state.adaptiveIconSyncWanted || !state.visible || !hasTrackedFileIcons()) return;
    if (state.syncing) return;
    state.adaptiveIconSyncWanted = false;
    scheduleIconSync();
    syncDesktopIcons();
  }, delay);
}

function trackIconDragCursor(point) {
  if (!state.visible || !hasTrackedFileIcons()) return;
  let drag = state.trackedIconDrag;
  if (!drag) {
    const overBun = [...state.fileJobs.values()].some((job) => job.iconRect &&
      job.status !== 'completed' && inside(point, job.iconRect));
    if (overBun) state.trackedIconDrag = { origin: point, previous: point, active: false, idleTimer: null };
    return;
  }
  const moved = Math.hypot(point.x - drag.previous.x, point.y - drag.previous.y);
  if (moved < 1) return;
  drag.previous = point;
  if (!drag.active && Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < 4) return;
  drag.active = true;
  clearTimeout(drag.idleTimer);
  drag.idleTimer = setTimeout(() => {
    if (state.trackedIconDrag !== drag) return;
    state.trackedIconDrag = null;
    queueAdaptiveIconSync();
  }, ICON_DRAG_IDLE_MS);
  queueAdaptiveIconSync();
}

function requestFrame() {
  if (!state.visible || state.frameId !== null) return;
  state.frameId = requestAnimationFrame(frame);
}

function paintVisibleNow() {
  if (!state.visible || !state.snapshot) return;
  if (state.frameId !== null) {
    cancelAnimationFrame(state.frameId);
    state.frameId = null;
  }
  frame(performance.now());
}

function frame(time) {
  state.frameId = null;
  if (!state.visible) return;
  tickSimulation();
  draw(time);
  if (state.antRenderer && state.snapshot) {
    try {
      state.antRenderer.render(state.snapshot.ants, state.desktopIcons, time, state.running, state.entryPortal);
    } catch (error) {
      console.error('Ant renderer failed:', error);
      state.antRenderer.dispose();
      state.antRenderer = null;
      state.rendererUnavailable = true;
      antCanvas.hidden = true;
      antCanvas.width = 1;
      antCanvas.height = 1;
    }
  }
  if (time - state.lastMetrics > 180) {
    state.lastMetrics = time;
    updateMetrics();
  }
  if(state.running || state.pheromoneWork) requestFrame();
}

function setCapture(capture) {
  if (capture === state.captured) return;
  state.captured = capture;
  window.antDesk.setMouseMode(!capture);
}

function panelHit(point) {
  const rect = panel.getBoundingClientRect();
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function updateMouseCapture(point) {
  const nearFood = Boolean(state.food && Math.hypot(point.x - state.food.x, point.y - state.food.y) < 18);
  document.body.classList.toggle('food-hover', nearFood && !state.placingFood);
  setCapture(Boolean(state.placingFood || state.draggingFood || panelHit(point) || nearFood));
}

window.addEventListener('mousemove', (event) => {
  const point = { x: event.clientX, y: event.clientY };
  if (state.draggingFood) {
    state.food.x = Math.max(12, Math.min(state.width - 12, point.x));
    state.food.y = Math.max(12, Math.min(state.height - 12, point.y));
    requestFrame();
  }
  updateMouseCapture(point);
});

canvas.addEventListener('pointerdown', (event) => {
  const point = { x: event.clientX, y: event.clientY };
  if (state.placingFood) {
    if (isBlocked(point)) { showToast('请放在图标以外'); return; }
    if (state.colony && !state.colony.canReach(point)) {
      showToast('这个位置与回收站巢穴不连通，请换一个空白处');
      return;
    }
    state.food = point;
    state.placingFood = false;
    document.body.classList.remove('placing-food');
    document.getElementById('placeFoodBtn').classList.remove('selected');
    setTerrain({ food: state.food });
    showToast('食物已放好，蚂蚁正在探索');
    updateMouseCapture(point);
    return;
  }
  if (state.food && Math.hypot(point.x - state.food.x, point.y - state.food.y) < 18) {
    state.draggingFood = { ...state.food };
    canvas.setPointerCapture(event.pointerId);
  }
});

canvas.addEventListener('pointerup', (event) => {
  if (!state.draggingFood) return;
  let validPlacement = true;
  if (isBlocked(state.food)) {
    state.food = state.draggingFood;
    validPlacement = false;
    showToast('食物不能放在图标上');
  } else if (state.colony && !state.colony.canReach(state.food)) {
    state.food = state.draggingFood;
    validPlacement = false;
    showToast('这个位置与回收站巢穴不连通');
  }
  state.draggingFood = null;
  setTerrain({ food: state.food });
  updateMouseCapture({ x: event.clientX, y: event.clientY });
});

function toggleFoodPlacement() {
  state.placingFood = !state.placingFood;
  document.body.classList.toggle('placing-food', state.placingFood);
  document.getElementById('placeFoodBtn').classList.toggle('selected', state.placingFood);
  if (state.placingFood) {
    setCapture(true);
    showToast('在桌面空白处点击放置食物');
  } else {
    setCapture(false);
  }
}

document.getElementById('placeFoodBtn').addEventListener('click', toggleFoodPlacement);
document.getElementById('fileFoodBtn').addEventListener('click', chooseFileJobs);
document.getElementById('pheromoneToggle').addEventListener('change', (event) => {
  state.showPheromones = event.target.checked;
  if (!state.showPheromones) releasePheromoneLayer();
  requestFrame();
});
document.getElementById('runBtn').addEventListener('click', () => {
  tickSimulation();
  state.running = !state.running;
  scheduleSimulation();
  updateMetrics();
  requestFrame();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  state.food = null;
  state.placingFood = false;
  document.body.classList.remove('placing-food');
  document.getElementById('placeFoodBtn').classList.remove('selected');
  setTerrain({ food: state.food });
  showToast('食物已清除，蚂蚁继续探索');
});
document.getElementById('editModeBtn').addEventListener('click', () => {
  state.showBounds = !state.showBounds;
  if (state.visible && state.colony) state.snapshot = snapshotForDisplay();
  const button = document.getElementById('editModeBtn');
  button.setAttribute('aria-pressed', String(state.showBounds));
  button.textContent = state.showBounds ? '隐藏边界' : '图标边界';
  requestFrame();
});
document.getElementById('collapseBtn').addEventListener('click', () => {
  const collapsed = panel.classList.toggle('collapsed');
  const button = document.getElementById('collapseBtn');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? '展开面板' : '收起面板');
  button.title = collapsed ? '展开面板' : '收起面板';
});
document.querySelectorAll('[data-window]').forEach((button) => {
  button.addEventListener('click', () => window.antDesk.windowControl(button.dataset.window));
});
window.antDesk.onSystemEvent('desktop:toggle-edit', () => document.getElementById('editModeBtn').click());
window.antDesk.onSystemEvent('desktop:place-food', toggleFoodPlacement);
window.antDesk.onSystemEvent('desktop:cursor', (point) => {
  if (state.visible && Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
    updateMouseCapture(point);
    trackIconDragCursor(point);
  }
});
window.antDesk.onSystemEvent('desktop:visibility', (visible) => {
  if (state.visible !== Boolean(visible)) tickSimulation(false);
  state.visible = Boolean(visible);
  entryPayloadLayer.hidden = !state.visible;
  if (state.visible) {
    resizeCanvas();
    ensureAntRenderer();
  } else {
    state.snapshot = null;
    resizeMapBacking();
    releasePheromoneLayer();
  }
  state.antRenderer?.setVisible(state.visible);
  if (state.visible && state.colony) {
    // Capture a frame before the first visible RAF so returning to the desktop
    // never depends on a later click or another state change.
    state.snapshot = snapshotForDisplay();
  }
  if (!state.visible) {
    const toast = document.getElementById('mapToast');
    clearTimeout(state.toastTimer);
    if (toast.classList.contains('show')) state.pendingToasts.unshift(toast.textContent);
    toast.classList.remove('show');
  }
  scheduleSimulation();
  scheduleIconSync();
  if (state.visible) {
    const iconSync = syncDesktopIcons();
    paintVisibleNow();
    window.antDesk.desktopFrameReady?.();
    iconSync.finally(() => {
      if (state.visible) paintVisibleNow();
    });
    checkFileCompletion();
    replayPendingToasts();
    requestFrame();
  } else if (state.frameId !== null) {
    cancelAnimationFrame(state.frameId);
    state.frameId = null;
  }
});
window.addEventListener('resize', resizeCanvas);
document.addEventListener('visibilitychange', () => {
  // Windows may restore an occluded surface without changing our logical
  // desktop state. Repaint that surface without waiting for a focus/click.
  if (!document.hidden && state.visible) {
    paintVisibleNow();
    window.antDesk.desktopFrameReady?.();
  }
});

async function init() {
  document.getElementById('editModeBtn').textContent = '图标边界';
  document.getElementById('editModeBtn').title = '显示真实图标边界 · Ctrl + Alt + A';
  resizeCanvas();
  renderObjectList();
  renderFileJobs();
  updateMetrics();
  window.antDesk.onFileFoodDrag(showFirstFileDragHint);
  window.antDesk.onFileFoodDrop(addFileJobs);
  await syncDesktopIcons();
  scheduleIconSync();
  scheduleSimulation();
  requestFrame();
}

init();
