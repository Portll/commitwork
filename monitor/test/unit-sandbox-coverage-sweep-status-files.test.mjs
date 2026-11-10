// Sorted checks-status.json paths in a sweep directory and its repo subdirectories (monitor/sandbox-coverage.mjs sweepStatusFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepStatusFiles } from '../sandbox-coverage.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sweepStatusFiles-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function addRepo(dir, name) {
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, 'checks-status.json'), '{}');
}

test('A sweep directory that does not exist yields an empty list', () => {
  inTemp((dir) => {
    const input = join(dir, 'no-such-dir');
    const result = sweepStatusFiles(input);
    assert.deepEqual(result, []);
  });
});

test('A sweep path that is a regular file rethrows the ENOTDIR error from reading it', () => {
  inTemp((dir) => {
    const file = join(dir, 'plain.txt');
    writeFileSync(file, 'data');
    assert.throws(() => sweepStatusFiles(file), { name: 'Error', code: 'ENOTDIR' });
  });
});

test('A top-level checks-status.json is listed with a null repo', () => {
  inTemp((dir) => {
    writeFileSync(join(dir, 'checks-status.json'), '{}');
    const result = sweepStatusFiles(dir);
    assert.deepEqual(result, [{ file: join(dir, 'checks-status.json'), repo: null }]);
  });
});

test('A repo subdirectory holding checks-status.json is listed under its directory name', () => {
  inTemp((dir) => {
    addRepo(dir, 'repo-a');
    const result = sweepStatusFiles(dir);
    assert.deepEqual(result, [{ file: join(dir, 'repo-a', 'checks-status.json'), repo: 'repo-a' }]);
  });
});

test('Regular files and subdirectories without checks-status.json add nothing', () => {
  inTemp((dir) => {
    writeFileSync(join(dir, 'notes.txt'), 'x');
    mkdirSync(join(dir, 'empty-repo'));
    writeFileSync(join(dir, 'empty-repo', 'other.json'), '{}');
    const result = sweepStatusFiles(dir);
    assert.deepEqual(result, []);
  });
});

test('A symlink to a repo directory is not treated as a repo', () => {
  inTemp((dir) => {
    const sweep = join(dir, 'sweep');
    mkdirSync(sweep);
    addRepo(dir, 'real-repo');
    symlinkSync(join(dir, 'real-repo'), join(sweep, 'linked'));
    const result = sweepStatusFiles(sweep);
    assert.deepEqual(result, []);
  });
});

test('Entries are sorted by full path so a repo named before checks-status.json comes first', () => {
  inTemp((dir) => {
    writeFileSync(join(dir, 'checks-status.json'), '{}');
    addRepo(dir, 'z-repo');
    addRepo(dir, 'a-repo');
    const result = sweepStatusFiles(dir);
    assert.deepEqual(result, [
      { file: join(dir, 'a-repo', 'checks-status.json'), repo: 'a-repo' },
      { file: join(dir, 'checks-status.json'), repo: null },
      { file: join(dir, 'z-repo', 'checks-status.json'), repo: 'z-repo' },
    ]);
  });
});

test('A repo whose name extends another with a dash sorts before it because dash precedes slash', () => {
  inTemp((dir) => {
    addRepo(dir, 'repo');
    addRepo(dir, 'repo-b');
    const result = sweepStatusFiles(dir);
    assert.deepEqual(result, [
      { file: join(dir, 'repo-b', 'checks-status.json'), repo: 'repo-b' },
      { file: join(dir, 'repo', 'checks-status.json'), repo: 'repo' },
    ]);
  });
});

test('A directory named checks-status.json counts as the shallow entry and as a repo', () => {
  inTemp((dir) => {
    addRepo(dir, 'checks-status.json');
    const result = sweepStatusFiles(dir);
    assert.deepEqual(result, [
      { file: join(dir, 'checks-status.json'), repo: null },
      { file: join(dir, 'checks-status.json', 'checks-status.json'), repo: 'checks-status.json' },
    ]);
  });
});

test('The sort comparator gives -1 only for a strictly smaller path and 1 otherwise, even for the same path', () => {
  inTemp((dir) => {
    writeFileSync(join(dir, 'checks-status.json'), '{}');
    addRepo(dir, 'a');
    const realSort = Array.prototype.sort;
    Array.prototype.sort = function (cmp) {
      return this.map((x) => this.map((y) => cmp(x, y)));
    };
    try {
      const result = sweepStatusFiles(dir);
      Array.prototype.sort = realSort;
      assert.deepEqual(result, [
        [1, 1],
        [-1, 1],
      ]);
    } finally {
      Array.prototype.sort = realSort;
    }
  });
});
