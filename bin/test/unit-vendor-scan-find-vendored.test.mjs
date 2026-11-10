// Finds vendored library files under a root directory (bin/vendor-scan.mjs findVendored).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findVendored } from '../vendor-scan.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the root directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  try {
    assert.deepEqual(findVendored(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the root directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  const missing = join(dir, 'no-such-dir');
  try {
    assert.deepEqual(findVendored(missing), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes a minified file that is not in a vendor directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  writeFileSync(join(dir, 'app.min.js'), 'x');
  try {
    assert.deepEqual(findVendored(dir), ["app.min.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes a file in a vendor directory that is not minified', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  mkdirSync(join(dir, 'vendor'));
  writeFileSync(join(dir, 'vendor', 'lib.js'), 'x');
  try {
    assert.deepEqual(findVendored(dir), ["vendor/lib.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes a file in a node_modules directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules', 'lib.js'), 'x');
  try {
    assert.deepEqual(findVendored(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes a file in a .claude directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude', 'lib.js'), 'x');
  try {
    assert.deepEqual(findVendored(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes a file in a hidden directory other than .claude', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  mkdirSync(join(dir, '.hidden'));
  writeFileSync(join(dir, '.hidden', 'lib.js'), 'x');
  try {
    assert.deepEqual(findVendored(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes a non-scannable file in a vendor directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  mkdirSync(join(dir, 'vendor'));
  writeFileSync(join(dir, 'vendor', 'lib.txt'), 'x');
  try {
    assert.deepEqual(findVendored(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes a non-scannable file that is not in a vendor directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  writeFileSync(join(dir, 'app.txt'), 'x');
  try {
    assert.deepEqual(findVendored(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes a file in a third-party directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findVendored-'));
  mkdirSync(join(dir, 'third-party'));
  writeFileSync(join(dir, 'third-party', 'lib.js'), 'x');
  try {
    assert.deepEqual(findVendored(dir), ["third-party/lib.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
