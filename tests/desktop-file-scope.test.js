const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path').win32;
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const project = 'D:\\myProject\\deskAnts';
const userDesktop = 'C:\\Users\\Alice\\OneDrive\\Desktop';
const publicDesktop = 'C:\\Users\\Public\\Desktop';
const fileStat = {
  dev: 1n, ino: 2n, size: 2048n, mtimeNs: 3n, ctimeNs: 4n, birthtimeNs: 5n,
  isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false
};
const directoryStat = {
  isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false
};

function mainHarness(selectedPath, options = {}) {
  const dialogOptions = [];
  const confirmationOptions = [];
  const confirmations = [...(options.confirmations || [])];
  let desktop = userDesktop;
  let trashCalls = 0;
  let nextJobId = 0;
  const trashedPaths = [];
  const mutatedPaths = new Set();
  const fsMock = {
    realpath: async (value) => {
      if (options.missingPublic && value.toLowerCase() === publicDesktop.toLowerCase()) {
        throw new Error('missing Public Desktop');
      }
      return options.realpaths?.[value] || value;
    },
    lstat: async (value) => {
      if ([desktop, userDesktop, publicDesktop].some((root) => root.toLowerCase() === value.toLowerCase())) {
        return directoryStat;
      }
      if ((options.symlink && value === selectedPath) || options.symlinkPaths?.includes(value)) {
        return { ...fileStat, isSymbolicLink: () => true };
      }
      return { ...fileStat,
        size: options.fileSizes?.[value] == null
          ? options.size == null ? fileStat.size : BigInt(options.size)
          : BigInt(options.fileSizes[value]),
        mtimeNs: mutatedPaths.has(value) ? 99n : fileStat.mtimeNs };
    }
  };
  const electron = {
    app: {
      getPath: () => desktop,
      requestSingleInstanceLock: () => false,
      quit: () => {},
      on: () => {}
    },
    dialog: {
      showOpenDialog: async (args) => {
        dialogOptions.push(args);
        return { canceled: false, filePaths: options.selectedPaths || [selectedPath] };
      },
      showMessageBox: async (args) => {
        confirmationOptions.push(args);
        return { response: confirmations.length ? confirmations.shift() : 1 };
      }
    },
    shell: { trashItem: async (value) => { trashCalls += 1; trashedPaths.push(value); } }
  };
  const execFile = (_file, _args, _options, callback) => callback(null, { stdout: 'Fixed' });
  const context = vm.createContext({
    __dirname: project,
    console,
    process: {
      env: { USERPROFILE: 'C:\\Users\\Alice', PUBLIC: 'C:\\Users\\Public' },
      pid: 100
    },
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === 'node:path') return path;
      if (name === 'node:fs/promises') return fsMock;
      if (name === 'node:crypto') return { randomUUID: () => nextJobId++ ? `job-id-${nextJobId}` : 'job-id' };
      if (name === 'node:child_process') return { execFile, spawn: () => {} };
      return require(name);
    }
  });
  vm.runInContext(mainSource, context, { filename: 'main.js' });
  return {
    select: () => vm.runInContext('selectFileFood()', context),
    selectMany: () => vm.runInContext('selectFileFoods()', context),
    add: (paths) => { context.inputPaths = paths; return vm.runInContext('addFileFoodPaths(inputPaths)', context); },
    finish: (size) => vm.runInContext(`finishFileFood('job-id', ${size})`, context),
    finishId: (id, size) => { context.inputId = id; context.inputSize = size;
      return vm.runInContext('finishFileFood(inputId, inputSize)', context); },
    cancel: (id) => { context.inputId = id; return vm.runInContext('cancelFileFood(inputId)', context); },
    setDesktop: (value) => { desktop = value; },
    mutate: (value) => { mutatedPaths.add(value); },
    jobCount: () => vm.runInContext('activeFileFoodJobs.size', context),
    getTrashCalls: () => trashCalls,
    trashedPaths,
    dialogOptions,
    confirmationOptions
  };
}

test('accepts direct files on redirected user Desktop and Public Desktop', async () => {
  for (const file of [path.join(userDesktop, 'note.txt'), path.join(publicDesktop, 'shared.txt')]) {
    const harness = mainHarness(file);
    const result = await harness.select();
    assert.equal(result.id, 'job-id');
    assert.equal(result.path, file);
    assert.equal(harness.dialogOptions[0].defaultPath, userDesktop);
  }
});

test('missing Public Desktop does not block a user Desktop file', async () => {
  const result = await mainHarness(path.join(userDesktop, 'note.txt'), { missingPublic: true }).select();
  assert.equal(result.id, 'job-id');
});

test('rejects external files, nested files, and links without starting a job', async () => {
  const cases = [
    [path.join('C:\\', 'Users', 'Alice', 'Downloads', 'other.txt'), {}],
    [path.join(userDesktop, 'folder', 'nested.txt'), {}],
    [path.join(userDesktop, 'link.txt'), { symlink: true }],
    [path.join(userDesktop, 'junction', 'outside.txt'), {
      realpaths: { [path.join(userDesktop, 'junction', 'outside.txt')]: 'C:\\Users\\Alice\\Downloads\\outside.txt' }
    }]
  ];
  for (const [file, options] of cases) {
    const result = await mainHarness(file, options).select();
    assert.equal(result.ok, false, file);
  }
});

test('accepts a two-byte desktop file and rejects empty or one-byte files', async () => {
  const file = path.join(userDesktop, 'tiny.txt');
  assert.equal((await mainHarness(file, { size: 2 }).select()).size, 2);
  for (const size of [0, 1]) {
    const result = await mainHarness(file, { size }).select();
    assert.equal(result.ok, false);
  }
});

test('does not recycle a file after the Desktop location changes', async () => {
  const file = path.join(userDesktop, 'note.txt');
  const harness = mainHarness(file);
  assert.equal((await harness.select()).id, 'job-id');
  harness.setDesktop('C:\\Users\\Alice\\NewDesktop');
  const result = await harness.finish(2048);
  assert.equal(result.ok, false);
  assert.equal(harness.getTrashCalls(), 0);
});

test('multi-select creates separate jobs and retains per-file final confirmation', async () => {
  const first = path.join(userDesktop, 'first.txt');
  const second = path.join(publicDesktop, 'second.txt');
  const harness = mainHarness(first, { selectedPaths: [first, second], confirmations: [1, 0, 1] });
  const result = await harness.selectMany();
  assert.equal(result.ok, true);
  assert.equal(result.jobs.length, 2);
  assert.equal(harness.dialogOptions[0].properties.includes('multiSelections'), true);
  assert.equal(harness.confirmationOptions[0].detail.includes('默认保留原文件'), true);
  assert.equal(harness.jobCount(), 2);
  assert.equal((await harness.finishId(result.jobs[0].id, 2048)).ok, false);
  assert.equal(harness.getTrashCalls(), 0);
  assert.equal((await harness.finishId(result.jobs[1].id, 2048)).ok, true);
  assert.deepEqual(harness.trashedPaths, [second]);
});

test('a mixed drag batch is rejected atomically and duplicate files are skipped', async () => {
  const first = path.join(userDesktop, 'first.txt');
  const second = path.join(userDesktop, 'second.txt');
  const outside = path.join('C:\\', 'Users', 'Alice', 'Downloads', 'outside.txt');
  const harness = mainHarness(first);
  assert.equal((await harness.add([first, outside])).ok, false);
  assert.equal(harness.jobCount(), 0);
  const added = await harness.add([first, second, first]);
  assert.equal(added.jobs.length, 2);
  assert.equal(added.skipped, 1);
  const repeated = await harness.add([first]);
  assert.deepEqual(Array.from(repeated.jobs), []);
  assert.equal(repeated.skipped, 1);
  assert.equal(harness.jobCount(), 2);
});

test('batch and active task limits are enforced without touching files', async () => {
  const files = Array.from({ length: 24 }, (_, index) => path.join(userDesktop, `file-${index}.txt`));
  const harness = mainHarness(files[0]);
  assert.equal((await harness.add([...files, path.join(userDesktop, 'overflow.txt')])).ok, false);
  assert.equal(harness.jobCount(), 0);
  assert.equal((await harness.add(files)).jobs.length, 24);
  assert.equal((await harness.add([path.join(userDesktop, 'extra.txt')])).ok, false);
  assert.equal(harness.jobCount(), 24);
});

test('changing one queued file blocks only its own recycle operation', async () => {
  const first = path.join(userDesktop, 'first.txt');
  const second = path.join(userDesktop, 'second.txt');
  const harness = mainHarness(first);
  const added = await harness.add([first, second]);
  harness.mutate(first);
  assert.equal((await harness.finishId(added.jobs[0].id, 2048)).ok, false);
  assert.equal((await harness.finishId(added.jobs[1].id, 2048)).ok, true);
  assert.deepEqual(harness.trashedPaths, [second]);
});

test('cancelling one file leaves other file tasks intact', async () => {
  const files = [path.join(userDesktop, 'first.txt'), path.join(userDesktop, 'second.txt')];
  const harness = mainHarness(files[0]);
  const added = await harness.add(files);
  assert.equal(harness.cancel(added.jobs[0].id).ok, true);
  assert.equal(harness.jobCount(), 1);
  assert.equal((await harness.finishId(added.jobs[1].id, 2048)).ok, true);
  assert.deepEqual(harness.trashedPaths, [files[1]]);
});
