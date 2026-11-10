// File descriptor with repo-relative path, byte size, sha256 and mtime (lib/memory-layer-pointer.mjs describeFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFile } from '../memory-layer-pointer.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const FIXED = new Date('2020-01-02T03:04:05.000Z');
const FIXED_ISO = '2020-01-02T03:04:05.000Z';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'describeFile-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeFile(filePath, content) {
  writeFileSync(filePath, content);
  utimesSync(filePath, FIXED, FIXED);
}

test('a file directly inside the repo is described by its name, size, hash and mtime', () => {
  withDir((dir) => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const filePath = join(repo, 'file.txt');
    makeFile(filePath, 'hello');
    assert.deepEqual(describeFile(repo, filePath), {
      path: 'file.txt',
      bytes: 5,
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      mtime: FIXED_ISO,
    });
  });
});

test('when the repo equals the file path the basename is used as the path', () => {
  withDir((dir) => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const filePath = join(repo, 'file.txt');
    makeFile(filePath, 'hello');
    assert.deepEqual(describeFile(filePath, filePath), {
      path: 'file.txt',
      bytes: 5,
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      mtime: FIXED_ISO,
    });
  });
});

test('a nested file keeps its full relative path rather than only its basename', () => {
  withDir((dir) => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'a', 'b'), { recursive: true });
    const filePath = join(repo, 'a', 'b', 'c.txt');
    makeFile(filePath, 'nested');
    assert.deepEqual(describeFile(repo, filePath), {
      path: 'a/b/c.txt',
      bytes: 6,
      sha256: sha256('nested'),
      mtime: FIXED_ISO,
    });
  });
});

test('a file outside the repo gets a parent-relative path', () => {
  withDir((dir) => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const filePath = join(dir, 'out.txt');
    makeFile(filePath, 'out');
    assert.deepEqual(describeFile(repo, filePath), {
      path: '../out.txt',
      bytes: 3,
      sha256: sha256('out'),
      mtime: FIXED_ISO,
    });
  });
});

test('an empty file has zero bytes and the empty-input sha256', () => {
  withDir((dir) => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const filePath = join(repo, 'empty.txt');
    makeFile(filePath, '');
    assert.deepEqual(describeFile(repo, filePath), {
      path: 'empty.txt',
      bytes: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      mtime: FIXED_ISO,
    });
  });
});

test('a binary file of 1024 zero bytes reports its byte length and hash', () => {
  withDir((dir) => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const filePath = join(repo, 'data.bin');
    const content = Buffer.alloc(1024, 0);
    makeFile(filePath, content);
    assert.deepEqual(describeFile(repo, filePath), {
      path: 'data.bin',
      bytes: 1024,
      sha256: sha256(content),
      mtime: FIXED_ISO,
    });
  });
});

test('a missing file makes describeFile throw the ENOENT open error', () => {
  withDir((dir) => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const filePath = join(repo, 'missing.txt');
    assert.throws(() => describeFile(repo, filePath), {
      name: 'Error',
      code: 'ENOENT',
      message: `ENOENT: no such file or directory, open '${filePath}'`,
    });
  });
});
