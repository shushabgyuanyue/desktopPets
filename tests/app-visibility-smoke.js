const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

ipcMain.handle('desktop:icons', () => []);
ipcMain.handle('window:mouse-mode', () => {});

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    transparent: true,
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
    const initial = await window.webContents.executeJavaScript(`({
      visible: state.visible,
      hasRenderer: Boolean(state.antRenderer),
      hasSnapshot: Boolean(state.snapshot),
      mapBacking: [canvas.width, canvas.height]
    })`);
    window.webContents.send('desktop:visibility', true);
    const immediateVisible = await window.webContents.executeJavaScript(`({
      visible: state.visible,
      hasSnapshot: Boolean(state.snapshot),
      antBacking: [antCanvas.width, antCanvas.height],
      framePending: state.frameId !== null
    })`);
    await pause(300);
    await window.webContents.executeJavaScript(`
      window.renderCount = 0;
      const originalRender = state.antRenderer.render;
      state.antRenderer.render = (...args) => {
        window.renderCount += 1;
        return originalRender(...args);
      };
      true;
    `);
    await window.webContents.executeJavaScript('frame(performance.now()); true');
    await pause(200);
    const visibleTimerActive = await window.webContents.executeJavaScript('state.tickTimer !== null');
    window.webContents.send('desktop:visibility', false);
    await pause(100);
    const hiddenStart = await window.webContents.executeJavaScript(`(() => {
      window.hiddenSnapshotCalls = 0;
      window.originalSnapshot = state.colony.snapshot;
      state.colony.snapshot = (...args) => {
        window.hiddenSnapshotCalls += 1;
        return window.originalSnapshot(...args);
      };
      return {
        elapsed: window.originalSnapshot().elapsed,
        hasSnapshot: Boolean(state.snapshot),
        hiddenTimerActive: state.tickTimer !== null,
        renderCount: window.renderCount,
        framePending: state.frameId !== null,
        mapBacking: [canvas.width, canvas.height],
        antBacking: [antCanvas.width, antCanvas.height]
      };
    })()`);
    await pause(1100);
    const hiddenEnd = await window.webContents.executeJavaScript(`({
      elapsed: window.originalSnapshot().elapsed,
      snapshotCalls: window.hiddenSnapshotCalls,
      hasSnapshot: Boolean(state.snapshot),
      renderCount: window.renderCount,
      framePending: state.frameId !== null
    })`);
    const hiddenResize = await window.webContents.executeJavaScript(`(() => {
      resizeCanvas();
      return { mapBacking: [canvas.width, canvas.height], antBacking: [antCanvas.width, antCanvas.height] };
    })()`);
    window.webContents.send('desktop:visibility', true);
    await pause(100);
    await window.webContents.executeJavaScript('frame(performance.now()); true');
    await pause(400);
    const resumed = await window.webContents.executeJavaScript(`({
      elapsed: state.snapshot.elapsed,
      renderCount: window.renderCount,
      framePending: state.frameId !== null,
      mapBacking: [canvas.width, canvas.height],
      antBacking: [antCanvas.width, antCanvas.height],
      expectedMapBacking: [Math.round(state.width * state.dpr), Math.round(state.height * state.dpr)],
      expectedAntBacking: [Math.round(state.width * state.dpr), Math.round(state.height * state.dpr)]
    })`);
    console.log(JSON.stringify({ initial, immediateVisible, hiddenStart, hiddenEnd, hiddenResize, resumed }));
    failed = initial.visible || initial.hasRenderer || initial.hasSnapshot ||
      !immediateVisible.visible || !immediateVisible.hasSnapshot ||
      immediateVisible.antBacking[0] <= 1 || immediateVisible.antBacking[1] <= 1 ||
      !immediateVisible.framePending || visibleTimerActive ||
      initial.mapBacking[0] !== 1 || initial.mapBacking[1] !== 1 ||
      hiddenEnd.elapsed - hiddenStart.elapsed < 0.7 ||
      hiddenEnd.snapshotCalls !== 0 || hiddenStart.hasSnapshot || hiddenEnd.hasSnapshot ||
      !hiddenStart.hiddenTimerActive ||
      hiddenEnd.renderCount !== hiddenStart.renderCount || hiddenEnd.framePending ||
      hiddenStart.mapBacking[0] !== 1 || hiddenStart.mapBacking[1] !== 1 ||
      hiddenStart.antBacking[0] !== 1 || hiddenStart.antBacking[1] !== 1 ||
      hiddenResize.mapBacking.some((size) => size !== 1) ||
      hiddenResize.antBacking.some((size) => size !== 1) ||
      resumed.renderCount <= hiddenEnd.renderCount || resumed.elapsed <= hiddenEnd.elapsed ||
      resumed.mapBacking.some((size, index) => size !== resumed.expectedMapBacking[index]) ||
      resumed.antBacking.some((size, index) => size !== resumed.expectedAntBacking[index]);
    const pheromoneBatch = await window.webContents.executeJavaScript(`(() => {
      const colony = state.colony;
      const previousLayer = state.pheromoneLayer;
      const traces = Array.from({ length: 1201 }, (_, index) => ({
        x: 20 + index % 100 * 6, y: 20 + Math.floor(index / 100) * 10, strength: 0.8
      }));
      state.colony = { snapshot: () => ({ explorationPheromone: traces, pheromone: [] }) };
      state.lastPheromoneCapture = 0;
      refreshPheromones(performance.now());
      const first = { index: state.pheromoneWork?.index, keptPrevious: state.pheromoneLayer === previousLayer };
      state.lastPheromoneCapture = 0;
      refreshPheromones(performance.now());
      const afterInvalidation = state.pheromoneWork?.index;
      for (let pass = 0; pass < 2; pass += 1) refreshPheromones(performance.now());
      const last = traces[traces.length - 1];
      const layer = state.pheromoneLayer;
      const alpha = layer.getContext('2d').getImageData(
        Math.round(last.x * 0.4), Math.round(last.y * 0.4), 1, 1).data[3];
      const completed = state.pheromoneWork === null && layer !== previousLayer;
      refreshPheromones(performance.now());
      const freshBatch = state.pheromoneWork?.index;
      state.colony = colony;
      releasePheromoneLayer();
      return { first, afterInvalidation, completed, freshBatch, alpha };
    })()`);
    console.log(JSON.stringify({ pheromoneBatch }));
    failed ||= pheromoneBatch.first.index !== 400 ||
      !pheromoneBatch.first.keptPrevious || pheromoneBatch.afterInvalidation !== 800 ||
      !pheromoneBatch.completed || pheromoneBatch.freshBatch !== 400 ||
      pheromoneBatch.alpha === 0;
    const fallback = await window.webContents.executeJavaScript(`(() => {
      window.fallbackDraws = 0;
      window.originalDrawAnt = drawAnt;
      drawAnt = (...args) => {
        window.fallbackDraws += 1;
        return window.originalDrawAnt(...args);
      };
      state.antRenderer.render = () => { throw new Error('sketch fixture failure'); };
      frame(performance.now());
      frame(performance.now());
      return {
        rendererUnavailable: state.rendererUnavailable,
        rendererAvailable: Boolean(state.antRenderer),
        canvasHidden: antCanvas.hidden,
        fallbackDraws: window.fallbackDraws,
        size: [antCanvas.width, antCanvas.height]
      };
    })()`);
    console.log(JSON.stringify({ fallback }));
    failed ||= !fallback.rendererUnavailable || fallback.rendererAvailable ||
      !fallback.canvasHidden || fallback.fallbackDraws < 1 ||
      fallback.size.some((size) => size !== 1);
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
