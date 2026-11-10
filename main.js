const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID, createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const readline = require('node:readline');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

let mainWindow;
let focusTimer;
let cursorTimer;
let iconProbe;
let iconProbeRestart;
let probeStartPromise;
let nativeProbeUnavailable = false;
let pendingIconRead;
let desktopFocused = false;
let windowLoaded = false;
let quitting = false;
let reportedVisibility = null;
const activeFileFoodJobs = new Map();
let choosingFileFood = false;
let finishFileFoodQueue = Promise.resolve();
const MAX_FILE_FOOD_BATCH = 24;
const CURSOR_SYNC_MS = 60;
const updateFeedUrl = require('./package.json').antUpdateUrl || '';
let updateCheckPromise = null;
let updateAvailable = false;
let updateDownloaded = false;

function sameFileIdentity(left, right) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']
    .every((field) => left[field] === right[field]);
}

function isWithinDirectory(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function desktopPathFallback() {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(userProfile, 'Desktop');
}

function desktopDialogPath() {
  try {
    return app.getPath('desktop');
  } catch {
    return desktopPathFallback();
  }
}

function publicDesktopPath() {
  if (process.env.PUBLIC) return path.join(process.env.PUBLIC, 'Desktop');
  return path.join(process.env.SystemDrive || 'C:', 'Users', 'Public', 'Desktop');
}

async function desktopDirectories() {
  const candidates = [desktopDialogPath(), publicDesktopPath()];
  const directories = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const canonical = await fs.realpath(candidate);
      const stat = await fs.lstat(canonical, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      if (!directories.some((directory) => directory.toLowerCase() === canonical.toLowerCase())) {
        directories.push(canonical);
      }
    } catch {
      // A missing Public Desktop should not prevent using the user Desktop.
    }
  }
  return directories;
}

function isDirectChildOfDirectory(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return Boolean(relative) && !path.isAbsolute(relative) &&
    relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !relative.includes(path.sep);
}

function isDirectDesktopFile(filePath, directories) {
  return directories.some((directory) => isDirectChildOfDirectory(filePath, directory));
}

function isLocalFilePath(filePath) {
  return /^[A-Za-z]:\\/.test(filePath);
}

async function isFixedLocalDrive(filePath) {
  if (!isLocalFilePath(filePath)) return false;
  const drive = filePath[0].toUpperCase();
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `([System.IO.DriveInfo]::new('${drive}:\\')).DriveType.ToString()`
    ], { timeout: 3000, windowsHide: true });
    return stdout.trim() === 'Fixed';
  } catch {
    return false;
  }
}

function fileFoodError(message) {
  return { ok: false, message };
}

function sendUpdateStatus(status, details = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:update-status', { status, ...details });
}

function reportUpdateError(error) {
  console.error('Application update failed:', error);
  sendUpdateStatus('error', { message: '更新失败，请检查网络后重试。' });
}

function initializeAutoUpdater() {
  if (!app.isPackaged || !updateFeedUrl) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => {
    updateAvailable = true;
    updateDownloaded = false;
    sendUpdateStatus('available', { version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => {
    updateAvailable = false;
    updateDownloaded = false;
    sendUpdateStatus('current', { version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', { percent: Math.floor(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    sendUpdateStatus('downloaded', { version: info.version });
  });
  autoUpdater.on('error', reportUpdateError);
}

async function checkForAppUpdate() {
  if (!app.isPackaged) return { ok: false, reason: 'development' };
  if (!updateFeedUrl) return { ok: false, reason: 'not-configured' };
  if (updateCheckPromise) return { ok: true, status: 'checking' };
  try {
    updateCheckPromise = autoUpdater.checkForUpdates();
    const result = await updateCheckPromise;
    return {
      ok: true,
      status: result?.isUpdateAvailable ? 'available' : 'checking',
      version: result?.updateInfo?.version
    };
  } catch (error) {
    reportUpdateError(error);
    return { ok: false, reason: 'failed' };
  } finally {
    updateCheckPromise = null;
  }
}

async function downloadAppUpdate() {
  if (!app.isPackaged || !updateFeedUrl) return { ok: false, reason: 'not-configured' };
  if (!updateAvailable) return { ok: false, reason: 'no-update' };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    reportUpdateError(error);
    return { ok: false, reason: 'failed' };
  }
}

function installAppUpdate() {
  if (!app.isPackaged || !updateFeedUrl || !updateDownloaded) {
    return { ok: false, reason: 'not-ready' };
  }
  if (choosingFileFood || activeFileFoodJobs.size > 0) {
    return { ok: false, reason: 'active-file-jobs', count: activeFileFoodJobs.size };
  }
  sendUpdateStatus('installing');
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
}


async function validateFileFoodPath(selectedPath, allowedDesktopDirectories, projectPath) {
  if (!await isFixedLocalDrive(selectedPath)) throw new Error('只能选择本机固定磁盘上的普通文件。');
  const selectedStat = await fs.lstat(selectedPath, { bigint: true });
  if (!selectedStat.isFile() || selectedStat.isSymbolicLink()) {
    throw new Error('只能选择普通文件，不能选择文件夹或链接。');
  }
  const filePath = await fs.realpath(selectedPath);
  if (!await isFixedLocalDrive(filePath) || isWithinDirectory(filePath, projectPath)) {
    throw new Error('不能选择网络、移动磁盘或蚁群程序自身的文件。');
  }
  if (!isDirectDesktopFile(filePath, allowedDesktopDirectories)) {
    throw new Error('只能选择桌面目录中的文件，不能选择其他目录或文件夹内的文件。');
  }
  const identity = await fs.lstat(filePath, { bigint: true });
  if (!identity.isFile() || identity.isSymbolicLink() || !sameFileIdentity(selectedStat, identity)) {
    throw new Error('文件在选择过程中发生了变化，请重新选择。');
  }
  if (identity.size < 2n) throw new Error('文件至少需要 2 字节，才能切成比原文件更小的片段。');
  if (identity.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('文件过大，无法安全计算搬运进度。');
  }
  return { path: filePath, name: path.basename(filePath), size: Number(identity.size), identity };
}

async function collectFileFoodPaths(selectedPaths) {
  if (!Array.isArray(selectedPaths) || !selectedPaths.length || selectedPaths.length > MAX_FILE_FOOD_BATCH ||
    selectedPaths.some((value) => typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0'))) {
    return fileFoodError(`一次只能添加 1～${MAX_FILE_FOOD_BATCH} 个桌面文件。`);
  }
  try {
    const allowedDesktopDirectories = await desktopDirectories();
    if (!allowedDesktopDirectories.length) return fileFoodError('找不到 Windows 桌面目录，无法选择桌面文件。');
    const projectPath = await fs.realpath(__dirname);
    const candidates = [];
    const seen = new Set();
    let skipped = 0;
    for (const selectedPath of selectedPaths) {
      const candidate = await validateFileFoodPath(selectedPath, allowedDesktopDirectories, projectPath);
      const key = candidate.path.toLowerCase();
      if (seen.has(key) || [...activeFileFoodJobs.values()].some((job) => job.path.toLowerCase() === key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      candidates.push(candidate);
    }
    if (activeFileFoodJobs.size + candidates.length > MAX_FILE_FOOD_BATCH) {
      return fileFoodError(`同时最多搬运 ${MAX_FILE_FOOD_BATCH} 个文件，请等待已有任务完成。`);
    }
    if (!candidates.length) return { ok: true, jobs: [], skipped };
    const totalSize = candidates.reduce((sum, candidate) => sum + BigInt(candidate.size), 0n);
    const names = candidates.slice(0, 8).map((candidate) => candidate.name).join('\n');
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '确认文件搬运',
      message: candidates.length === 1
        ? `让蚂蚁搬运“${candidates[0].name}”？`
        : `让蚂蚁搬运这 ${candidates.length} 个桌面文件？`,
      detail: `${names}${candidates.length > 8 ? `\n等 ${candidates.length} 个文件` : ''}\n\n合计：${totalSize.toLocaleString('zh-CN')} 字节。每个文件搬完后会分别询问是否移入 Windows 回收站，默认保留原文件。`,
      buttons: ['取消', '开始搬运'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return null;
    const currentDesktopDirectories = await desktopDirectories();
    for (const candidate of candidates) {
      const current = await validateFileFoodPath(candidate.path, currentDesktopDirectories, projectPath);
      if (current.path.toLowerCase() !== candidate.path.toLowerCase() ||
        !sameFileIdentity(candidate.identity, current.identity)) {
        return fileFoodError('文件在确认过程中发生了变化，未开始搬运。');
      }
    }
    const jobs = candidates.map((candidate) => {
      const id = randomUUID();
      activeFileFoodJobs.set(id, { ...candidate, id, finishing: false });
      return { id, name: candidate.name, path: candidate.path, size: candidate.size };
    });
    return { ok: true, jobs, skipped };
  } catch (error) {
    return fileFoodError(`无法添加文件：${error.message}`);
  }
}

async function addFileFoodPaths(selectedPaths) {
  if (choosingFileFood) return fileFoodError('正在选择文件，请稍后再试。');
  choosingFileFood = true;
  try {
    return await collectFileFoodPaths(selectedPaths);
  } finally {
    choosingFileFood = false;
  }
}

async function chooseFileFoods(single = false) {
  if (choosingFileFood) return fileFoodError('正在选择文件，请稍后再试。');
  if (single && activeFileFoodJobs.size) return fileFoodError('已有文件正在搬运，请先取消当前任务。');
  choosingFileFood = true;
  try {
    const result = await dialog.showOpenDialog({
      title: '选择文件食物',
      buttonLabel: '选择文件',
      defaultPath: desktopDialogPath(),
      properties: single ? ['openFile'] : ['openFile', 'multiSelections']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return await collectFileFoodPaths(result.filePaths);
  } catch (error) {
    return fileFoodError(`无法选择文件：${error.message}`);
  } finally {
    choosingFileFood = false;
  }
}

async function selectFileFood() {
  const result = await chooseFileFoods(true);
  return result?.ok === false ? result : result?.jobs?.[0] || null;
}

async function selectFileFoods() {
  return chooseFileFoods(false);
}

async function finishOneFileFood(job) {
  try {
    const currentPath = await fs.realpath(job.path);
    const currentIdentity = await fs.lstat(job.path, { bigint: true });
    if (!await isFixedLocalDrive(job.path) || !isDirectDesktopFile(currentPath, await desktopDirectories())
      || currentPath.toLowerCase() !== job.path.toLowerCase() || !currentIdentity.isFile()
      || currentIdentity.isSymbolicLink() || !sameFileIdentity(job.identity, currentIdentity)) {
      return fileFoodError('原文件已移动或修改，未移入回收站。');
    }
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '确认移入回收站',
      message: `文件片段已全部送达。将“${path.basename(job.path)}”移入回收站？`,
      detail: `${job.path}\n\n大小：${job.size.toLocaleString('zh-CN')} 字节。选择“保留文件”不会修改原文件。`,
      buttons: ['保留文件', '移入回收站'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return fileFoodError('已保留原文件，未移入回收站。');
    const finalPath = await fs.realpath(job.path);
    const finalIdentity = await fs.lstat(job.path, { bigint: true });
    if (!await isFixedLocalDrive(job.path) || !isDirectDesktopFile(finalPath, await desktopDirectories())
      || finalPath.toLowerCase() !== job.path.toLowerCase()
      || !finalIdentity.isFile() || finalIdentity.isSymbolicLink()
      || !sameFileIdentity(job.identity, finalIdentity)) {
      return fileFoodError('确认后原文件发生变化，未移入回收站。');
    }
    await shell.trashItem(job.path);
    if (activeFileFoodJobs.get(job.id) === job) activeFileFoodJobs.delete(job.id);
    return { ok: true };
  } catch (error) {
    return fileFoodError(`无法移入回收站，原文件未处理：${error.message}`);
  }
}

async function finishFileFood(id, deliveredBytes) {
  const job = activeFileFoodJobs.get(id);
  if (!job) return fileFoodError('文件任务已取消或替换，原文件未处理。');
  if (job.finishing) return fileFoodError('文件正在移入回收站，请稍候。');
  if (!Number.isSafeInteger(deliveredBytes) || deliveredBytes !== job.size) {
    return fileFoodError('搬运字节数尚未与文件大小一致，原文件未处理。');
  }
  job.finishing = true;
  const pending = finishFileFoodQueue.then(() => finishOneFileFood(job));
  finishFileFoodQueue = pending.then(() => {}, () => {});
  try {
    return await pending;
  } finally {
    job.finishing = false;
  }
}

function cancelFileFood(id) {
  const job = activeFileFoodJobs.get(id);
  if (!job) return fileFoodError('文件任务已不存在。');
  if (job.finishing) return fileFoodError('正在移入回收站，无法取消。');
  activeFileFoodJobs.delete(id);
  return { ok: true };
}

function sendCursorPoint() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || !windowLoaded) return;
  const cursor = screen.getCursorScreenPoint();
  const content = mainWindow.getContentBounds();
  mainWindow.webContents.send('desktop:cursor', {
    x: cursor.x - content.x,
    y: cursor.y - content.y
  });
}

function startCursorSync() {
  if (cursorTimer) return;
  sendCursorPoint();
  cursorTimer = setInterval(sendCursorPoint, CURSOR_SYNC_MS);
}

function stopCursorSync() {
  clearInterval(cursorTimer);
  cursorTimer = null;
}

function updateVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const visible = desktopFocused && windowLoaded;
  if (visible) {
    const windowNeedsRestore = mainWindow.isMinimized() || !mainWindow.isVisible();
    const visibilityChanged = reportedVisibility !== true || windowNeedsRestore;
    // Prime the renderer before showing the transparent window. This avoids a
    // blank first frame when the desktop becomes foreground again.
    if (visibilityChanged) {
      reportedVisibility = true;
      mainWindow.webContents.send('desktop:visibility', true);
    }
    if (visibilityChanged) {
      // Show Desktop can minimize an otherwise "visible" transparent window.
      // Restore without taking focus away from Explorer or selecting an icon.
      if (mainWindow.isMinimized()) {
        const focusable = mainWindow.isFocusable();
        mainWindow.setFocusable(false);
        mainWindow.restore();
        mainWindow.showInactive();
        mainWindow.setFocusable(focusable);
      } else mainWindow.showInactive();
      mainWindow.webContents.invalidate();
    }
    startCursorSync();
    return;
  }
  // The native probe recognizes Explorer drag windows. Real app switches
  // must hide immediately, before the next renderer/compositor frame.
  if (mainWindow.isVisible()) mainWindow.hide();
  if (windowLoaded && reportedVisibility !== false) {
    reportedVisibility = false;
    mainWindow.webContents.send('desktop:visibility', false);
  }
  stopCursorSync();
}

async function nativeDesktopProbePath() {
  const sourcePath = path.join(__dirname, 'desktop-probe.cs');
  const source = await fs.readFile(sourcePath);
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const userData = app.getPath('userData');
  const binaryPath = path.join(userData, `desktop-probe-${hash}.exe`);
  try {
    await fs.access(binaryPath);
    return binaryPath;
  } catch {
    // Compile once per source version; the desktop shortcut also uses this path.
  }

  const framework = process.arch === 'x64' ? 'Framework64' : 'Framework';
  const compiler = path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows',
    'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe');
  const temporaryPath = path.join(userData, `desktop-probe-${hash}-${process.pid}.exe`);
  await fs.mkdir(userData, { recursive: true });
  try {
    await execFileAsync(compiler, [
      '/nologo', '/target:exe', process.arch === 'x64' ? '/platform:x64' : '/platform:x86',
      '/r:System.Web.Extensions.dll', `/out:${temporaryPath}`, sourcePath
    ], { timeout: 15000, windowsHide: true });
    await fs.rename(temporaryPath, binaryPath);
    return binaryPath;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

let wallpaperPatchBinaryPromise;

async function prepareWallpaperPatchBinary() {
  const sourcePath = path.join(__dirname, 'wallpaper-patches.cs');
  const hash = createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex').slice(0, 16);
  const userData = app.getPath('userData');
  const binaryPath = path.join(userData, `wallpaper-patches-${hash}.exe`);
  try {
    await fs.access(binaryPath);
    return binaryPath;
  } catch {
    // Compile on first food icon; the process exits after returning tiny patches.
  }
  const framework = process.arch === 'x64' ? 'Framework64' : 'Framework';
  const compiler = path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows',
    'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe');
  const temporaryPath = path.join(userData, `wallpaper-patches-${hash}-${process.pid}.exe`);
  await fs.mkdir(userData, { recursive: true });
  try {
    await execFileAsync(compiler, [
      '/nologo', '/target:exe', process.arch === 'x64' ? '/platform:x64' : '/platform:x86',
      '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', `/out:${temporaryPath}`, sourcePath
    ], { timeout: 15000, windowsHide: true });
    await fs.rename(temporaryPath, binaryPath);
    return binaryPath;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function wallpaperPatchBinaryPath() {
  if (!wallpaperPatchBinaryPromise) wallpaperPatchBinaryPromise = prepareWallpaperPatchBinary();
  try {
    return await wallpaperPatchBinaryPromise;
  } catch (error) {
    wallpaperPatchBinaryPromise = null;
    throw error;
  }
}

async function wallpaperPatches(icons) {
  if (!Array.isArray(icons) || icons.length > MAX_FILE_FOOD_BATCH) {
    throw new Error('Invalid wallpaper patch request');
  }
  const requests = icons.map((icon) => ({
    id: icon.id,
    x: icon.physicalX,
    y: icon.physicalY,
    w: icon.physicalW,
    h: icon.physicalH
  }));
  if (requests.some(({ id, x, y, w, h }) => typeof id !== 'string' || !id || id.length > 80 ||
    ![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || w > 512 || h > 512)) {
    throw new Error('Invalid wallpaper patch rectangle');
  }
  if (!requests.length) return [];
  const binary = await wallpaperPatchBinaryPath();
  const { stdout } = await execFileAsync(binary, [JSON.stringify(requests)], {
    timeout: 15000, windowsHide: true, maxBuffer: 8 * 1024 * 1024
  });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== requests.length) {
    throw new Error('Invalid wallpaper patch response');
  }
  return result;
}

function startFocusProbe() {
  if (quitting || focusTimer) return;
  startIconProbe().catch((error) => console.error('Desktop probe startup:', error));
  focusTimer = setInterval(() => {
    const probe = iconProbe;
    if (!probe) return;
    probe.stdin.write('focus\n', (error) => {
      if (error && iconProbe === probe) stopIconProbe(error);
    });
  }, 250);
}

function rejectIconRead(error) {
  if (!pendingIconRead) return;
  const request = pendingIconRead;
  pendingIconRead = null;
  clearTimeout(request.timer);
  request.reject(error);
}

function stopIconProbe(error) {
  const probe = iconProbe;
  iconProbe = null;
  rejectIconRead(error || new Error('Desktop icon probe stopped'));
  probe?.kill();
  if (!quitting && probe?.native) nativeProbeUnavailable = true;
  desktopFocused = false;
  updateVisibility();
  if (!quitting && !iconProbeRestart) {
    iconProbeRestart = setTimeout(() => {
      iconProbeRestart = null;
      startIconProbe().catch((failure) => console.error('Desktop probe restart:', failure));
    }, 1000);
  }
}

async function startIconProbe() {
  if (quitting) return null;
  if (iconProbe) return iconProbe;
  if (probeStartPromise) return probeStartPromise;
  clearTimeout(iconProbeRestart);
  iconProbeRestart = null;
  probeStartPromise = (async () => {
    let executable = 'powershell.exe';
    let args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'desktop-icons.ps1'), '-Watch', '-ProcessId', String(process.pid)
    ];
    let native = false;
    if (!nativeProbeUnavailable) {
      try {
        executable = await nativeDesktopProbePath();
        args = ['-Watch', '-ProcessId', String(process.pid)];
        native = true;
      } catch (error) {
        nativeProbeUnavailable = true;
        console.error('Native desktop probe unavailable; using PowerShell:', error);
      }
    }
    if (quitting) return null;
    const probe = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    probe.native = native;
    iconProbe = probe;
    readline.createInterface({ input: probe.stdout }).on('line', (line) => {
      if (line === 'focus:desktop' || line === 'focus:other') {
        desktopFocused = line === 'focus:desktop';
        updateVisibility();
        return;
      }
      if (!pendingIconRead) return;
      const request = pendingIconRead;
      pendingIconRead = null;
      clearTimeout(request.timer);
      try {
        if (line.length > 1024 * 1024) throw new Error('Desktop icon response is too large');
        const icons = JSON.parse(line);
        if (!Array.isArray(icons)) throw new Error('Desktop icon response is invalid');
        request.resolve(icons);
      } catch (error) {
        request.reject(error);
      }
    });
    probe.stderr.setEncoding('utf8');
    probe.stderr.on('data', (message) => console.error('Desktop icon probe:', message.trim()));
    probe.on('error', (error) => {
      if (iconProbe === probe) stopIconProbe(error);
    });
    probe.on('close', () => {
      if (iconProbe === probe) stopIconProbe(new Error('Desktop icon probe exited'));
    });
    return probe;
  })();
  try {
    return await probeStartPromise;
  } finally {
    probeStartPromise = null;
  }
}

async function readDesktopIcons() {
  if (pendingIconRead) return pendingIconRead.promise;
  const probe = await startIconProbe();
  if (!probe) throw new Error('Desktop icon probe is unavailable');
  if (pendingIconRead) return pendingIconRead.promise;
  const promise = new Promise((resolve, reject) => {
    const request = { resolve, reject, timer: null, promise: null };
    request.timer = setTimeout(() => {
      if (pendingIconRead === request) stopIconProbe(new Error('Desktop icon probe timed out'));
    }, 6000);
    pendingIconRead = request;
    try {
      probe.stdin.write('icons\n', (error) => {
        if (error && pendingIconRead === request) stopIconProbe(error);
      });
    } catch (error) {
      stopIconProbe(error);
    }
  });
  pendingIconRead.promise = promise;
  return promise;
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const width = bounds.width;
  const height = bounds.height;
  const x = bounds.x;
  const y = bounds.y;

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 600,
    minHeight: 420,
    frame: false,
    transparent: true,
    show: false,
    resizable: true,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  windowLoaded = false;
  reportedVisibility = null;
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    windowLoaded = true;
    updateVisibility();
  });
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.on('closed', () => {
    stopCursorSync();
    mainWindow = null;
    windowLoaded = false;
  });
}

if (app.requestSingleInstanceLock()) app.whenReady().then(() => {
  initializeAutoUpdater();
  ipcMain.handle('desktop:icons', () => readDesktopIcons());
  ipcMain.handle('desktop:wallpaper-patches', (_event, icons) => wallpaperPatches(icons));
  ipcMain.on('desktop:frame-ready', (event) => {
    if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
        desktopFocused && reportedVisibility === true) {
      // Explicitly submit the newly painted transparent surface after resume.
      mainWindow.webContents.invalidate();
    }
  });
  ipcMain.handle('file-food:select', () => selectFileFood());
  ipcMain.handle('file-food:select-many', () => selectFileFoods());
  ipcMain.handle('file-food:add-paths', (_event, paths) => addFileFoodPaths(paths));
  ipcMain.handle('file-food:finish', (_event, id, deliveredBytes) => finishFileFood(id, deliveredBytes));
  ipcMain.handle('file-food:cancel', (_event, id) => cancelFileFood(id));
  ipcMain.handle('app:update-check', () => checkForAppUpdate());
  ipcMain.handle('app:update-download', () => downloadAppUpdate());
  ipcMain.handle('app:update-install', () => installAppUpdate());
  ipcMain.handle('window:control', (_event, action) => {
    if (!mainWindow) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'close') mainWindow.close();
    if (action === 'toggle-always-on-top') mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop(), 'floating');
  });
  ipcMain.handle('window:mouse-mode', (_event, passThrough) => {
    if (!mainWindow) return;
    mainWindow.setIgnoreMouseEvents(Boolean(passThrough), { forward: true });
  });
  globalShortcut.register('CommandOrControl+Alt+A', () => {
    if (mainWindow?.isVisible()) mainWindow.webContents.send('desktop:toggle-edit');
  });
  globalShortcut.register('CommandOrControl+Alt+F', () => {
    if (mainWindow?.isVisible()) mainWindow.webContents.send('desktop:place-food');
  });
  createWindow();
  startFocusProbe();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
else app.quit();

app.on('will-quit', () => {
  quitting = true;
  clearInterval(focusTimer);
  focusTimer = null;
  stopCursorSync();
  clearTimeout(iconProbeRestart);
  stopIconProbe();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
