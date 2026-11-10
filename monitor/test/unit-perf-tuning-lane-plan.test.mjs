// Computes the per-lane scan plan: whether a scanner runs at a given depth/intensity, its level, env vars, and the reason it is skipped. (monitor/perf-tuning.mjs lanePlan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanePlan } from '../perf-tuning.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const doc = {
  profiles: {},
  scanners: {
    s1: { cost: 'cheap', minDepth: 2, depthLadder: ['shallow', 'mid', 'deep'], intensityLadder: ['low', 'high'] },
    s2: { cost: 'expensive', minDepth: 3, intensityLadder: ['low', 'mid', 'high'] },
    s3: { cost: 'cheap', minDepth: 1, depthLadder: ['only'] }
  },
  costClasses: { cheap: { minDepth: 1 }, expensive: { minDepth: 4 } },
  depthLevels: ['d1', 'd2', 'd3', 'd4', 'd5'],
  intensityLevels: ['i1', 'i2', 'i3'],
  diskClasses: {}
};

function run(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lanePlan-'));
  try {
    writeFileSync(join(dir, 'perf-profiles.json'), JSON.stringify(doc));
    process.env.CW_PERF_PROFILES = join(dir, 'perf-profiles.json');
    return fn();
  } finally {
    delete process.env.CW_PERF_PROFILES;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns known false and run true for an unknown scanner id', () => {
  run(() => {
    const r = lanePlan('nope', { depth: 1, intensity: 1 });
    assert.deepEqual(r, { known: false, run: true, env: {}, depth: null, intensity: null });
  });
});

test('returns known true and run true when depth meets the scanner minimum', () => {
  run(() => {
    const r = lanePlan('s1', { depth: 2, intensity: 1 });
    assert.deepEqual(r, { known: true, run: true, reason: null, basis: null, env: { CW_DEPTH_LEVEL: "shallow", CW_DEPTH_RANK: "1", CW_INTENSITY_LEVEL: "low", CW_INTENSITY_RANK: "1" }, depth: { value: 2, kind: "graded", minDepth: 2, from: 2, gated: false, on: true, level: { rank: 1, of: 3, label: "shallow" }, ladder: ["shallow", "mid", "deep"] }, intensity: { value: 1, kind: "graded", level: { rank: 1, of: 2, label: "low" }, ladder: ["low", "high"], timeoutFactor: 1.5 } });
  });
});

test('returns known true and run false with basis depth when depth is below the scanner minimum', () => {
  run(() => {
    const r = lanePlan('s1', { depth: 1, intensity: 1 });
    assert.deepEqual(r, { known: true, run: false, reason: "this lane runs from depth 2 (undefined); this repository is at depth 1 (undefined). NOT SCANNED at this depth \u2014 a deliberate coverage gap, not a clean result.", basis: "depth", env: { CW_INTENSITY_LEVEL: "low", CW_INTENSITY_RANK: "1" }, depth: { value: 1, kind: "graded", minDepth: 2, from: 2, gated: true, on: false, level: { rank: 0, of: 3, label: "off" }, ladder: ["shallow", "mid", "deep"] }, intensity: { value: 1, kind: "graded", level: { rank: 1, of: 2, label: "low" }, ladder: ["low", "high"], timeoutFactor: 1.5 } });
  });
});

test('returns known true and run false with basis override when override is off', () => {
  run(() => {
    const r = lanePlan('s1', { depth: 2, intensity: 1, override: 'off' });
    assert.deepEqual(r, { known: true, run: false, reason: "forced OFF by an operator override \u2014 NOT SCANNED, which is not the same as finding nothing.", basis: "override", env: { CW_INTENSITY_LEVEL: "low", CW_INTENSITY_RANK: "1" }, depth: { value: 2, kind: "graded", minDepth: 2, from: 2, gated: false, on: false, level: { rank: 0, of: 3, label: "off" }, ladder: ["shallow", "mid", "deep"] }, intensity: { value: 1, kind: "graded", level: { rank: 1, of: 2, label: "low" }, ladder: ["low", "high"], timeoutFactor: 1.5 } });
  });
});

test('returns known true and run true with basis null when override is on and depth is below minimum', () => {
  run(() => {
    const r = lanePlan('s1', { depth: 1, intensity: 1, override: 'on' });
    assert.deepEqual(r, { known: true, run: true, reason: null, basis: null, env: { CW_DEPTH_LEVEL: "shallow", CW_DEPTH_RANK: "1", CW_INTENSITY_LEVEL: "low", CW_INTENSITY_RANK: "1" }, depth: { value: 1, kind: "graded", minDepth: 2, from: 2, gated: true, on: true, level: { rank: 1, of: 3, label: "shallow" }, ladder: ["shallow", "mid", "deep"] }, intensity: { value: 1, kind: "graded", level: { rank: 1, of: 2, label: "low" }, ladder: ["low", "high"], timeoutFactor: 1.5 } });
  });
});

test('returns known true and run false with reason naming the depth labels when depth is below minimum', () => {
  run(() => {
    const r = lanePlan('s2', { depth: 2, intensity: 1 });
    assert.deepEqual(r, { known: true, run: false, reason: "this lane runs from depth 3 (undefined); this repository is at depth 2 (undefined). NOT SCANNED at this depth \u2014 a deliberate coverage gap, not a clean result.", basis: "depth", env: { CW_INTENSITY_LEVEL: "low", CW_INTENSITY_RANK: "1" }, depth: { value: 2, kind: "binary", minDepth: 3, from: 3, gated: true, on: false, level: { rank: 0, of: 1, label: "off" }, ladder: null }, intensity: { value: 1, kind: "graded", level: { rank: 1, of: 3, label: "low" }, ladder: ["low", "mid", "high"], timeoutFactor: 1.5 } });
  });
});

test('returns known true and run true with empty env when scanner has no depth ladder', () => {
  run(() => {
    const r = lanePlan('s2', { depth: 4, intensity: 1 });
    assert.deepEqual(r, { known: true, run: true, reason: null, basis: null, env: { CW_INTENSITY_LEVEL: "low", CW_INTENSITY_RANK: "1" }, depth: { value: 4, kind: "binary", minDepth: 3, from: 3, gated: false, on: true, level: { rank: 1, of: 1, label: "on" }, ladder: null }, intensity: { value: 1, kind: "graded", level: { rank: 1, of: 3, label: "low" }, ladder: ["low", "mid", "high"], timeoutFactor: 1.5 } });
  });
});

test('returns known true and run true with empty env when depth ladder has length one', () => {
  run(() => {
    const r = lanePlan('s3', { depth: 1, intensity: 1 });
    assert.deepEqual(r, { known: true, run: true, reason: null, basis: null, env: {}, depth: { value: 1, kind: "n/a", minDepth: 1, from: 1, gated: false, on: true, level: null, ladder: null }, intensity: { value: 1, kind: "n/a", level: null, ladder: null, timeoutFactor: 1.5 } });
  });
});
