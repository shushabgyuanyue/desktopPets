const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const viewports = [
  { label: 'desktop', width: 1440, height: 900, dpr: 1.25 },
  { label: 'mobile', width: 390, height: 844, dpr: 2 }
];

app.setPath('userData', path.join(os.tmpdir(), 'deskAnts-sketch-smoke'));

app.whenReady().then(async () => {
  let failed = false;
  const window = new BrowserWindow({
    width: 1440, height: 900, frame: false, show: false, transparent: false,
    webPreferences: { backgroundThrottling: false }
  });
  try {
    await window.loadFile(path.join(__dirname, 'sketch-render-smoke.html'));
    for (const { label, width, height, dpr } of viewports) {
      window.setSize(width, height);
      const result = await window.webContents.executeJavaScript(`(() => {
        const width = ${width};
        const height = ${height};
        const dpr = ${dpr};
        const canvas = document.getElementById('ants');
        const renderer = window.smokeRenderer ||= createSketchAntRenderer(canvas);
        renderer.resize(width, height, dpr);
        const ants = Array.from({ length: 36 }, (_, id) => ({
          id, x: 52 + id % 9 * (width - 104) / 9,
          y: 85 + Math.floor(id / 9) * (height - 170) / 4,
          angle: id * 0.17, carrying: id % 4 === 0,
          payloadKind: id % 8 === 0 ? 'file' : 'food'
        }));
        ants[0] = { id: 0, x: 180, y: 160, angle: 0,
          carrying: true, payloadKind: 'file' };
        renderer.render(ants, [], 1000, false);
        const context = canvas.getContext('2d');
        const first = context.getImageData(0, 0, canvas.width, canvas.height).data.slice();
        let opaque = 0;
        for (let i = 3; i < first.length; i += 4) opaque += first[i] > 0;
        // The meal must be visibly above the face, supported by the forelegs.
        const bun = context.getImageData(Math.round(184 * dpr), Math.round(144 * dpr),
          Math.round(12 * dpr), Math.round(10 * dpr)).data;
        let bunPixels = 0;
        for (let i = 0; i < bun.length; i += 4) {
          if (bun[i + 3] > 100 && bun[i] > bun[i + 1] * 1.1 &&
            bun[i + 1] > bun[i + 2] * 1.25) bunPixels += 1;
        }
        const atlasBuilds = renderer.stats().atlasBuilds;
        renderer.resize(width, height, dpr);
        const reusedAtlas = renderer.stats().atlasBuilds === atlasBuilds;
        ants.forEach((ant) => { ant.x += 4; });
        renderer.render(ants, [], 1016, true);
        const second = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0;
        for (let i = 3; i < second.length; i += 4) {
          if (second[i] !== first[i]) changed += 1;
        }
        const sample = (x, y, w, h) => {
          const pixels = context.getImageData(Math.round(x * dpr), Math.round(y * dpr),
            Math.round(w * dpr), Math.round(h * dpr)).data;
          let count = 0;
          for (let i = 3; i < pixels.length; i += 4) count += pixels[i] > 0;
          return count;
        };
        const readPatch = (x, y, w, h) => context.getImageData(
          Math.round(x * dpr), Math.round(y * dpr),
          Math.round(w * dpr), Math.round(h * dpr)).data.slice();
        const changedPixels = (before, after) => {
          let count = 0;
          for (let i = 0; i < before.length; i += 4) {
            if (before[i] !== after[i] || before[i + 1] !== after[i + 1] ||
              before[i + 2] !== after[i + 2] || before[i + 3] !== after[i + 3]) count += 1;
          }
          return count;
        };
        const actionAnt = { id: 50, x: 120, y: 120, angle: 0, carrying: false };
        renderer.render([{ ...actionAnt, action: 'sniff', actionProgress: 0.04 }], [], 1020, true);
        const sniffFirst = readPatch(100, 100, 40, 40);
        // Sample the planted abdomen/rear legs, excluding the articulated neck.
        const sniffRear = readPatch(100, 104, 14, 32);
        renderer.render([{ ...actionAnt, action: 'sniff', actionProgress: 0.3 }], [], 1030, true);
        const sniffChanged = changedPixels(sniffFirst, readPatch(100, 100, 40, 40));
        const sniffRearChanged = changedPixels(sniffRear, readPatch(100, 104, 14, 32));
        renderer.render([{ ...actionAnt, action: 'cutting', actionProgress: 0.04 }], [], 1040, true);
        const cutFirst = readPatch(100, 100, 40, 40);
        const cutRear = readPatch(100, 104, 14, 32);
        renderer.render([{ ...actionAnt, action: 'cutting', actionProgress: 0.3 }], [], 1050, true);
        const cuttingChanged = changedPixels(cutFirst, readPatch(100, 100, 40, 40));
        const cuttingRearChanged = changedPixels(cutRear, readPatch(100, 104, 14, 32));
        const cutPixels = readPatch(132, 114, 8, 12);
        let cuttingCrumbs = 0;
        for (let i = 0; i < cutPixels.length; i += 4) {
          if (cutPixels[i + 3] > 100 && cutPixels[i] > cutPixels[i + 1] * 1.1 &&
            cutPixels[i + 1] > cutPixels[i + 2] * 1.2) cuttingCrumbs += 1;
        }
        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = 64;
        iconCanvas.height = 64;
        const iconContext = iconCanvas.getContext('2d');
        drawMantouIcon(iconContext, { x: 6, y: 6, w: 51, h: 51 }, 1000);
        const iconPixels = iconContext.getImageData(6, 6, 51, 51).data;
        let mantouMinAlpha = 255;
        let mantouWarmPixels = 0;
        for (let i = 0; i < iconPixels.length; i += 4) {
          mantouMinAlpha = Math.min(mantouMinAlpha, iconPixels[i + 3]);
          if (iconPixels[i] > iconPixels[i + 1] * 1.22 &&
            iconPixels[i + 1] > iconPixels[i + 2] * 1.2) mantouWarmPixels += 1;
        }
        const mantouLabelClear = iconContext.getImageData(30, 60, 1, 1).data[3] === 0;
        const wallpaperPatch = document.createElement('canvas');
        wallpaperPatch.width = wallpaperPatch.height = 51;
        const wallpaperContext = wallpaperPatch.getContext('2d');
        wallpaperContext.fillStyle = '#123456';
        wallpaperContext.fillRect(0, 0, 51, 51);
        const replacementIcon = document.createElement('canvas');
        replacementIcon.width = replacementIcon.height = 64;
        const replacementContext = replacementIcon.getContext('2d');
        drawMantouIcon(replacementContext, { x: 6, y: 6, w: 51, h: 51 }, 1000, wallpaperPatch);
        const wallpaperCorner = replacementContext.getImageData(7, 7, 1, 1).data;
        const wallpaperBackdropMatches = wallpaperCorner[0] === 18 &&
          wallpaperCorner[1] === 52 && wallpaperCorner[2] === 86 && wallpaperCorner[3] === 255;
        const portionsCanvas = document.createElement('canvas');
        portionsCanvas.width = 280;
        portionsCanvas.height = 64;
        const portionsContext = portionsCanvas.getContext('2d');
        const portionPixels = [];
        for (const [index, portion] of [1, 0.75, 0.5, 0.25].entries()) {
          const x = 6 + index * 68;
          drawMantouIcon(portionsContext, { x, y: 6, w: 51, h: 51 }, 1000, wallpaperPatch, portion);
          const pixels = portionsContext.getImageData(x, 6, 51, 51).data;
          let warm = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset] > pixels[offset + 1] * 1.22 &&
              pixels[offset + 1] > pixels[offset + 2] * 1.2) warm += 1;
          }
          portionPixels.push(warm);
        }
        window.mantouPortionsPreview = portionsCanvas.toDataURL('image/png');
        const compactIcon = document.createElement('canvas');
        compactIcon.width = 40;
        compactIcon.height = 40;
        const compactContext = compactIcon.getContext('2d');
        drawMantouIcon(compactContext, { x: 4, y: 4, w: 32, h: 32 }, 1000);
        const compactPixels = compactContext.getImageData(4, 4, 32, 32).data;
        let compactMinAlpha = 255;
        let compactWarmPixels = 0;
        for (let i = 0; i < compactPixels.length; i += 4) {
          compactMinAlpha = Math.min(compactMinAlpha, compactPixels[i + 3]);
          if (compactPixels[i] > compactPixels[i + 1] * 1.22 &&
            compactPixels[i + 1] > compactPixels[i + 2] * 1.2) compactWarmPixels += 1;
        }
        window.mantouPreview = iconCanvas.toDataURL('image/png');
        renderer.render([
          { id: 40, x: 70, y: 70, angle: 0, carrying: true,
            payloadKind: 'file' },
          { id: 41, x: 170, y: 120, angle: 0, carrying: false }
        ], [{ x: 50, y: 50, w: 40, h: 40 }], 1032, true);
        const masked = sample(50, 50, 40, 40);
        const visible = sample(150, 100, 40, 40);
        const clears = renderer.stats().iconClears;
        renderer.render([{ id: 42, x: 70, y: 70, angle: 0,
          mode: 'deposit', entryProgress: 0.75, carrying: true,
          payloadKind: 'file' }], [], 1048, true,
          { mouth: { x: 110, y: 90 } });
        const entered = sample(96, 77, 18, 20);
        renderer.setVisible(false);
        const hiddenShrunk = canvas.width === 1 && canvas.height === 1;
        renderer.render([], [], 1064, true);
        renderer.resize(width + 10, height + 10, dpr);
        const resizedWhileHidden = canvas.width === 1 && canvas.height === 1;
        renderer.setVisible(true);
        const restoredSize = canvas.width === Math.round((width + 10) * dpr) &&
          canvas.height === Math.round((height + 10) * dpr);
        renderer.resize(width, height, dpr);
        renderer.render([{ id: 43, x: 130, y: 115, angle: 0,
          carrying: true, payloadKind: 'file' }], [], 1080, true);
        const restored = sample(111, 96, 38, 38) > 0;
        window.smokeAnts = ants;
        renderer.render(ants, [], 1096, true);
        return { label: '${label}', width, height, dpr, opaque, changed, bunPixels,
          sniffChanged, sniffRearChanged, cuttingChanged, cuttingRearChanged, cuttingCrumbs,
          mantouMinAlpha, mantouWarmPixels, mantouLabelClear,
          wallpaperBackdropMatches, portionPixels,
          compactMinAlpha, compactWarmPixels,
          masked, visible, clears, entered, hiddenShrunk, resizedWhileHidden,
          restoredSize, restored,
          reusedAtlas, ...renderer.stats() };
      })()`);
      console.log(JSON.stringify(result));
      failed ||= result.opaque < 1000 || result.changed < 100 ||
        result.bunPixels < 5 || result.sniffChanged < 10 || result.sniffRearChanged > 6 ||
        // Fractional DPR resampling may alter a few edge pixels between atlas cells.
        result.cuttingChanged < 10 || result.cuttingRearChanged > 12 ||
        result.cuttingCrumbs < 2 || result.mantouMinAlpha !== 255 ||
        result.mantouWarmPixels < 100 || !result.mantouLabelClear ||
        !result.wallpaperBackdropMatches ||
        !result.portionPixels.every((count, index, values) => index === 0 || count < values[index - 1]) ||
        result.compactMinAlpha !== 255 || result.compactWarmPixels < 40 ||
        result.masked !== 0 || result.visible < 40 ||
        result.clears !== 1 || result.entered < 20 || !result.hiddenShrunk ||
        !result.resizedWhileHidden || !result.restoredSize ||
        !result.restored || !result.reusedAtlas;
      if (label === 'desktop') {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const iconDataUrl = await window.webContents.executeJavaScript('window.mantouPreview');
        const iconPath = path.join(os.tmpdir(), 'deskAnts-mantou-icon.png');
        await fs.writeFile(iconPath, Buffer.from(iconDataUrl.split(',')[1], 'base64'));
        console.log(JSON.stringify({ iconPath }));
        const portionsDataUrl = await window.webContents.executeJavaScript('window.mantouPortionsPreview');
        const portionsPath = path.join(os.tmpdir(), 'deskAnts-mantou-portions.png');
        await fs.writeFile(portionsPath, Buffer.from(portionsDataUrl.split(',')[1], 'base64'));
        console.log(JSON.stringify({ portionsPath }));
        for (const theme of ['light', 'dark']) {
          await window.webContents.executeJavaScript(`new Promise((resolve) => {
            document.body.style.background = '${theme === 'light' ? '#f3f5f1' : '#23292a'}';
            window.smokeRenderer.render(window.smokeAnts, [], 1096, true);
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          })`);
          const screenshot = await window.webContents.capturePage();
          const output = path.join(os.tmpdir(), `deskAnts-sketch-${theme}.png`);
          await fs.writeFile(output, screenshot.toPNG());
          const crop = screenshot.crop({ x: 100, y: 100, width: 450, height: 300 });
          const cropPath = path.join(os.tmpdir(), `deskAnts-sketch-${theme}-crop.png`);
          await fs.writeFile(cropPath, nativeImage.createFromBuffer(crop.toPNG()).toPNG());
          console.log(JSON.stringify({ theme, output, cropPath }));
          await window.webContents.executeJavaScript(`
            window.smokeRenderer.render([
              { id: 80, x: 170, y: 150, angle: 0, action: 'sniff', actionProgress: 0.3 },
              { id: 81, x: 240, y: 150, angle: 0, action: 'cutting', actionProgress: 0.3 }
            ], [], 1112, true);
          `);
          const actionImage = await window.webContents.capturePage();
          const actionPath = path.join(os.tmpdir(), `deskAnts-sketch-actions-${theme}.png`);
          await fs.writeFile(actionPath, actionImage.crop({
            x: Math.round(130 * dpr), y: Math.round(112 * dpr),
            width: Math.round(150 * dpr), height: Math.round(76 * dpr)
          }).resize({ width: 640, height: 324 }).toPNG());
          console.log(JSON.stringify({ theme, actionPath }));
        }
      }
    }
    await window.webContents.executeJavaScript('window.smokeRenderer.dispose()');
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.close();
    app.exit(failed ? 1 : 0);
  }
});
