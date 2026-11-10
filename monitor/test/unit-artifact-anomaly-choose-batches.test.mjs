// The rank-th newest batch entry for each repo, newest first by batch name (monitor/artifact-anomaly.mjs chooseBatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseBatches } from '../artifact-anomaly.mjs';

test('returns an empty array when repoDirs is null or undefined', () => {
  assert.deepEqual(chooseBatches(null), []);
  assert.deepEqual(chooseBatches(undefined), []);
  assert.deepEqual(chooseBatches(), []);
  assert.deepEqual(chooseBatches([]), []);
});

test('returns the only entry of a single repo at the default rank', () => {
  const e = { repo: 'alpha', batch: '2026-03-01' };
  assert.deepEqual(chooseBatches([e]), [{ repo: 'alpha', batch: '2026-03-01' }]);
  assert.deepEqual(chooseBatches([e], 0), [{ repo: 'alpha', batch: '2026-03-01' }]);
});

test('returns nothing for a repo that has no entry at the requested rank', () => {
  const e = { repo: 'alpha', batch: '2026-03-01' };
  assert.deepEqual(chooseBatches([e], 1), []);
  assert.deepEqual(chooseBatches([e], 2), []);
});

test('orders batches newest first and picks the entry at each rank', () => {
  const input = ['2026-01-02', '2026-01-10', '2026-01-03'].map((batch) => ({ repo: 'r', batch }));
  assert.deepEqual(chooseBatches(input), [{ repo: 'r', batch: '2026-01-10' }]);
  assert.deepEqual(chooseBatches(input, 1), [{ repo: 'r', batch: '2026-01-03' }]);
  assert.deepEqual(chooseBatches(input, 2), [{ repo: 'r', batch: '2026-01-02' }]);
  assert.deepEqual(chooseBatches(input, 3), []);
});

test('puts the greater of two adjacent batch names first whatever the input order', () => {
  const older = { repo: 'r', batch: 'b1' };
  const newer = { repo: 'r', batch: 'b2' };
  assert.deepEqual(chooseBatches([older, newer]), [{ repo: 'r', batch: 'b2' }]);
  assert.deepEqual(chooseBatches([newer, older]), [{ repo: 'r', batch: 'b2' }]);
  assert.deepEqual(chooseBatches([older, newer], 1), [{ repo: 'r', batch: 'b1' }]);
  assert.deepEqual(chooseBatches([newer, older], 1), [{ repo: 'r', batch: 'b1' }]);
});

test('ranks a bare directory with an empty batch name below a named batch', () => {
  const input = [{ repo: 'r', batch: '' }, { repo: 'r', batch: '0' }];
  assert.deepEqual(chooseBatches(input), [{ repo: 'r', batch: '0' }]);
  assert.deepEqual(chooseBatches(input, 1), [{ repo: 'r', batch: '' }]);
});

test('returns one entry per repo in order of first appearance and skips repos too short for the rank', () => {
  const input = [
    { repo: 'beta', batch: 'b1' },
    { repo: 'alpha', batch: 'b2' },
    { repo: 'beta', batch: 'b3' },
    { repo: 'alpha', batch: 'b1' },
    { repo: 'gamma', batch: 'b9' },
  ];
  assert.deepEqual(chooseBatches(input), [
    { repo: 'beta', batch: 'b3' },
    { repo: 'alpha', batch: 'b2' },
    { repo: 'gamma', batch: 'b9' },
  ]);
  assert.deepEqual(chooseBatches(input, 1), [
    { repo: 'beta', batch: 'b1' },
    { repo: 'alpha', batch: 'b1' },
  ]);
});

test('keeps input order between entries that share a batch name', () => {
  const pair = [{ repo: 'r', batch: 'b5', id: 1 }, { repo: 'r', batch: 'b5', id: 2 }];
  assert.deepEqual(chooseBatches(pair), [{ repo: 'r', batch: 'b5', id: 1 }]);
  assert.deepEqual(chooseBatches(pair, 1), [{ repo: 'r', batch: 'b5', id: 2 }]);
  const triple = [
    { repo: 'r', batch: 'b5', id: 1 },
    { repo: 'r', batch: 'b6', id: 3 },
    { repo: 'r', batch: 'b5', id: 2 },
  ];
  assert.deepEqual(chooseBatches(triple), [{ repo: 'r', batch: 'b6', id: 3 }]);
  assert.deepEqual(chooseBatches(triple, 1), [{ repo: 'r', batch: 'b5', id: 1 }]);
  assert.deepEqual(chooseBatches(triple, 2), [{ repo: 'r', batch: 'b5', id: 2 }]);
});

test('checks both less-than and greater-than before treating two batch names as equal', () => {
  const log = [];
  const make = (id) => ({
    repo: 'r',
    id,
    get batch() {
      log.push(id);
      return 'b5';
    },
  });
  const p = make('p');
  const q = make('q');
  const r = chooseBatches([p, q]);
  assert.deepEqual(log, ['q', 'p', 'q', 'p']);
  assert.deepEqual(r.map((e) => e.id), ['p']);
  assert.equal(r[0], p);
});
