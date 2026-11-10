const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('cursor polling follows visible desktop content bounds and stops while hidden', () => {
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  let cursor = { x: 500, y: 360 };
  let bounds = { x: 100, y: 80, width: 800, height: 600 };
  let visible = false;
  let minimized = false;
  let focusable = true;
  let invalidations = 0;
  const window = {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    isFocusable: () => focusable,
    setFocusable: (value) => { focusable = value; },
    restore: () => {
      assert.equal(focusable, false, 'restoring the desktop pet must not steal focus');
      minimized = false;
    },
    showInactive: () => { visible = true; },
    hide: () => { visible = false; },
    getContentBounds: () => bounds,
    webContents: { send: (name, payload) => messages.push({ name, payload }),
      invalidate: () => { invalidations++; } }
  };
  const app = {
    requestSingleInstanceLock: () => false,
    quit: () => {},
    on: () => {}
  };
  const context = vm.createContext({
    __dirname: path.join(__dirname, '..'),
    console,
    process,
    setTimeout: () => { throw new Error('App switches must not schedule a delayed hide'); },
    clearTimeout: () => {},
    setInterval: (callback, interval) => {
      const id = ++timerId;
      timers.set(id, { callback, interval });
      return id;
    },
    clearInterval: (id) => { timers.delete(id); },
    require: (name) => name === 'electron'
      ? { app, screen: { getCursorScreenPoint: () => cursor } }
      : require(name)
  });
  vm.runInContext(source, context, { filename: 'main.js' });
  context.testWindow = window;
  vm.runInContext('mainWindow = testWindow; windowLoaded = true; desktopFocused = true; updateVisibility()', context);
  assert.equal(visible, true);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].interval, 60);
  assert.deepEqual(messages.map(({ name }) => name), ['desktop:visibility', 'desktop:cursor']);
  assert.deepEqual({ ...messages[1].payload }, { x: 400, y: 280 });

  cursor = { x: 530, y: 390 };
  bounds = { x: 120, y: 100, width: 800, height: 600 };
  [...timers.values()][0].callback();
  assert.deepEqual({ ...messages.at(-1).payload }, { x: 410, y: 290 });
  vm.runInContext('updateVisibility()', context);
  assert.equal(timers.size, 1, 'repeated focus updates do not create extra polls');

  vm.runInContext('desktopFocused = false; updateVisibility()', context);
  assert.equal(visible, false);
  assert.equal(timers.size, 0);
  assert.equal(messages.at(-1).name, 'desktop:visibility');
  assert.equal(messages.at(-1).payload, false);
  vm.runInContext('desktopFocused = true; updateVisibility()', context);
  assert.equal(visible, true, 'desktop return shows immediately without a click');
  assert.equal(timers.size, 1);
  assert.equal(messages.at(-2).payload, true);
  const beforeRestore = invalidations;
  minimized = true; // Windows can report a minimized window as visible.
  vm.runInContext('updateVisibility()', context);
  assert.equal(minimized, false);
  assert.equal(focusable, true);
  assert.equal(invalidations, beforeRestore + 1);
  assert.equal(messages.at(-1).name, 'desktop:visibility');
  assert.equal(messages.at(-1).payload, true, 'force a fresh frame after a shell minimize');
  vm.runInContext('updateVisibility()', context);
  assert.equal(invalidations, beforeRestore + 1, 'stable desktop heartbeats do not force paints');
});
