// Maps a scanner check to its per-run core count from the perf profile (monitor/perf-tuning.mjs coresFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coresFor } from '../perf-tuning.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const doc = {
  profiles: {},
  scanners: {
    'fast': { cost: 'low' },
    'zero': { cost: 'zero' },
    'one': { cost: 'one' },
    'two': { cost: 'two' },
    'neg': { cost: 'neg' },
    'nan': { cost: 'nan' },
    'inf': { cost: 'inf' },
    'missing': { cost: 'missing' },
    'noCost': {},
    'noClass': { cost: 'noClass' }
  },
  costClasses: {
    low: { coresPerRun: 2 },
    zero: { coresPerRun: 0 },
    one: { coresPerRun: 1 },
    two: { coresPerRun: 2 },
    neg: { coresPerRun: -1 },
    nan: { coresPerRun: NaN },
    inf: { coresPerRun: Infinity },
    missing: {}
  },
  depthLevels: {},
  intensityLevels: {},
  diskClasses: {}
};

test('returns the core count for a scanner with a positive cost class', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('fast', { doc });
    assert.equal(r, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the cost class core count is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('zero', { doc });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the core count when it is exactly one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('one', { doc });
    assert.equal(r, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the core count when it is two', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('two', { doc });
    assert.equal(r, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the cost class core count is negative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('neg', { doc });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the cost class core count is NaN', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('nan', { doc });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the cost class core count is Infinity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('inf', { doc });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the cost class exists but has no coresPerRun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('missing', { doc });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the scanner has no cost property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('noCost', { doc });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the cost class key is not in costClasses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coresFor-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc));
    const r = coresFor('noClass', { doc });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
