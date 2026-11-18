// Absolute harness store directory from env override or default (flow/store.mjs storeDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeDir } from '../store.mjs';
import { join, parse } from 'node:path';

// A filesystem root on this platform (`/` on POSIX, the working drive's `C:\` on Windows): storeDir
// returns native paths, so the expectations are native too.
const ROOT = parse(process.cwd()).root;

test('returns cwd reports/harness when the env var is missing', () => {
  const r = storeDir({});
  assert.equal(r, join(process.cwd(), 'reports', 'harness'));
});

test('returns cwd reports/harness when the env var is explicitly undefined', () => {
  const r = storeDir({ CW_HARNESS_STORE: undefined });
  assert.equal(r, join(process.cwd(), 'reports', 'harness'));
});

test('returns cwd reports/harness when the env var is an empty string', () => {
  const r = storeDir({ CW_HARNESS_STORE: '' });
  assert.equal(r, join(process.cwd(), 'reports', 'harness'));
});

test('returns cwd reports/harness when the env var is the number zero', () => {
  const r = storeDir({ CW_HARNESS_STORE: 0 });
  assert.equal(r, join(process.cwd(), 'reports', 'harness'));
});

test('returns cwd reports/harness when the env var is false', () => {
  const r = storeDir({ CW_HARNESS_STORE: false });
  assert.equal(r, join(process.cwd(), 'reports', 'harness'));
});

test('returns an absolute override path unchanged', () => {
  const abs = join(ROOT, 'custom', 'store');
  const r = storeDir({ CW_HARNESS_STORE: abs });
  assert.equal(r, abs);
});

test('resolves a relative override path against the current directory', () => {
  const r = storeDir({ CW_HARNESS_STORE: 'custom/store' });
  assert.equal(r, join(process.cwd(), 'custom', 'store'));
});

test('normalizes dot segments and trailing slash in an absolute override', () => {
  const r = storeDir({ CW_HARNESS_STORE: `${ROOT}a/b/../c/` });
  assert.equal(r, join(ROOT, 'a', 'c'));
});

test('returns the current directory when the override is a single dot', () => {
  const r = storeDir({ CW_HARNESS_STORE: '.' });
  assert.equal(r, process.cwd());
});
