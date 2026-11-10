// Collects noscan void entries from scanners and repos, sorted by lane then repo (cra/neutral-report.mjs voidsOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voidsOf } from '../neutral-report.mjs';

test('returns empty array when rollup is null', () => {
  assert.deepEqual(voidsOf(null), []);
});

test('returns empty array when rollup has no scanners or repos', () => {
  assert.deepEqual(voidsOf({}), []);
});

test('includes scanner void when noscan is a finite number and reason is set', () => {
  const rollup = { scanners: { alpha: { noscan: 1, noscanReason: 'skip' } } };
  assert.deepEqual(voidsOf(rollup), [{ lane: "alpha", repo: null, reason: "skip" }]);
});

test('skips scanner entry when noscan is not a finite number', () => {
  const rollup = { scanners: { alpha: { noscan: 'x', noscanReason: 'skip' } } };
  assert.deepEqual(voidsOf(rollup), []);
});

test('skips scanner entry when noscanReason is missing', () => {
  const rollup = { scanners: { alpha: { noscan: 1 } } };
  assert.deepEqual(voidsOf(rollup), []);
});

test('includes repo void when check and reason are present', () => {
  const rollup = { repos: [{ name: 'repo1', noscanReasons: [{ check: 'beta', reason: 'why' }] }] };
  assert.deepEqual(voidsOf(rollup), [{ lane: "beta", repo: "repo1", reason: "why" }]);
});

test('skips repo void entry when check is missing', () => {
  const rollup = { repos: [{ name: 'repo1', noscanReasons: [{ reason: 'why' }] }] };
  assert.deepEqual(voidsOf(rollup), []);
});

test('skips repo void entry when reason is missing', () => {
  const rollup = { repos: [{ name: 'repo1', noscanReasons: [{ check: 'beta' }] }] };
  assert.deepEqual(voidsOf(rollup), []);
});

test('sorts voids by lane then repo', () => {
  const rollup = {
    scanners: { zeta: { noscan: 1, noscanReason: 'r1' } },
    repos: [
      { name: 'b', noscanReasons: [{ check: 'alpha', reason: 'r2' }] },
      { name: 'a', noscanReasons: [{ check: 'alpha', reason: 'r3' }] }
    ]
  };
  assert.deepEqual(voidsOf(rollup), [{ lane: "alpha", repo: "a", reason: "r3" }, { lane: "alpha", repo: "b", reason: "r2" }, { lane: "zeta", repo: null, reason: "r1" }]);
});

test('uses null for repo name when name is missing', () => {
  const rollup = { repos: [{ noscanReasons: [{ check: 'beta', reason: 'why' }] }] };
  assert.deepEqual(voidsOf(rollup), [{ lane: "beta", repo: null, reason: "why" }]);
});
