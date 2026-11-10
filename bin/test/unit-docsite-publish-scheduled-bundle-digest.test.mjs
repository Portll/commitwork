// SHA-256 over a directory tree's sorted relative paths and file hashes, plus a file count (bin/docsite-publish-scheduled.mjs bundleDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleDigest } from '../docsite-publish-scheduled.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

const sha = (data) => createHash('sha256').update(data).digest('hex');

const expected = (rows) => {
  const h = createHash('sha256');
  for (const [rel, content] of rows) h.update(`${rel}\0${sha(content)}\n`);
  return { digest: h.digest('hex'), files: rows.length };
};

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'bundleDigest-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('an empty directory hashes nothing and counts zero files', () => {
  withDir((dir) => {
    assert.deepEqual(bundleDigest(dir), { digest: EMPTY_SHA, files: 0 });
  });
});

test('a single file contributes its path, a NUL byte, its content hash and a newline', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    assert.deepEqual(bundleDigest(dir), { digest: sha(`a.txt\0${HELLO_SHA}\n`), files: 1 });
  });
});

test('files are ordered by relative path rather than by creation order', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'c.txt'), 'ccc');
    writeFileSync(join(dir, 'a.txt'), 'aaa');
    writeFileSync(join(dir, 'b.txt'), 'bbb');
    assert.deepEqual(bundleDigest(dir), expected([['a.txt', 'aaa'], ['b.txt', 'bbb'], ['c.txt', 'ccc']]));
  });
});

test('nested files are named by forward-slash paths relative to the root', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'inner.txt'), 'inner');
    writeFileSync(join(dir, 'sub', 'deep', 'leaf.txt'), 'leaf');
    writeFileSync(join(dir, 'root.txt'), 'root');
    assert.deepEqual(
      bundleDigest(dir),
      expected([['root.txt', 'root'], ['sub/deep/leaf.txt', 'leaf'], ['sub/inner.txt', 'inner']]),
    );
  });
});

test('ordering compares code units so uppercase precedes lowercase and a dash precedes a dot and a slash', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a-b'));
    writeFileSync(join(dir, 'a', 'x.txt'), 'one');
    writeFileSync(join(dir, 'a.txt'), 'two');
    writeFileSync(join(dir, 'a-b', 'x.txt'), 'three');
    writeFileSync(join(dir, 'B.txt'), 'four');
    assert.deepEqual(
      bundleDigest(dir),
      expected([['B.txt', 'four'], ['a-b/x.txt', 'three'], ['a.txt', 'two'], ['a/x.txt', 'one']]),
    );
  });
});

test('empty subdirectories add no rows and an empty file hashes as empty input', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'empty', 'deeper'), { recursive: true });
    writeFileSync(join(dir, 'z.txt'), '');
    assert.deepEqual(bundleDigest(dir), { digest: sha(`z.txt\0${EMPTY_SHA}\n`), files: 1 });
  });
});

test('binary content is hashed byte for byte', () => {
  withDir((dir) => {
    const zeros = Buffer.alloc(4096, 0);
    const mixed = Buffer.from([0xff, 0x00, 0x7f, 0x80]);
    writeFileSync(join(dir, 'zeros.bin'), zeros);
    writeFileSync(join(dir, 'bin.dat'), mixed);
    assert.deepEqual(bundleDigest(dir), expected([['bin.dat', mixed], ['zeros.bin', zeros]]));
  });
});

test('the path comparator returns -1 for a lesser path, 1 for a greater path and 0 for an equal path', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'b.txt'), 'bbb');
    writeFileSync(join(dir, 'a.txt'), 'aaa');
    const original = Array.prototype.sort;
    let cmp;
    Array.prototype.sort = function (fn) {
      cmp = fn;
      return original.call(this, fn);
    };
    let r;
    try {
      r = bundleDigest(dir);
    } finally {
      Array.prototype.sort = original;
    }
    assert.deepEqual(r, expected([['a.txt', 'aaa'], ['b.txt', 'bbb']]));
    assert.deepEqual(
      [cmp(['a.txt', 'x'], ['b.txt', 'y']), cmp(['b.txt', 'x'], ['a.txt', 'y']), cmp(['a.txt', 'x'], ['a.txt', 'y'])],
      [-1, 1, 0],
    );
  });
});

test('a path to a regular file throws ENOTDIR from scandir', () => {
  withDir((dir) => {
    const file = join(dir, 'plain.txt');
    writeFileSync(file, 'x');
    assert.throws(() => bundleDigest(file), {
      name: 'Error',
      code: 'ENOTDIR',
      message: `ENOTDIR: not a directory, scandir '${file}'`,
    });
  });
});

test('a missing directory throws ENOENT from scandir', () => {
  withDir((dir) => {
    const missing = join(dir, 'missing');
    assert.throws(() => bundleDigest(missing), {
      name: 'Error',
      code: 'ENOENT',
      message: `ENOENT: no such file or directory, scandir '${missing}'`,
    });
  });
});
