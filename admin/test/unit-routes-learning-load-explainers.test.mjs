// Loads the explainers registry JSON and returns a structured result (admin/routes/learning.mjs loadExplainers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExplainers } from '../routes/learning.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseDir = mkdtempSync(join(tmpdir(), 'loadExplainers-'));

test('returns ok true with audience and explainers when registry is valid', () => {
  const dir = join(baseDir, 'valid');
  mkdirSync(dir, { recursive: true });
  const registry = join(dir, 'explainers.json');
  writeFileSync(registry, JSON.stringify({ audience: 'devs', explainers: [{ id: 'a' }, { id: 'b' }] }));
  process.env.CW_EXPLAINERS = registry;
  try {
    const result = loadExplainers();
    assert.deepEqual(result, { ok: true, audience: 'devs', explainers: [{ id: 'a' }, { id: 'b' }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with error when explainers key is missing', () => {
  const dir = join(baseDir, 'no-explainers');
  mkdirSync(dir, { recursive: true });
  const registry = join(dir, 'explainers.json');
  writeFileSync(registry, JSON.stringify({ audience: 'users' }));
  process.env.CW_EXPLAINERS = registry;
  try {
    const result = loadExplainers();
    assert.equal(result.ok, false);
    assert.match(result.error, /explainers\[\] missing/);
    assert.deepEqual(result.explainers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with error when explainers is not an array', () => {
  const dir = join(baseDir, 'not-array');
  mkdirSync(dir, { recursive: true });
  const registry = join(dir, 'explainers.json');
  writeFileSync(registry, JSON.stringify({ audience: 'x', explainers: { id: 'a' } }));
  process.env.CW_EXPLAINERS = registry;
  try {
    const result = loadExplainers();
    assert.equal(result.ok, false);
    assert.match(result.error, /explainers\[\] missing/);
    assert.deepEqual(result.explainers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with error when file does not exist', () => {
  const dir = join(baseDir, 'missing');
  mkdirSync(dir, { recursive: true });
  const registry = join(dir, 'nonexistent.json');
  process.env.CW_EXPLAINERS = registry;
  try {
    const result = loadExplainers();
    assert.equal(result.ok, false);
    assert.match(result.error, /ENOENT/);
    assert.deepEqual(result.explainers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with error when JSON is malformed', () => {
  const dir = join(baseDir, 'malformed');
  mkdirSync(dir, { recursive: true });
  const registry = join(dir, 'explainers.json');
  writeFileSync(registry, '{ invalid json');
  process.env.CW_EXPLAINERS = registry;
  try {
    const result = loadExplainers();
    assert.equal(result.ok, false);
    assert.match(result.error, /Expected property name/);
    assert.deepEqual(result.explainers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with empty explainers array when explainers is empty', () => {
  const dir = join(baseDir, 'empty');
  mkdirSync(dir, { recursive: true });
  const registry = join(dir, 'explainers.json');
  writeFileSync(registry, JSON.stringify({ audience: 'all', explainers: [] }));
  process.env.CW_EXPLAINERS = registry;
  try {
    const result = loadExplainers();
    assert.deepEqual(result, { ok: true, audience: 'all', explainers: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with error when registry path is a directory', () => {
  const dir = join(baseDir, 'dir-as-registry');
  mkdirSync(dir, { recursive: true });
  const registry = join(dir, 'subdir');
  mkdirSync(registry, { recursive: true });
  process.env.CW_EXPLAINERS = registry;
  try {
    const result = loadExplainers();
    assert.equal(result.ok, false);
    assert.match(result.error, /EISDIR/);
    assert.deepEqual(result.explainers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

rmSync(baseDir, { recursive: true, force: true });
