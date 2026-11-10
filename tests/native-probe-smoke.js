const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const executable = process.argv[2];
if (!executable) throw new Error('Pass the compiled desktop probe executable path');

const probe = spawn(executable, ['-Watch', '-ProcessId', String(process.pid)], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
});
const lines = readline.createInterface({ input: probe.stdout });
const received = [];
const timeout = setTimeout(() => {
  probe.kill();
  throw new Error('Desktop probe did not respond in 8 seconds');
}, 8000);

probe.stderr.on('data', (message) => process.stderr.write(message));
probe.on('error', (error) => { throw error; });
lines.on('line', (line) => {
  received.push(line);
  if (received.length !== 2) return;
  try {
    assert.match(received[0], /^focus:(desktop|other)$/);
    const icons = JSON.parse(received[1]);
    assert.ok(Array.isArray(icons));
    for (const icon of icons) {
      assert.equal(typeof icon.name, 'string');
      assert.equal(typeof icon.path, 'string');
      assert.equal(typeof icon.isRecycleBin, 'boolean');
      assert.ok([icon.x, icon.y, icon.w, icon.h].every(Number.isFinite));
      assert.ok(icon.imageRect);
      assert.ok([icon.imageRect.x, icon.imageRect.y, icon.imageRect.w, icon.imageRect.h]
        .every(Number.isFinite));
      assert.deepEqual(icon.imageRect,
        { x: icon.x, y: icon.y, w: icon.w, h: icon.h });
      if (icon.labelRect) {
        assert.ok([icon.labelRect.x, icon.labelRect.y, icon.labelRect.w, icon.labelRect.h]
          .every(Number.isFinite));
        assert.ok(icon.labelRect.y >= icon.imageRect.y + icon.imageRect.h - 2);
      }
    }
    console.log(JSON.stringify({ focus: received[0], iconCount: icons.length,
      recycleBinCount: icons.filter((icon) => icon.isRecycleBin).length }));
  } finally {
    clearTimeout(timeout);
    probe.kill();
  }
});
probe.stdin.write('focus\nicons\n');
