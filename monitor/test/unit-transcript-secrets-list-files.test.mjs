// Text files under a root modified at or after sinceAt, plus unlistable dirs (monitor/transcript-secrets.mjs listFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFiles } from '../transcript-secrets.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'listFiles-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const put = (p, data) => {
  writeFileSync(p, data);
  utimesSync(p, 1000, 1000);
};

test('An empty root yields no files and no failures', () => {
  withDir((dir) => {
    const result = listFiles(dir, 0);
    assert.deepEqual(result, { files: [], failures: [] });
  });
});

test('A missing root is reported as an ENOENT failure for the root itself', () => {
  withDir((dir) => {
    const root = join(dir, 'missing');
    const result = listFiles(root, 0);
    assert.deepEqual(result, { files: [], failures: [{ file: '.', failure: 'ENOENT: cannot list' }] });
  });
});

test('An unreadable root is reported as an EACCES failure named with a dot', () => {
  withDir((dir) => {
    chmodSync(dir, 0o000);
    try {
      const result = listFiles(dir, 0);
      assert.deepEqual(result, { files: [], failures: [{ file: '.', failure: 'EACCES: cannot list' }] });
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});

test('An unreadable nested directory is reported by its relative path while other files are listed', () => {
  withDir((dir) => {
    const locked = join(dir, 'outer', 'locked');
    mkdirSync(locked, { recursive: true });
    put(join(dir, 'a.txt'), 'x');
    chmodSync(locked, 0o000);
    try {
      const result = listFiles(dir, 0);
      assert.deepEqual(result, {
        files: [{ abs: join(dir, 'a.txt'), rel: 'a.txt', size: 1 }],
        failures: [{ file: 'outer/locked', failure: 'EACCES: cannot list' }],
      });
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

test('A text file whose mtime equals sinceAt is included', () => {
  withDir((dir) => {
    put(join(dir, 'a.txt'), 'hello');
    const result = listFiles(dir, 1000000);
    assert.deepEqual(result, { files: [{ abs: join(dir, 'a.txt'), rel: 'a.txt', size: 5 }], failures: [] });
  });
});

test('A text file whose mtime is one ms before sinceAt is excluded', () => {
  withDir((dir) => {
    put(join(dir, 'a.txt'), 'hello');
    const result = listFiles(dir, 1000001);
    assert.deepEqual(result, { files: [], failures: [] });
  });
});

test('A regular file without a text extension is skipped while an uppercase text extension is kept', () => {
  withDir((dir) => {
    put(join(dir, 'a.bin'), 'xyz');
    put(join(dir, 'b.LOG'), 'ab');
    const result = listFiles(dir, 0);
    assert.deepEqual(result, { files: [{ abs: join(dir, 'b.LOG'), rel: 'b.LOG', size: 2 }], failures: [] });
  });
});

test('Symbolic links are skipped even when they point at a text file', () => {
  withDir((dir) => {
    put(join(dir, 'real.txt'), 'x');
    symlinkSync(join(dir, 'real.txt'), join(dir, 'link.txt'));
    const result = listFiles(dir, 0);
    assert.deepEqual(result, { files: [{ abs: join(dir, 'real.txt'), rel: 'real.txt', size: 1 }], failures: [] });
  });
});

test('Subdirectories are walked, including one named like a text file, and results are sorted by relative path', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'sub'));
    mkdirSync(join(dir, 'dir.txt'));
    put(join(dir, 'sub', 'b.json'), '{}');
    put(join(dir, 'dir.txt', 'c.txt'), 'cc');
    put(join(dir, 'a.md'), 'm');
    const result = listFiles(dir, 0);
    assert.deepEqual(result, {
      files: [
        { abs: join(dir, 'a.md'), rel: 'a.md', size: 1 },
        { abs: join(dir, 'dir.txt', 'c.txt'), rel: 'dir.txt/c.txt', size: 2 },
        { abs: join(dir, 'sub', 'b.json'), rel: 'sub/b.json', size: 2 },
      ],
      failures: [],
    });
  });
});
