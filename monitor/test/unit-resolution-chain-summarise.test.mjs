// Groups records by repo, counting runs, changes, distinct chains, and sorting by changes then repo (monitor/resolution-chain.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../resolution-chain.mjs';

test('returns an empty array when given no records', () => {
  assert.deepEqual(summarise([]), []);
});

test('aggregates a single record with no changes', () => {
  const rec = { repo: 'alpha', changed: false, chainId: 'c1', reached: 'r1', refused: false, at: 't1' };
  assert.deepEqual(summarise([rec]), [{ repo: "alpha", runs: 1, changes: 0, distinctChains: 1, reached: "r1", refused: false, lastAt: "t1" }]);
});

test('counts multiple runs and changes for the same repo', () => {
  const recs = [
    { repo: 'beta', changed: true, chainId: 'c1', reached: 'r1', refused: false, at: 't1' },
    { repo: 'beta', changed: true, chainId: 'c2', reached: 'r2', refused: true, at: 't2' },
    { repo: 'beta', changed: false, chainId: 'c1', reached: 'r3', refused: false, at: 't3' },
  ];
  assert.deepEqual(summarise(recs), [{ repo: "beta", runs: 3, changes: 2, distinctChains: 2, reached: "r3", refused: false, lastAt: "t3" }]);
});

test('sorts repos with equal changes alphabetically ascending', () => {
  const recs = [
    { repo: 'zeta', changed: false, chainId: 'c1', reached: 'r1', refused: false, at: 't1' },
    { repo: 'alpha', changed: false, chainId: 'c2', reached: 'r2', refused: false, at: 't2' },
    { repo: 'mid', changed: false, chainId: 'c3', reached: 'r3', refused: false, at: 't3' },
  ];
  assert.deepEqual(summarise(recs), [{ repo: "alpha", runs: 1, changes: 0, distinctChains: 1, reached: "r2", refused: false, lastAt: "t2" }, { repo: "mid", runs: 1, changes: 0, distinctChains: 1, reached: "r3", refused: false, lastAt: "t3" }, { repo: "zeta", runs: 1, changes: 0, distinctChains: 1, reached: "r1", refused: false, lastAt: "t1" }]);
});

test('sorts repos with different changes by count descending', () => {
  const recs = [
    { repo: 'low', changed: false, chainId: 'c1', reached: 'r1', refused: false, at: 't1' },
    { repo: 'high', changed: true, chainId: 'c2', reached: 'r2', refused: false, at: 't2' },
    { repo: 'mid', changed: true, chainId: 'c3', reached: 'r3', refused: false, at: 't3' },
    { repo: 'mid', changed: true, chainId: 'c4', reached: 'r4', refused: false, at: 't4' },
  ];
  assert.deepEqual(summarise(recs), [{ repo: "mid", runs: 2, changes: 2, distinctChains: 2, reached: "r4", refused: false, lastAt: "t4" }, { repo: "high", runs: 1, changes: 1, distinctChains: 1, reached: "r2", refused: false, lastAt: "t2" }, { repo: "low", runs: 1, changes: 0, distinctChains: 1, reached: "r1", refused: false, lastAt: "t1" }]);
});

test('handles repos with zero changes alongside those with changes', () => {
  const recs = [
    { repo: 'none', changed: false, chainId: 'c1', reached: 'r1', refused: false, at: 't1' },
    { repo: 'some', changed: true, chainId: 'c2', reached: 'r2', refused: false, at: 't2' },
  ];
  assert.deepEqual(summarise(recs), [{ repo: "some", runs: 1, changes: 1, distinctChains: 1, reached: "r2", refused: false, lastAt: "t2" }, { repo: "none", runs: 1, changes: 0, distinctChains: 1, reached: "r1", refused: false, lastAt: "t1" }]);
});

test('tracks distinct chains when the same chain id repeats', () => {
  const recs = [
    { repo: 'dup', changed: false, chainId: 'same', reached: 'r1', refused: false, at: 't1' },
    { repo: 'dup', changed: false, chainId: 'same', reached: 'r2', refused: false, at: 't2' },
    { repo: 'dup', changed: false, chainId: 'other', reached: 'r3', refused: false, at: 't3' },
  ];
  assert.deepEqual(summarise(recs), [{ repo: "dup", runs: 3, changes: 0, distinctChains: 2, reached: "r3", refused: false, lastAt: "t3" }]);
});

test('uses the last record for reached, refused, and lastAt fields', () => {
  const recs = [
    { repo: 'seq', changed: false, chainId: 'c1', reached: 'first', refused: false, at: 'early' },
    { repo: 'seq', changed: true, chainId: 'c2', reached: 'last', refused: true, at: 'late' },
  ];
  assert.deepEqual(summarise(recs), [{ repo: "seq", runs: 2, changes: 1, distinctChains: 2, reached: "last", refused: true, lastAt: "late" }]);
});
