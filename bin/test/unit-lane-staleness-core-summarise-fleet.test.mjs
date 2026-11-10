// Formats a one-line summary of lane staleness counts (bin/lane-staleness-core.mjs summariseFleet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseFleet } from '../lane-staleness-core.mjs';

test('returns the no-lanes message when total is zero', () => {
  const ro = { total: 0, findings: 0, faults: 0, unknown: 0, producing: 0 };
  const r = summariseFleet(ro);
  assert.equal(r, "no lanes declared \u2014 nothing was checked, which is not a clean result");
});

test('returns the formatted summary when total is one', () => {
  const ro = { total: 1, findings: 0, faults: 0, unknown: 0, producing: 1 };
  const r = summariseFleet(ro);
  assert.equal(r, "1 lane(s): 0 not producing, 0 unreadable, 0 UNKNOWN (neither), 1 producing");
});

test('returns the formatted summary when total is two', () => {
  const ro = { total: 2, findings: 1, faults: 1, unknown: 0, producing: 0 };
  const r = summariseFleet(ro);
  assert.equal(r, "2 lane(s): 1 not producing, 1 unreadable, 0 UNKNOWN (neither), 0 producing");
});

test('returns the formatted summary when total is three', () => {
  const ro = { total: 3, findings: 1, faults: 1, unknown: 1, producing: 0 };
  const r = summariseFleet(ro);
  assert.equal(r, "3 lane(s): 1 not producing, 1 unreadable, 1 UNKNOWN (neither), 0 producing");
});

test('returns the formatted summary when total is four', () => {
  const ro = { total: 4, findings: 2, faults: 1, unknown: 1, producing: 0 };
  const r = summariseFleet(ro);
  assert.equal(r, "4 lane(s): 2 not producing, 1 unreadable, 1 UNKNOWN (neither), 0 producing");
});

test('returns the formatted summary when total is five', () => {
  const ro = { total: 5, findings: 1, faults: 1, unknown: 1, producing: 2 };
  const r = summariseFleet(ro);
  assert.equal(r, "5 lane(s): 1 not producing, 1 unreadable, 1 UNKNOWN (neither), 2 producing");
});
