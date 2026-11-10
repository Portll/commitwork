// Extracts the appliesIfExists array for the deps-osv lane from a baseline manifest (monitor/lane-reach.mjs gateMarkers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateMarkers } from '../lane-reach.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the appliesIfExists array when the lane check exists with a valid array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateMarkers-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({ checks: [{ id: 'deps-osv', appliesIfExists: ['a', 'b'] }] }));
    const r = gateMarkers({ path: p });
    assert.deepEqual(r, ["a", "b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the manifest file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateMarkers-'));
  try {
    const p = join(dir, 'missing.json');
    const r = gateMarkers({ path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the manifest contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateMarkers-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const r = gateMarkers({ path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the lane check is not present in the manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateMarkers-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({ checks: [{ id: 'other-lane', appliesIfExists: ['x'] }] }));
    const r = gateMarkers({ path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the lane check exists but appliesIfExists is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateMarkers-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({ checks: [{ id: 'deps-osv', appliesIfExists: 'not-array' }] }));
    const r = gateMarkers({ path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the appliesIfExists array when the manifest has no checks key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateMarkers-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({ other: 1 }));
    const r = gateMarkers({ path: p });
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the manifest checks array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateMarkers-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({ checks: [] }));
    const r = gateMarkers({ path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the appliesIfExists array when a null entry precedes the lane check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateMarkers-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({ checks: [null, { id: 'deps-osv', appliesIfExists: ['z'] }] }));
    const r = gateMarkers({ path: p });
    assert.deepEqual(r, ["z"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
