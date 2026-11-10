// Determines Chrome executable location (lib/cdp.mjs findChrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome } from '../cdp.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns path from CW_CHROME when it points to an existing file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'findChrome-'));
  try {
    const chromePath = join(dir, 'chrome');
    writeFileSync(chromePath, '');
    const result = findChrome({ env: { CW_CHROME: chromePath } });
    assert.deepEqual(result, { path: chromePath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unavailable when CW_CHROME points to a non-file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'findChrome-'));
  try {
    const bogusPath = join(dir, 'missing');
    const result = findChrome({ env: { CW_CHROME: bogusPath } });
    assert.deepEqual(result, { unavailable: `CW_CHROME=${bogusPath} is not a file` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finds first candidate that exists using the default exists check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'findChrome-'));
  try {
    const candidate = '/usr/bin/chromium';
    const mockExists = (p) => p === candidate;
    const result = findChrome({ exists: mockExists });
    assert.deepEqual(result, { path: candidate });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unavailable when no CW_CHROME and no candidates exist', async () => {
  const result = findChrome({ exists: () => false });
  assert.deepEqual(result, { unavailable: 'no Chrome/Chromium/Edge found; set CW_CHROME' });
});

test('uses provided exists function to detect a file deep in a temporary hierarchy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'findChrome-'));
  try {
    const deepPath = join(dir, ...Array.from({ length: 5 }, (_, i) => `sub${i}`));
    mkdirSync(join(dir, ...Array.from({ length: 4 }, (_, i) => `sub${i}`)), { recursive: true });
    writeFileSync(deepPath, '');
    const mockExists = (p) => p === deepPath;
    const result = findChrome({ exists: mockExists });
    assert.deepEqual(result, { unavailable: "no Chrome/Chromium/Edge found; set CW_CHROME" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
