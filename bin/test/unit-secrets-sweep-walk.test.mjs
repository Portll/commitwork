// Files under a directory tree, plus skipped directories and read failures (bin/secrets-sweep.mjs walk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walk } from '../secrets-sweep.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'walk-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a directory that does not exist yields an empty accumulator with no failure', () => {
  inTemp((dir) => {
    const r = walk(join(dir, 'missing'), dir);
    assert.deepEqual(r, { files: [], skippedDirs: [], failures: [] });
  });
});

test('a file passed as the directory records an ENOTDIR failure under its relative path', () => {
  inTemp((dir) => {
    const file = join(dir, 'f.txt');
    writeFileSync(file, 'x');
    const r = walk(file, dir);
    assert.deepEqual(r, {
      files: [],
      skippedDirs: [],
      failures: [{ file: 'f.txt', failure: `ENOTDIR: ENOTDIR: not a directory, scandir '${file}'` }],
    });
  });
});

test('a failure on the root itself is recorded under the name dot', () => {
  inTemp((dir) => {
    const file = join(dir, 'root.txt');
    writeFileSync(file, 'x');
    const r = walk(file, file);
    assert.deepEqual(r, {
      files: [],
      skippedDirs: [],
      failures: [{ file: '.', failure: `ENOTDIR: ENOTDIR: not a directory, scandir '${file}'` }],
    });
  });
});

test('relative paths are computed against the root rather than the walked directory', () => {
  inTemp((dir) => {
    mkdirSync(join(dir, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'deep', 'f.txt'), 'x');
    const r = walk(join(dir, 'sub'), dir);
    assert.deepEqual(r, {
      files: [{ abs: join(dir, 'sub', 'deep', 'f.txt'), rel: 'sub/deep/f.txt' }],
      skippedDirs: [],
      failures: [],
    });
  });
});

test('files are collected recursively while node_modules and .git are recorded as skipped', () => {
  inTemp((dir) => {
    writeFileSync(join(dir, 'a.txt'), 'a');
    writeFileSync(join(dir, 'b.txt'), 'b');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'pkg.js'), 'p');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'config'), 'g');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'c.txt'), 'c');
    const r = walk(dir, dir);
    assert.deepEqual(r, {
      files: [
        { abs: join(dir, 'a.txt'), rel: 'a.txt' },
        { abs: join(dir, 'b.txt'), rel: 'b.txt' },
        { abs: join(dir, 'src', 'c.txt'), rel: 'src/c.txt' },
      ],
      skippedDirs: ['.git', 'node_modules'],
      failures: [],
    });
  });
});

test('symbolic links to files and directories are left out entirely', () => {
  inTemp((dir) => {
    writeFileSync(join(dir, 'real.txt'), 'real');
    symlinkSync(join(dir, 'real.txt'), join(dir, 'link.txt'));
    mkdirSync(join(dir, 'd'));
    writeFileSync(join(dir, 'd', 'in.txt'), 'i');
    symlinkSync(join(dir, 'd'), join(dir, 'dlink'));
    const r = walk(dir, dir);
    assert.deepEqual(r, {
      files: [
        { abs: join(dir, 'd', 'in.txt'), rel: 'd/in.txt' },
        { abs: join(dir, 'real.txt'), rel: 'real.txt' },
      ],
      skippedDirs: [],
      failures: [],
    });
  });
});

test('entries are ordered by locale comparison ignoring case', () => {
  inTemp((dir) => {
    writeFileSync(join(dir, 'Zebra.txt'), 'z');
    writeFileSync(join(dir, 'apple.txt'), 'a');
    writeFileSync(join(dir, 'Mango.txt'), 'm');
    const r = walk(dir, dir);
    assert.deepEqual(r, {
      files: [
        { abs: join(dir, 'apple.txt'), rel: 'apple.txt' },
        { abs: join(dir, 'Mango.txt'), rel: 'Mango.txt' },
        { abs: join(dir, 'Zebra.txt'), rel: 'Zebra.txt' },
      ],
      skippedDirs: [],
      failures: [],
    });
  });
});

test('a nested skipped directory is recorded with a forward-slash relative path', () => {
  inTemp((dir) => {
    mkdirSync(join(dir, 'a', 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'a', 'node_modules', 'x.js'), 'x');
    const r = walk(dir, dir);
    assert.deepEqual(r, { files: [], skippedDirs: ['a/node_modules'], failures: [] });
  });
});

test('a supplied accumulator is appended to and returned as the same object', () => {
  inTemp((dir) => {
    writeFileSync(join(dir, 'f.txt'), 'f');
    mkdirSync(join(dir, 'node_modules'));
    const acc = { files: [{ abs: '/x', rel: 'x' }], skippedDirs: ['old'], failures: [] };
    const r = walk(dir, dir, acc);
    assert.equal(r, acc);
    assert.deepEqual(acc, {
      files: [{ abs: '/x', rel: 'x' }, { abs: join(dir, 'f.txt'), rel: 'f.txt' }],
      skippedDirs: ['old', 'node_modules'],
      failures: [],
    });
  });
});
