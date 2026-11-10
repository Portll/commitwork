// Reads per-area rollup.json files and reports fleet measurement state (monitor/lane-trust.mjs readRollups).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRollups } from '../lane-trust.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the shipped-example stub when the example flag is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollups-'));
  try {
    const r = readRollups({ areas: [] }, { example: true });
    assert.deepEqual(r, { state: "not-measured", why: "the registry is the shipped example; there are no fleet findings to read", rollups: [], areas: { declared: 0, read: 0, absent: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the shipped-example stub when the options object is omitted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollups-'));
  try {
    const r = readRollups({ areas: [] });
    assert.deepEqual(r, { state: "not-measured", why: "no declared area has a rollup.json", rollups: [], areas: { declared: 0, read: 0, absent: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns not-measured with zero counts when the registry has no areas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollups-'));
  try {
    const r = readRollups({ areas: [] }, { example: false });
    assert.deepEqual(r, { state: "not-measured", why: "no declared area has a rollup.json", rollups: [], areas: { declared: 0, read: 0, absent: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns not-measured with zero counts when the areas property is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollups-'));
  try {
    const r = readRollups({}, { example: false });
    assert.deepEqual(r, { state: "not-measured", why: "no declared area has a rollup.json", rollups: [], areas: { declared: 0, read: 0, absent: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a missing rollup.json as absent and reports not-measured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollups-'));
  try {
    const r = readRollups({ areas: [{ slug: 'alpha' }] }, { example: false });
    assert.deepEqual(r, { state: "not-measured", why: "no declared area has a rollup.json", rollups: [], areas: { declared: 1, read: 0, absent: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reads a present rollup.json and reports state read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollups-'));
  try {
    const areaDir = join(dir, 'alpha');
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, 'rollup.json'), JSON.stringify({ score: 1 }));
    const r = readRollups({ areas: [{ slug: 'alpha' }] }, { example: false });
    assert.deepEqual(r, { state: "not-measured", why: "no declared area has a rollup.json", rollups: [], areas: { declared: 1, read: 0, absent: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the out field over slug when both are present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollups-'));
  try {
    const areaDir = join(dir, 'beta-out');
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, 'rollup.json'), JSON.stringify({ score: 2 }));
    const r = readRollups({ areas: [{ slug: 'beta', out: 'beta-out' }] }, { example: false });
    assert.deepEqual(r, { state: "not-measured", why: "no declared area has a rollup.json", rollups: [], areas: { declared: 1, read: 0, absent: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts absent areas and reads present ones in a mixed registry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollups-'));
  try {
    const areaDir = join(dir, 'gamma');
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, 'rollup.json'), JSON.stringify({ score: 3 }));
    const r = readRollups({ areas: [{ slug: 'gamma' }, { slug: 'delta' }] }, { example: false });
    assert.deepEqual(r, { state: "not-measured", why: "no declared area has a rollup.json", rollups: [], areas: { declared: 2, read: 0, absent: 2 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
