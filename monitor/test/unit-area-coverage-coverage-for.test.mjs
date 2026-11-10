// Computes area coverage by comparing declared and observed repos against the stable rollup (monitor/area-coverage.mjs coverageFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageFor } from '../area-coverage.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns undetermined when stable rollup is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverageFor-'));
  try {
    const areaDir = join(dir, 'alpha');
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, 'rollup.json'), '\x00\x01');
    const r = coverageFor('alpha', { root: dir, registry: null });
    assert.deepEqual(r, { area: "alpha", state: "undetermined", reason: "stable rollup.json is unparseable", observed: [], covered: null, missing: null, unexpected: null, perRepoNewest: {}, stableSliceId: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns undetermined when slice directory is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverageFor-'));
  try {
    const areaDir = join(dir, 'beta');
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, 'rollup.json'), JSON.stringify({ repos: [{ name: 'x' }] }));
    const r = coverageFor('beta', { root: dir, registry: null });
    assert.deepEqual(r, { area: "beta", state: "undetermined", reason: "no repo has ever been observed in this area \u2014 nothing to be complete against", observed: [], covered: ["x"], missing: null, unexpected: ["x"], stableSliceId: null, perRepoNewest: {}, unreadableSlices: [], stableRollup: "present" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns complete when stable rollup covers all observed repos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverageFor-'));
  try {
    const areaDir = join(dir, 'gamma');
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, 'rollup.json'), JSON.stringify({ sliceId: 's1', repos: [{ name: 'a' }, { name: 'b' }] }));
    writeFileSync(join(areaDir, 'rollup-sweep-001.json'), JSON.stringify({ sliceId: 's1', generated: '2024-01-01', repos: [{ name: 'a' }, { name: 'b' }] }));
    const r = coverageFor('gamma', { root: dir, registry: null });
    assert.deepEqual(r, { area: "gamma", state: "complete", reason: "the stable rollup holds all 2 observed repo(s)", observed: ["a", "b"], covered: ["a", "b"], missing: [], unexpected: [], stableSliceId: "s1", perRepoNewest: { a: { sliceId: "s1", generated: "2024-01-01", file: "rollup-sweep-001.json" }, b: { sliceId: "s1", generated: "2024-01-01", file: "rollup-sweep-001.json" } }, unreadableSlices: [], stableRollup: "present" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns partial when stable rollup misses some observed repos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverageFor-'));
  try {
    const areaDir = join(dir, 'delta');
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, 'rollup.json'), JSON.stringify({ sliceId: 's2', repos: [{ name: 'a' }] }));
    writeFileSync(join(areaDir, 'rollup-sweep-001.json'), JSON.stringify({ sliceId: 's2', generated: '2024-01-01', repos: [{ name: 'a' }, { name: 'b' }] }));
    const r = coverageFor('delta', { root: dir, registry: null });
    assert.deepEqual(r, { area: "delta", state: "partial", reason: "the stable rollup holds 1 of 2 observed repo(s); 1 absent", observed: ["a", "b"], covered: ["a"], missing: ["b"], unexpected: [], stableSliceId: "s2", perRepoNewest: { a: { sliceId: "s2", generated: "2024-01-01", file: "rollup-sweep-001.json" }, b: { sliceId: "s2", generated: "2024-01-01", file: "rollup-sweep-001.json" } }, unreadableSlices: [], stableRollup: "present" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns undetermined when no repos are observed and rollup is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverageFor-'));
  try {
    const areaDir = join(dir, 'epsilon');
    mkdirSync(areaDir, { recursive: true });
    const r = coverageFor('epsilon', { root: dir, registry: null });
    assert.deepEqual(r, { area: "epsilon", state: "undetermined", reason: "the stable rollup carries no repos[] array", observed: [], covered: null, missing: null, unexpected: null, stableSliceId: null, perRepoNewest: {}, unreadableSlices: [], stableRollup: "absent" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes declared registry repos in observed set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverageFor-'));
  try {
    const areaDir = join(dir, 'zeta');
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, 'rollup.json'), JSON.stringify({ sliceId: 's3', repos: [{ name: 'a' }, { name: 'c' }] }));
    writeFileSync(join(areaDir, 'rollup-sweep-001.json'), JSON.stringify({ sliceId: 's3', generated: '2024-01-01', repos: [{ name: 'a' }] }));
    const registry = [{ name: 'a', area: 'zeta' }, { name: 'c', area: 'zeta' }, { name: 'd', area: 'other' }];
    const r = coverageFor('zeta', { root: dir, registry });
    assert.deepEqual(r, { area: "zeta", state: "complete", reason: "the stable rollup holds all 2 observed repo(s)", observed: ["a", "c"], covered: ["a", "c"], missing: [], unexpected: [], stableSliceId: "s3", perRepoNewest: { a: { sliceId: "s3", generated: "2024-01-01", file: "rollup-sweep-001.json" } }, unreadableSlices: [], stableRollup: "present" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
