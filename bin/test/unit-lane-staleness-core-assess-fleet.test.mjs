// Assessed lanes sorted by display rank then name, plus verdict rollup counts (bin/lane-staleness-core.mjs assessFleet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFleet } from '../lane-staleness-core.mjs';

const VERDICTS = ['stale', 'voids-only', 'never-produced', 'lane-unreadable', 'clock-unreadable', 'cadence-undeclared', 'lane-absent', 'producing'];
const counts = (over) => Object.fromEntries(VERDICTS.map((v) => [v, over[v] ?? 0]));
const pairs = (r) => r.lanes.map((l) => [l.name, l.verdict]);
const preassessed = (items) => ({ map: () => items.map((i) => ({ ...i })) });

test('an empty fleet yields no lanes and an all-zero rollup', () => {
  assert.deepEqual(assessFleet({ lanes: [], now: 0 }), {
    lanes: [],
    rollup: { total: 0, producing: 0, findings: 0, faults: 0, unknown: 0, byVerdict: counts({}) },
  });
});

test('omitting lanes behaves exactly like an empty fleet', () => {
  assert.deepEqual(assessFleet({ now: 0 }), {
    lanes: [],
    rollup: { total: 0, producing: 0, findings: 0, faults: 0, unknown: 0, byVerdict: counts({}) },
  });
});

test('a present lane without samples is reported as an unreadable grey fault that does not block', () => {
  const r = assessFleet({ lanes: [{ name: 'a', verdict: 'producing' }], now: 0 });
  assert.deepEqual(r.lanes.map((l) => [l.name, l.verdict, l.fault, l.grey, l.block, l.reasons]), [
    ['a', 'lane-unreadable', true, true, false, []],
  ]);
  assert.deepEqual(r.rollup, {
    total: 1, producing: 0, findings: 0, faults: 1, unknown: 0, byVerdict: counts({ 'lane-unreadable': 1 }),
  });
});

test('lanes of equal rank are ordered by name ascending regardless of input order', () => {
  const r = assessFleet({ lanes: [{ name: 'b' }, { name: 'a' }], now: 0 });
  assert.deepEqual(pairs(r), [['a', 'lane-unreadable'], ['b', 'lane-unreadable']]);
});

test('name ties are broken with locale collation rather than code points', () => {
  const r = assessFleet({ lanes: [{ name: 'b' }, { name: 'B' }, { name: 'a' }], now: 0 });
  assert.deepEqual(r.lanes.map((l) => l.name), ['a', 'b', 'B']);
});

test('lanes with equal rank and equal name keep their input order', () => {
  const r = assessFleet({ lanes: [{ name: 'x', kind: 'first' }, { name: 'x', kind: 'second' }], now: 0 });
  assert.deepEqual(r.lanes.map((l) => [l.name, l.kind]), [['x', 'first'], ['x', 'second']]);
});

test('a higher-ranked verdict sorts first even when its name sorts last', () => {
  const r = assessFleet({ lanes: [{ name: 'a', present: false }, { name: 'z' }], now: 0 });
  assert.deepEqual(pairs(r), [['z', 'lane-unreadable'], ['a', 'lane-absent']]);
  assert.deepEqual(r.rollup, {
    total: 2, producing: 0, findings: 0, faults: 1, unknown: 1,
    byVerdict: counts({ 'lane-unreadable': 1, 'lane-absent': 1 }),
  });
});

test('rollup counts every unreadable lane as a fault and none as findings', () => {
  const names = Array.from({ length: 3 }, (_, i) => 'lane' + (3 - i));
  const r = assessFleet({ lanes: names.map((name) => ({ name })), now: 0 });
  assert.deepEqual(r.lanes.map((l) => l.name), ['lane1', 'lane2', 'lane3']);
  assert.deepEqual(r.rollup, {
    total: 3, producing: 0, findings: 0, faults: 3, unknown: 0, byVerdict: counts({ 'lane-unreadable': 3 }),
  });
});

test('an unranked verdict listed before a producing lane ties at rank zero and is reordered by name', () => {
  const lanes = preassessed([{ name: 'z', verdict: 'mystery' }, { name: 'a', verdict: 'producing' }]);
  const r = assessFleet({ lanes, now: 0 });
  assert.deepEqual(pairs(r), [['a', 'producing'], ['z', 'mystery']]);
  assert.deepEqual(r.rollup, {
    total: 2, producing: 1, findings: 0, faults: 0, unknown: 0, byVerdict: counts({ producing: 1 }),
  });
});

test('an unranked verdict listed after a producing lane ties at rank zero and stays after it by name', () => {
  const lanes = preassessed([{ name: 'a', verdict: 'producing' }, { name: 'z', verdict: 'mystery' }]);
  const r = assessFleet({ lanes, now: 0 });
  assert.deepEqual(pairs(r), [['a', 'producing'], ['z', 'mystery']]);
  assert.deepEqual(r.rollup, {
    total: 2, producing: 1, findings: 0, faults: 0, unknown: 0, byVerdict: counts({ producing: 1 }),
  });
});
