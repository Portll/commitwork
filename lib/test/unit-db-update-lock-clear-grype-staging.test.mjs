// Removes grype-db-download staging entries at least one hour old and returns their names (lib/db-update-lock.mjs clearGrypeStaging).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearGrypeStaging } from '../db-update-lock.mjs';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOUR = 3600_000;
const T = 1700000000;

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'clearGrypeStaging-'));
  try {
    const cacheDir = join(dir, 'cache');
    mkdirSync(cacheDir);
    fn(cacheDir, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeFile(cacheDir, name, secs = T) {
  const p = join(cacheDir, name);
  writeFileSync(p, 'x'.repeat(16));
  utimesSync(p, secs, secs);
  return p;
}

function makeTree(cacheDir, name, secs = T) {
  const p = join(cacheDir, name);
  mkdirSync(join(p, 'nested'), { recursive: true });
  writeFileSync(join(p, 'nested', 'inner.txt'), 'x'.repeat(64));
  writeFileSync(join(p, 'top.txt'), 'y'.repeat(8));
  utimesSync(p, secs, secs);
  return p;
}

test('returns an empty array when the cache directory does not exist', () => {
  withDir((cacheDir, dir) => {
    const missing = join(dir, 'missing');
    const r = clearGrypeStaging({ cacheDir: missing, now: T * 1000 + 2 * HOUR });
    assert.deepEqual(r, []);
    assert.equal(existsSync(missing), false);
  });
});

test('ignores stale entries whose names do not start with the staging prefix', () => {
  withDir((cacheDir) => {
    const a = makeFile(cacheDir, 'grype-db-downloa');
    const b = makeFile(cacheDir, 'Grype-db-download-1');
    const c = makeFile(cacheDir, 'x-grype-db-download');
    const m = statSync(a).mtimeMs;
    const r = clearGrypeStaging({ cacheDir, now: m + 2 * HOUR });
    assert.deepEqual(r, []);
    assert.equal(existsSync(a), true);
    assert.equal(existsSync(b), true);
    assert.equal(existsSync(c), true);
  });
});

test('removes a staging file whose age is exactly one hour', () => {
  withDir((cacheDir) => {
    const p = makeFile(cacheDir, 'grype-db-download-1');
    const m = statSync(p).mtimeMs;
    const r = clearGrypeStaging({ cacheDir, now: m + HOUR });
    assert.deepEqual(r, ['grype-db-download-1']);
    assert.equal(existsSync(p), false);
  });
});

test('keeps a staging file whose age is one millisecond under one hour', () => {
  withDir((cacheDir) => {
    const p = makeFile(cacheDir, 'grype-db-download-2');
    const m = statSync(p).mtimeMs;
    const r = clearGrypeStaging({ cacheDir, now: m + HOUR - 1 });
    assert.deepEqual(r, []);
    assert.equal(existsSync(p), true);
  });
});

test('removes a staging file whose age is one millisecond over one hour', () => {
  withDir((cacheDir) => {
    const p = makeFile(cacheDir, 'grype-db-download');
    const m = statSync(p).mtimeMs;
    const r = clearGrypeStaging({ cacheDir, now: m + HOUR + 1 });
    assert.deepEqual(r, ['grype-db-download']);
    assert.equal(existsSync(p), false);
  });
});

test('removes a stale staging directory together with its nested contents', () => {
  withDir((cacheDir) => {
    const p = makeTree(cacheDir, 'grype-db-download-tree');
    const m = statSync(p).mtimeMs;
    const r = clearGrypeStaging({ cacheDir, now: m + 2 * HOUR });
    assert.deepEqual(r, ['grype-db-download-tree']);
    assert.equal(existsSync(p), false);
    assert.equal(existsSync(cacheDir), true);
  });
});

test('removes only the stale staging entry among fresh and unrelated entries', () => {
  withDir((cacheDir) => {
    const old = makeFile(cacheDir, 'grype-db-download-old');
    const fresh = makeFile(cacheDir, 'grype-db-download-new', T + 1);
    const other = makeFile(cacheDir, 'notes-grype-db-download');
    const m = statSync(old).mtimeMs;
    const r = clearGrypeStaging({ cacheDir, now: m + HOUR });
    assert.deepEqual(r, ['grype-db-download-old']);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(fresh), true);
    assert.equal(existsSync(other), true);
  });
});

test('removes every stale staging entry and returns all of their names', () => {
  withDir((cacheDir) => {
    const names = Array.from({ length: 3 }, (_, i) => `grype-db-download-${i}`);
    const paths = names.map((n, i) => (i === 1 ? makeTree(cacheDir, n) : makeFile(cacheDir, n)));
    const m = statSync(paths[0]).mtimeMs;
    const r = clearGrypeStaging({ cacheDir, now: m + HOUR + 5 });
    assert.deepEqual([...r].sort(), ['grype-db-download-0', 'grype-db-download-1', 'grype-db-download-2']);
    for (const p of paths) assert.equal(existsSync(p), false);
  });
});
