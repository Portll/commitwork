// Sorted list of checks-status.json files under a reports root (monitor/lane-timing.mjs statusFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusFiles } from '../lane-timing.mjs';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

function withRoot(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'statusFiles-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function touch(...parts) {
  const file = join(...parts);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{}');
  return file;
}

test('returns an empty array when the reports root does not exist', () => {
  withRoot((dir) => {
    assert.deepEqual(statusFiles(join(dir, 'missing')), []);
  });
});

test('rethrows ENOTDIR when the reports root is a file', () => {
  withRoot((dir) => {
    const file = touch(dir, 'notadir');
    assert.throws(() => statusFiles(file), {
      name: 'Error',
      code: 'ENOTDIR',
      message: `ENOTDIR: not a directory, scandir '${file}'`,
    });
  });
});

test('returns an empty array when no batch directory holds a status file', () => {
  withRoot((dir) => {
    assert.deepEqual(statusFiles(dir), []);
    touch(dir, 'stray.txt');
    touch(dir, 'checks-status.json');
    touch(dir, 'batch1', 'note.txt');
    mkdirSync(join(dir, 'batch1', 'repo1'));
    touch(dir, 'batch1', 'repo2', 'other.json');
    mkdirSync(join(dir, 'batch2'));
    assert.deepEqual(statusFiles(dir), []);
  });
});

test('reports a status file directly inside a batch with a null repo', () => {
  withRoot((dir) => {
    const file = touch(dir, 'batch1', 'checks-status.json');
    assert.deepEqual(statusFiles(dir), [{ file, batch: 'batch1', repo: null }]);
  });
});

test('reports a status file inside a repo directory with the repo name', () => {
  withRoot((dir) => {
    const file = touch(dir, 'batch1', 'repo1', 'checks-status.json');
    assert.deepEqual(statusFiles(dir), [{ file, batch: 'batch1', repo: 'repo1' }]);
  });
});

test('reports shallow and nested status files from one batch and skips loose files', () => {
  withRoot((dir) => {
    const nested = touch(dir, 'batch1', 'alpha', 'checks-status.json');
    const shallow = touch(dir, 'batch1', 'checks-status.json');
    touch(dir, 'batch1', 'note.txt');
    mkdirSync(join(dir, 'batch1', 'empty'));
    assert.deepEqual(statusFiles(dir), [
      { file: nested, batch: 'batch1', repo: 'alpha' },
      { file: shallow, batch: 'batch1', repo: null },
    ]);
  });
});

test('skips symlinked directories but follows a symlinked status file unless it dangles', () => {
  withRoot((dir) => {
    const nested = touch(dir, 'batch1', 'repo1', 'checks-status.json');
    mkdirSync(join(dir, 'batch2'));
    mkdirSync(join(dir, 'batch3'));
    symlinkSync(join(dir, 'batch1'), join(dir, 'batch-link'));
    symlinkSync(join(dir, 'batch1', 'repo1'), join(dir, 'batch1', 'repo-link'));
    symlinkSync(nested, join(dir, 'batch2', 'checks-status.json'));
    symlinkSync(join(dir, 'gone'), join(dir, 'batch3', 'checks-status.json'));
    assert.deepEqual(statusFiles(dir), [
      { file: nested, batch: 'batch1', repo: 'repo1' },
      { file: join(dir, 'batch2', 'checks-status.json'), batch: 'batch2', repo: null },
    ]);
  });
});

test('orders entries by the code units of their full paths', () => {
  withRoot((dir) => {
    const entry = (batch, repo) => ({
      file: repo === null ? join(dir, batch, 'checks-status.json') : join(dir, batch, repo, 'checks-status.json'),
      batch,
      repo,
    });
    const want = [
      entry('Z', null),
      entry('a', 'r'),
      entry('b-c', null),
      entry('b', 'a'),
      entry('b', null),
      entry('b', 'z'),
    ];
    for (const { file } of [...want].reverse()) touch(file);
    assert.deepEqual(statusFiles(dir), want);
  });
});

test('compares paths with exactly -1 below, 1 above and 0 when equal', () => {
  withRoot((dir) => {
    const original = Array.prototype.sort;
    const seen = [];
    Array.prototype.sort = function (compare) {
      seen.push({ self: this, compare });
      return original.call(this, compare);
    };
    let r;
    try {
      r = statusFiles(dir);
    } finally {
      Array.prototype.sort = original;
    }
    assert.deepEqual(r, []);
    const { compare } = seen.find((s) => s.self === r);
    assert.equal(compare({ file: 'a' }, { file: 'b' }), -1);
    assert.equal(compare({ file: 'b' }, { file: 'a' }), 1);
    assert.equal(compare({ file: 'a' }, { file: 'a' }), 0);
  });
});

test('keeps the shallow entry and drops repos when a batch cannot be listed', { skip: process.getuid() === 0 }, () => {
  withRoot((dir) => {
    const shallow = touch(dir, 'batch1', 'checks-status.json');
    touch(dir, 'batch1', 'repo1', 'checks-status.json');
    chmodSync(join(dir, 'batch1'), 0o300);
    try {
      assert.deepEqual(statusFiles(dir), [{ file: shallow, batch: 'batch1', repo: null }]);
    } finally {
      chmodSync(join(dir, 'batch1'), 0o700);
    }
  });
});
