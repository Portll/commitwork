// Per-area readiness and latest evidence for every declared bola area (monitor/bola-fleet.mjs fleet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleet } from '../bola-fleet.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the registry has no areas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [] };
    const result = fleet(reg, { env: {} });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out areas that lack a bola block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 'no-bola', label: 'No Bola' }] };
    const result = fleet(reg, { env: {} });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out areas whose bola block lacks a manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 'no-manifest', label: 'No Manifest', bola: { base: 'http://x' } }] };
    const result = fleet(reg, { env: {} });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out areas whose bola block lacks a base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 'no-base', label: 'No Base', bola: { manifest: 'm.json' } }] };
    const result = fleet(reg, { env: {} });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes areas that have both manifest and base in bola', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 'ok', label: 'OK', bola: { manifest: 'm.json', base: 'http://x' } }] };
    const result = fleet(reg, { env: {} });
    assert.equal(result.length, 1);
    assert.equal(result[0].slug, 'ok');
    assert.equal(result[0].label, 'OK');
    assert.equal(result[0].out, 'ok');
    assert.equal(result[0].manifest, 'm.json');
    assert.equal(result[0].base, 'http://x');
    assert.equal(result[0].note, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the area out field when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 's', label: 'L', out: 'custom-out', bola: { manifest: 'm.json', base: 'http://x' } }] };
    const result = fleet(reg, { env: {} });
    assert.equal(result[0].out, 'custom-out');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the area note field when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 's', label: 'L', bola: { manifest: 'm.json', base: 'http://x', note: 'my note' } }] };
    const result = fleet(reg, { env: {} });
    assert.equal(result[0].note, 'my note');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to slug for label when label is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 'fallback', bola: { manifest: 'm.json', base: 'http://x' } }] };
    const result = fleet(reg, { env: {} });
    assert.equal(result[0].label, 'fallback');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns readiness with blocked true when manifest file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 's', label: 'L', bola: { manifest: 'missing.json', base: 'http://x' } }] };
    const result = fleet(reg, { env: {} });
    assert.equal(result[0].readiness.ready, false);
    assert.equal(result[0].readiness.blocked, true);
    assert.match(result[0].readiness.reason, /missing/);
    assert.deepEqual(result[0].readiness.needed, []);
    assert.deepEqual(result[0].readiness.missing, []);
    assert.deepEqual(result[0].readiness.present, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns evidence with present false when evidence file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  try {
    const reg = { areas: [{ slug: 's', label: 'L', bola: { manifest: 'm.json', base: 'http://x' } }] };
    const result = fleet(reg, { env: {} });
    assert.equal(result[0].evidence.present, false);
    assert.equal(result[0].evidence.unreadable, undefined);
    assert.equal(result[0].evidence.invalid, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
