const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.whenReady().then(async () => {
  const samples = process.argv.includes('--native-msaa') ? 0 : 2;
  let failed = false;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    transparent: true,
    webPreferences: { backgroundThrottling: false }
  });
  await window.loadFile(path.join(__dirname, 'render-smoke.html'));
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      window.setSize(width, height);
      const result = await window.webContents.executeJavaScript(`(() => {
        const width = ${width};
        const height = ${height};
        const canvas = document.getElementById('ants');
        const renderer = window.smokeRenderer ||= createAntRenderer(canvas, { msaaSamples: ${samples} });
        const ants = Array.from({ length: 36 }, (_, id) => ({
          id, x: 40 + id % 9 * (width - 80) / 9,
          y: 70 + Math.floor(id / 9) * (height - 140) / 4,
          angle: id * 0.17, carrying: id % 4 === 0,
          payloadKind: id % 8 === 0 ? 'file' : 'food', payloadBytes: 1024
        }));
        const icon = { x: 30, y: 40, w: 40, h: 40 };
        renderer.resize(width, height, 1);
        renderer.render(ants, [icon], 1000, true);
        const gl = canvas.getContext('webgl2');
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const cornerAlpha = pixels[3];
        const first = pixels.slice();
        ants.forEach((ant) => { ant.x += 4; });
        renderer.render(ants, [icon], 1016, true);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        window.smokeAnts = ants;
        window.smokeIcons = [icon];
        window.smokeLoop = (time) => {
          renderer.render(window.smokeAnts, window.smokeIcons, time, true);
          window.smokeFrame = requestAnimationFrame(window.smokeLoop);
        };
        window.smokeFrame = requestAnimationFrame(window.smokeLoop);
        let opaque = 0;
        let changed = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3]) opaque += 1;
          if (pixels[index + 3] !== first[index + 3]) changed += 1;
        }
        return { width, height, cornerAlpha, opaque, changed, ...renderer.stats() };
      })()`);
      let composited = 0;
      for (let attempt = 0; attempt < 5 && !composited; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const screenshot = await window.webContents.capturePage();
        const bitmap = screenshot.getBitmap();
        for (let index = 3; index < bitmap.length; index += 4) {
          if (bitmap[index]) composited += 1;
        }
      }
      await window.webContents.executeJavaScript('cancelAnimationFrame(window.smokeFrame)');
      console.log(JSON.stringify({ ...result, composited }));
      if (result.cornerAlpha !== 0 || !result.opaque || !result.changed ||
        !result.drawCalls || !composited) failed = true;

      const mask = await window.webContents.executeJavaScript(`(() => {
        const height = ${height};
        const renderer = window.smokeRenderer;
        const ants = [
          { id: 0, x: 70, y: 70, angle: 0, carrying: false },
          { id: 1, x: 170, y: 120, angle: 0, carrying: false }
        ];
        const farIcons = Array.from({ length: 83 }, (_, index) => ({
          x: 220 + index % 5 * 10,
          y: 400 + Math.floor(index / 5) * 10,
          w: 5, h: 5
        }));
        renderer.render(ants, farIcons, 1032, true);
        const farClears = renderer.stats().iconClears;
        renderer.render(ants, [...farIcons, { x: 50, y: 50, w: 40, h: 40 }], 1048, true);
        const nearClears = renderer.stats().iconClears;
        const gl = document.getElementById('ants').getContext('webgl2');
        const masked = new Uint8Array(40 * 40 * 4);
        gl.readPixels(50, height - 90, 40, 40, gl.RGBA, gl.UNSIGNED_BYTE, masked);
        const visible = new Uint8Array(40 * 40 * 4);
        gl.readPixels(150, height - 140, 40, 40, gl.RGBA, gl.UNSIGNED_BYTE, visible);
        let maskedOpaque = 0;
        let visibleOpaque = 0;
        for (let index = 3; index < masked.length; index += 4) {
          if (masked[index]) maskedOpaque += 1;
          if (visible[index]) visibleOpaque += 1;
        }
        return { farClears, nearClears, maskedOpaque, visibleOpaque };
      })()`);
      console.log(JSON.stringify({ width, height, ...mask }));
      if (mask.farClears !== 0 || mask.nearClears !== 1 || mask.maskedOpaque !== 0 || !mask.visibleOpaque) {
        failed = true;
      }
    }
    const lifecycle = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('ants');
      const gl = canvas.getContext('webgl2');
      const renderer = window.smokeRenderer;
      renderer.setVisible(false);
      const retained = canvas.width === 390 && canvas.height === 844;
      renderer.resize(450, 880, 1);
      const resizedWhileHidden = canvas.width === 450 && canvas.height === 880;
      renderer.setVisible(true);
      const restored = canvas.width === 450 && canvas.height === 880;
      renderer.render([{ id: 0, x: 70, y: 70, angle: 0, carrying: true,
        payloadKind: 'file', payloadBytes: 1024 }], [], 1064, true);
      const pixels = new Uint8Array(40 * 40 * 4);
      gl.readPixels(50, 880 - 90, 40, 40, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let opaque = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index + 3]) opaque += 1;
      }
      return { retained, resizedWhileHidden, restored, opaque, contextAlive: !gl.isContextLost() };
    })()`);
    console.log(JSON.stringify({ lifecycle }));
    if (!lifecycle.retained || !lifecycle.resizedWhileHidden || !lifecycle.restored ||
      !lifecycle.opaque || !lifecycle.contextAlive) failed = true;
    await window.webContents.executeJavaScript('window.smokeRenderer.dispose()');
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
