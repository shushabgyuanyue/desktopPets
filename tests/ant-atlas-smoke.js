const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const viewports = [
  { width: 1440, height: 900, dpr: 1.25, label: 'desktop' },
  { width: 390, height: 844, dpr: 2, label: 'mobile' }
];

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, transparent: true,
    webPreferences: { backgroundThrottling: false }
  });
  let failed = false;
  try {
    await window.loadFile(path.join(__dirname, 'render-smoke.html'));
    for (const { width, height, dpr, label } of viewports) {
      window.setSize(width, height);
      const result = await window.webContents.executeJavaScript(`(() => {
        const width = ${width};
        const height = ${height};
        const dpr = ${dpr};
        const canvas = document.getElementById('ants');
        const renderer = createGroupedAntAtlasRenderer(canvas);
        renderer.resize(width, height, dpr);
        const ants = Array.from({ length: 36 }, (_, id) => ({
          id,
          x: 40 + id % 9 * (width - 80) / 9,
          y: 70 + Math.floor(id / 9) * (height - 140) / 4,
          angle: id * 0.17,
          carrying: id % 4 === 0,
          payloadKind: id % 8 === 0 ? 'file' : 'food',
          payloadBytes: 1024
        }));
        renderer.render(ants, [], 1000, false);
        const context = canvas.getContext('2d');
        const first = context.getImageData(0, 0, canvas.width, canvas.height).data.slice();
        let opaque = 0;
        for (let index = 3; index < first.length; index += 4) {
          if (first[index]) opaque += 1;
        }
        ants.forEach((ant) => { ant.x += 4; });
        renderer.render(ants, [], 1016, true);
        const second = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0;
        for (let index = 3; index < second.length; index += 4) {
          if (second[index] !== first[index]) changed += 1;
        }

        const maskAnts = [
          { id: 0, x: 70, y: 70, angle: 0, carrying: true,
            payloadKind: 'file', payloadBytes: 4096 },
          { id: 1, x: 170, y: 120, angle: 0, carrying: false }
        ];
        const icon = { x: 50, y: 50, w: 40, h: 40 };
        renderer.render(maskAnts, [icon], 1032, false);
        const masked = context.getImageData(50 * dpr, 50 * dpr, 40 * dpr, 40 * dpr).data;
        const visible = context.getImageData(150 * dpr, 100 * dpr, 40 * dpr, 40 * dpr).data;
        let maskedOpaque = 0;
        let visibleOpaque = 0;
        for (let index = 3; index < masked.length; index += 4) {
          if (masked[index]) maskedOpaque += 1;
          if (visible[index]) visibleOpaque += 1;
        }
        let restored = true;
        let hiddenShrunk = true;
        for (let cycle = 0; cycle < 3; cycle += 1) {
          renderer.setVisible(false);
          hiddenShrunk &&= canvas.width === 1 && canvas.height === 1;
          maskAnts[1].x += 3;
          renderer.render(maskAnts, [icon], 1048 + cycle * 32, true);
          renderer.setVisible(true);
          renderer.render(maskAnts, [icon], 1064 + cycle * 32, true);
          const pixel = context.getImageData(Math.round(maskAnts[1].x * dpr),
            Math.round(maskAnts[1].y * dpr), 1, 1).data;
          restored &&= pixel[3] > 0 && canvas.width === width * dpr &&
            canvas.height === height * dpr;
        }
        const result = {
          width, height, dpr, cornerAlpha: first[3], opaque, changed,
          maskedOpaque, visibleOpaque, restored, hiddenShrunk,
          outputSize: [canvas.width, canvas.height], ...renderer.stats()
        };
        renderer.dispose();
        return result;
      })()`);
      console.log(JSON.stringify({ label, ...result }));
      failed ||= result.cornerAlpha !== 0 || result.opaque < 100 || result.changed < 100 ||
        result.maskedOpaque !== 0 || result.visibleOpaque < 10 ||
        !result.restored || !result.hiddenShrunk ||
        result.outputSize[0] !== width * dpr || result.outputSize[1] !== height * dpr;

      const comparison = await window.webContents.executeJavaScript(`(() => {
        const width = ${width};
        const height = ${height};
        const dpr = ${dpr};
        const crowd = Array.from({ length: 36 }, (_, id) => ({
          id,
          x: width / 2 - 40 + id % 9 * 9 + (Math.floor(id / 9) % 2) * 4,
          y: height / 3 + Math.floor(id / 9) * 11,
          angle: id * 0.17,
          carrying: id % 4 === 0,
          payloadKind: id % 8 === 0 ? 'file' : 'food', payloadBytes: 1024
        }));
        const output = document.createElement('canvas');
        const reference = document.createElement('canvas');
        output.style.display = 'none';
        reference.style.display = 'none';
        document.body.append(output, reference);
        const atlas = createGroupedAntAtlasRenderer(output);
        const direct = createAntRenderer(reference);
        atlas.resize(width, height, dpr);
        direct.resize(width, height, dpr);
        atlas.render(crowd, [], 1000, false);
        direct.render(crowd, [], 1000, false);
        const pixels = output.getContext('2d').getImageData(0, 0,
          output.width, output.height).data;
        const gl = reference.getContext('webgl2');
        const original = new Uint8Array(reference.width * reference.height * 4);
        gl.readPixels(0, 0, reference.width, reference.height,
          gl.RGBA, gl.UNSIGNED_BYTE, original);
        let atlasOpaque = 0;
        let directOpaque = 0;
        let alphaChanged = 0;
        let largeAlphaDelta = 0;
        let colorDelta = 0;
        for (let y = 0; y < output.height; y += 1) {
          for (let x = 0; x < output.width; x += 1) {
            const a = (y * output.width + x) * 4;
            const b = ((reference.height - 1 - y) * reference.width + x) * 4;
            if (pixels[a + 3]) atlasOpaque += 1;
            if (original[b + 3]) directOpaque += 1;
            const alphaDelta = Math.abs(pixels[a + 3] - original[b + 3]);
            if (alphaDelta) alphaChanged += 1;
            if (alphaDelta > 8) largeAlphaDelta += 1;
            if (pixels[a + 3] || original[b + 3]) {
              colorDelta += Math.abs(pixels[a] - original[b]) +
                Math.abs(pixels[a + 1] - original[b + 1]) +
                Math.abs(pixels[a + 2] - original[b + 2]);
            }
          }
        }
        const png = output.toDataURL('image/png');
        atlas.dispose();
        direct.dispose();
        output.remove();
        reference.remove();
        return { atlasOpaque, directOpaque, alphaChanged, largeAlphaDelta,
          meanColorDelta: colorDelta / Math.max(1, atlasOpaque * 3), png };
      })()`);
      const output = path.join(process.env.TEMP || __dirname,
        `deskAnts-atlas-${label}-crowd.png`);
      const image = nativeImage.createFromDataURL(comparison.png);
      await fs.writeFile(output, image.toPNG());
      delete comparison.png;
      console.log(JSON.stringify({ label, comparison, output }));
      failed ||= Math.abs(comparison.atlasOpaque - comparison.directOpaque) >
        comparison.directOpaque * 0.02 ||
        comparison.largeAlphaDelta > comparison.directOpaque * 0.02 ||
        comparison.meanColorDelta > 20;
    }
    const edgeCases = await window.webContents.executeJavaScript(`(() => {
      const output = document.createElement('canvas');
      output.style.display = 'none';
      document.body.append(output);
      const renderer = createGroupedAntAtlasRenderer(output, { atlasSize: 128 });
      renderer.resize(1000, 500, 1);
      const context = output.getContext('2d');
      const separated = Array.from({ length: 36 }, (_, id) => ({
        id, x: 60 + id % 9 * 100, y: 70 + Math.floor(id / 9) * 100,
        angle: id * 0.1, carrying: false
      }));
      let start = performance.now();
      renderer.render(separated, [], 1000, false);
      const multiPageMs = performance.now() - start;
      const multiPage = { ...renderer.stats() };
      const multiPagePixels = context.getImageData(0, 0, 1000, 500).data;
      let multiPageOpaque = 0;
      for (let index = 3; index < multiPagePixels.length; index += 4) {
        if (multiPagePixels[index]) multiPageOpaque += 1;
      }

      const connected = Array.from({ length: 36 }, (_, id) => ({
        id, x: 40 + id * 30, y: 250, angle: 0,
        carrying: id % 4 === 0, payloadKind: 'file', payloadBytes: 4096
      }));
      renderer.dispose();
      const tiledRenderer = createGroupedAntAtlasRenderer(output, { atlasSize: 128 });
      tiledRenderer.resize(1000, 500, 1);
      start = performance.now();
      tiledRenderer.render(connected, [], 1016, false);
      const tiledMs = performance.now() - start;
      const tiled = { ...tiledRenderer.stats() };
      const tiledPixels = context.getImageData(0, 0, 1000, 500).data;
      let tiledOpaque = 0;
      for (let index = 3; index < tiledPixels.length; index += 4) {
        if (tiledPixels[index]) tiledOpaque += 1;
      }
      const reference = document.createElement('canvas');
      const direct = createAntRenderer(reference);
      direct.resize(1000, 500, 1);
      direct.render(connected, [], 1016, false);
      const gl = reference.getContext('webgl2');
      const directPixels = new Uint8Array(1000 * 500 * 4);
      gl.readPixels(0, 0, 1000, 500, gl.RGBA, gl.UNSIGNED_BYTE, directPixels);
      let directOpaque = 0;
      let largeAlphaDelta = 0;
      const directTopDown = new Uint8ClampedArray(directPixels.length);
      for (let y = 0; y < 500; y += 1) {
        for (let x = 0; x < 1000; x += 1) {
          const a = (y * 1000 + x) * 4 + 3;
          const b = ((499 - y) * 1000 + x) * 4 + 3;
          if (directPixels[b]) directOpaque += 1;
          if (Math.abs(tiledPixels[a] - directPixels[b]) > 8) largeAlphaDelta += 1;
          directTopDown.set(directPixels.subarray(b - 3, b + 1), a - 3);
        }
      }
      const tiledCrop = document.createElement('canvas');
      tiledCrop.width = 1000;
      tiledCrop.height = 100;
      tiledCrop.getContext('2d').drawImage(output, 0, 200, 1000, 100,
        0, 0, 1000, 100);
      const directImage = document.createElement('canvas');
      directImage.width = 1000;
      directImage.height = 500;
      directImage.getContext('2d').putImageData(
        new ImageData(directTopDown, 1000, 500), 0, 0);
      const directCrop = document.createElement('canvas');
      directCrop.width = 1000;
      directCrop.height = 100;
      directCrop.getContext('2d').drawImage(directImage, 0, 200, 1000, 100,
        0, 0, 1000, 100);
      const tiledCropPng = tiledCrop.toDataURL('image/png');
      const directCropPng = directCrop.toDataURL('image/png');
      direct.dispose();
      tiledRenderer.dispose();
      const defaultRenderer = createGroupedAntAtlasRenderer(output);
      defaultRenderer.resize(1000, 500, 1);
      start = performance.now();
      defaultRenderer.render(connected, [], 1016, false);
      const defaultTiledMs = performance.now() - start;
      const defaultTiled = { ...defaultRenderer.stats() };
      defaultRenderer.dispose();
      output.remove();
      return { multiPage, multiPageOpaque, multiPageMs,
        tiled, tiledOpaque, tiledMs, directOpaque, largeAlphaDelta,
        defaultTiled, defaultTiledMs, tiledCropPng, directCropPng };
    })()`);
    const tiledCrop = path.join(process.env.TEMP || __dirname,
      'deskAnts-atlas-tiled-chain.png');
    const directCrop = path.join(process.env.TEMP || __dirname,
      'deskAnts-atlas-direct-chain.png');
    await fs.writeFile(tiledCrop, nativeImage.createFromDataURL(edgeCases.tiledCropPng).toPNG());
    await fs.writeFile(directCrop, nativeImage.createFromDataURL(edgeCases.directCropPng).toPNG());
    delete edgeCases.tiledCropPng;
    delete edgeCases.directCropPng;
    edgeCases.tiledCrop = tiledCrop;
    edgeCases.directCrop = directCrop;
    console.log(JSON.stringify({ edgeCases }));
    failed ||= edgeCases.multiPage.fallback || edgeCases.multiPage.atlasPages < 2 ||
      edgeCases.multiPageOpaque < 1000 || edgeCases.tiled.fallback ||
      edgeCases.tiled.atlasTiles < 2 || edgeCases.tiledOpaque < 1000 ||
      Math.abs(edgeCases.tiledOpaque - edgeCases.directOpaque) > edgeCases.directOpaque * 0.02 ||
      edgeCases.largeAlphaDelta > edgeCases.directOpaque * 0.02 ||
      edgeCases.defaultTiled.fallback || edgeCases.defaultTiled.atlasTiles < 2;
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
