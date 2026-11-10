// Reads preflight.json from outDir, returning parsed JSON, null on ENOENT, or an unreadable object (monitor/preflight-join.mjs readPreflight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPreflight } from '../preflight-join.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns parsed object when preflight.json exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPreflight-'));
  try {
    writeFileSync(join(dir, 'preflight.json'), JSON.stringify({ repos: ['a', 'b'] }));
    const r = readPreflight(dir);
    assert.deepEqual(r, { repos: ["a", "b"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when preflight.json is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPreflight-'));
  try {
    const r = readPreflight(dir);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable object with EACCES code when file is not readable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPreflight-'));
  try {
    writeFileSync(join(dir, 'preflight.json'), 'x');
    chmodSync(join(dir, 'preflight.json'), 0o000);
    const r = readPreflight(dir);
    assert.deepEqual(r, { unreadable: "preflight.json unreadable (EACCES)", repos: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable object with error fallback when exception has no code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPreflight-'));
  try {
    mkdirSync(join(dir, 'preflight.json'));
    const r = readPreflight(dir);
    assert.deepEqual(r, { unreadable: "preflight.json unreadable (EISDIR)", repos: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed array when preflight.json contains a JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPreflight-'));
  try {
    writeFileSync(join(dir, 'preflight.json'), JSON.stringify([1, 2, 3]));
    const r = readPreflight(dir);
    assert.deepEqual(r, [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
