// Computes whether the stable rollup covers every observed repo in an area (monitor/area-coverage.mjs assess).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../area-coverage.mjs';

test('returns undetermined when covered is null', () => {
  const r = assess({ observed: ['a', 'b'], covered: null });
  assert.deepEqual(r, { state: "undetermined", reason: "the stable rollup carries no repos[] array", observed: ["a", "b"], covered: null, missing: null, unexpected: null, stableSliceId: null, perRepoNewest: {} });
});

test('returns undetermined when covered is undefined', () => {
  const r = assess({ observed: ['a'], covered: undefined });
  assert.deepEqual(r, { state: "undetermined", reason: "the stable rollup carries no repos[] array", observed: ["a"], covered: null, missing: null, unexpected: null, stableSliceId: null, perRepoNewest: {} });
});

test('returns undetermined when observed is empty and covered is non-empty', () => {
  const r = assess({ observed: [], covered: ['x'] });
  assert.deepEqual(r, { state: "undetermined", reason: "no repo has ever been observed in this area \u2014 nothing to be complete against", observed: [], covered: ["x"], missing: null, unexpected: ["x"], stableSliceId: null, perRepoNewest: {} });
});

test('returns complete when all observed repos are covered', () => {
  const r = assess({ observed: ['a', 'b'], covered: ['a', 'b'] });
  assert.deepEqual(r, { state: "complete", reason: "the stable rollup holds all 2 observed repo(s)", observed: ["a", "b"], covered: ["a", "b"], missing: [], unexpected: [], stableSliceId: null, perRepoNewest: {} });
});

test('returns partial when one observed repo is missing', () => {
  const r = assess({ observed: ['a', 'b'], covered: ['a'] });
  assert.deepEqual(r, { state: "partial", reason: "the stable rollup holds 1 of 2 observed repo(s); 1 absent", observed: ["a", "b"], covered: ["a"], missing: ["b"], unexpected: [], stableSliceId: null, perRepoNewest: {} });
});

test('returns partial when two observed repos are missing', () => {
  const r = assess({ observed: ['a', 'b', 'c'], covered: ['a'] });
  assert.deepEqual(r, { state: "partial", reason: "the stable rollup holds 1 of 3 observed repo(s); 2 absent", observed: ["a", "b", "c"], covered: ["a"], missing: ["b", "c"], unexpected: [], stableSliceId: null, perRepoNewest: {} });
});

test('handles duplicates in observed and covered', () => {
  const r = assess({ observed: ['a', 'a', 'b'], covered: ['a', 'b', 'b'] });
  assert.deepEqual(r, { state: "complete", reason: "the stable rollup holds all 2 observed repo(s)", observed: ["a", "b"], covered: ["a", "b"], missing: [], unexpected: [], stableSliceId: null, perRepoNewest: {} });
});

test('reports unexpected repos present in covered but not observed', () => {
  const r = assess({ observed: ['a'], covered: ['a', 'z'] });
  assert.deepEqual(r, { state: "complete", reason: "the stable rollup holds all 1 observed repo(s)", observed: ["a"], covered: ["a", "z"], missing: [], unexpected: ["z"], stableSliceId: null, perRepoNewest: {} });
});
