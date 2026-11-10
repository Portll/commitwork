// Safety verdict for a scratch base directory path (bin/lib/isolation.mjs checkScratchBase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScratchBase } from '../lib/isolation.mjs';
import { mkdtempSync, rmSync, mkdirSync, chmodSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const uid = process.getuid();

function withRoot(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'checkScratchBase-'));
  try {
    fn(realpathSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeDir(path, mode) {
  mkdirSync(path);
  chmodSync(path, mode);
  return path;
}

const unreachableFs = {
  lstatSync() { throw new Error('lstatSync should not be called'); },
  realpathSync() { throw new Error('realpathSync should not be called'); },
};

test('a base that is not an absolute path string is unsafe', () => {
  assert.equal(checkScratchBase(123, { fs: unreachableFs, uid }), 'scratch-base-unsafe');
  assert.equal(checkScratchBase('relative/path', { fs: unreachableFs, uid }), 'scratch-base-unsafe');
});

test('a null uid makes the base unsafe before the filesystem is consulted', () => {
  withRoot((root) => {
    assert.equal(checkScratchBase(join(root, 'missing'), { uid: null }), 'scratch-base-unsafe');
  });
});

test('a base that does not exist reports no-scratch', () => {
  withRoot((root) => {
    assert.equal(checkScratchBase(join(root, 'missing'), { uid }), 'no-scratch');
  });
});

test('a symbolic link to an owner-only directory is unsafe', () => {
  withRoot((root) => {
    const target = makeDir(join(root, 'target'), 0o700);
    const link = join(root, 'link');
    symlinkSync(target, link);
    assert.equal(checkScratchBase(link, { uid }), 'scratch-base-unsafe');
  });
});

test('an owner-only regular file is unsafe because it is not a directory', () => {
  withRoot((root) => {
    const file = join(root, 'file.txt');
    writeFileSync(file, 'data');
    chmodSync(file, 0o600);
    assert.equal(checkScratchBase(file, { uid }), 'scratch-base-unsafe');
  });
});

test('an owner-only directory owned by a different uid is unsafe', () => {
  withRoot((root) => {
    const sub = makeDir(join(root, 'sub'), 0o700);
    assert.equal(checkScratchBase(sub, { uid: uid + 1 }), 'scratch-base-unsafe');
  });
});

test('any group or other permission bit makes the directory unsafe', () => {
  withRoot((root) => {
    const otherExec = makeDir(join(root, 'other-exec'), 0o701);
    const groupAll = makeDir(join(root, 'group-all'), 0o770);
    assert.equal(checkScratchBase(otherExec, { uid }), 'scratch-base-unsafe');
    assert.equal(checkScratchBase(groupAll, { uid }), 'scratch-base-unsafe');
  });
});

test('a directory reached through a symlinked parent is unsafe because its real path differs', () => {
  withRoot((root) => {
    const real = makeDir(join(root, 'real'), 0o700);
    makeDir(join(real, 'sub'), 0o700);
    symlinkSync(real, join(root, 'alias'));
    assert.equal(checkScratchBase(join(root, 'alias', 'sub'), { uid }), 'scratch-base-unsafe');
  });
});

test('an owner-only directory owned by the caller is safe with or without trailing slashes', () => {
  withRoot((root) => {
    const sub = makeDir(join(root, 'sub'), 0o700);
    assert.equal(checkScratchBase(sub, { uid }), null);
    assert.equal(checkScratchBase(sub + '//', { uid }), null);
  });
});

test('the current process uid is used when no uid is given', () => {
  withRoot((root) => {
    const sub = makeDir(join(root, 'sub'), 0o700);
    assert.equal(checkScratchBase(sub), null);
  });
});
