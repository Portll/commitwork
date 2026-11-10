// Aggregates live token totals and turn counts across session rows (admin/lib/session-view.mjs fleetTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetTokens } from '../lib/session-view.mjs';

test('returns zeroed totals and empty unmeasured for empty rows', () => {
  const result = fleetTokens([]);
  assert.deepEqual(result, {
    totals: { input: null, output: null, cacheRead: null, cacheCreation: null },
    turns: 0,
    measured: 0,
    of: 0,
    unmeasured: [],
  });
});

test('sums live token totals and turns for a single row', () => {
  const rows = [{
    id: 's1',
    tokens: {
      state: 'live',
      totals: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 },
      turns: 3,
    },
  }];
  const result = fleetTokens(rows);
  assert.deepEqual(result.totals, { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 });
  assert.equal(result.turns, 3);
  assert.equal(result.measured, 1);
  assert.equal(result.of, 1);
  assert.deepEqual(result.unmeasured, []);
});

test('excludes rows with non-live token state from measured totals', () => {
  const rows = [
    { id: 's1', tokens: { state: 'live', totals: { input: 10, output: 5, cacheRead: 1, cacheCreation: 2 }, turns: 1 } },
    { id: 's2', tokens: { state: 'stale', totals: { input: 99, output: 99, cacheRead: 99, cacheCreation: 99 }, turns: 99 } },
  ];
  const result = fleetTokens(rows);
  assert.deepEqual(result.totals, { input: 10, output: 5, cacheRead: 1, cacheCreation: 2 });
  assert.equal(result.turns, 1);
  assert.equal(result.measured, 1);
  assert.equal(result.of, 2);
  assert.deepEqual(result.unmeasured, [{ id: 's2', why: 'stale' }]);
});

test('excludes rows without tokens object from measured totals', () => {
  const rows = [
    { id: 's1', tokens: { state: 'live', totals: { input: 20, output: 10, cacheRead: 2, cacheCreation: 1 }, turns: 2 } },
    { id: 's2' },
  ];
  const result = fleetTokens(rows);
  assert.deepEqual(result.totals, { input: 20, output: 10, cacheRead: 2, cacheCreation: 1 });
  assert.equal(result.turns, 2);
  assert.equal(result.measured, 1);
  assert.equal(result.of, 2);
  assert.deepEqual(result.unmeasured, [{ id: 's2', why: 'unknown' }]);
});

test('treats missing totals fields as null and skips them in addition', () => {
  const rows = [
    { id: 's1', tokens: { state: 'live', totals: { input: 100 }, turns: 1 } },
    { id: 's2', tokens: { state: 'live', totals: { output: 50 }, turns: 2 } },
  ];
  const result = fleetTokens(rows);
  assert.deepEqual(result.totals, { input: 100, output: 50, cacheRead: null, cacheCreation: null });
  assert.equal(result.turns, 3);
  assert.equal(result.measured, 2);
  assert.equal(result.of, 2);
  assert.deepEqual(result.unmeasured, []);
});

test('sums across multiple live rows and reports correct denominator', () => {
  const rows = [
    { id: 'a', tokens: { state: 'live', totals: { input: 10, output: 5, cacheRead: 1, cacheCreation: 2 }, turns: 1 } },
    { id: 'b', tokens: { state: 'live', totals: { input: 20, output: 15, cacheRead: 3, cacheCreation: 4 }, turns: 2 } },
    { id: 'c', tokens: { state: 'live', totals: { input: 30, output: 25, cacheRead: 5, cacheCreation: 6 }, turns: 3 } },
  ];
  const result = fleetTokens(rows);
  assert.deepEqual(result.totals, { input: 60, output: 45, cacheRead: 9, cacheCreation: 12 });
  assert.equal(result.turns, 6);
  assert.equal(result.measured, 3);
  assert.equal(result.of, 3);
  assert.deepEqual(result.unmeasured, []);
});

test('reports why for unmeasured rows using tokens.why when present', () => {
  const rows = [
    { id: 's1', tokens: { state: 'live', totals: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }, turns: 1 } },
    { id: 's2', tokens: { state: 'pending', why: 'no data yet' } },
  ];
  const result = fleetTokens(rows);
  assert.equal(result.measured, 1);
  assert.equal(result.of, 2);
  assert.deepEqual(result.unmeasured, [{ id: 's2', why: 'no data yet' }]);
});

test('defaults turns to zero when tokens.turns is missing', () => {
  const rows = [
    { id: 's1', tokens: { state: 'live', totals: { input: 10, output: 5, cacheRead: 1, cacheCreation: 2 } } },
  ];
  const result = fleetTokens(rows);
  assert.equal(result.turns, 0);
  assert.equal(result.measured, 1);
  assert.deepEqual(result.totals, { input: 10, output: 5, cacheRead: 1, cacheCreation: 2 });
});
