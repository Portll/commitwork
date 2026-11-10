// Human-readable one-line status for a lane verdict (bin/lane-staleness-core.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../lane-staleness-core.mjs';

test('summarise returns absent message for LANE_ABSENT', () => {
  const r = { name: 'lane-a', verdict: 'lane-absent' };
  assert.equal(summarise(r), "lane-a: absent \u2014 UNKNOWN, not a finding");
});

test('summarise returns unreadable message for LANE_UNREADABLE', () => {
  const r = { name: 'lane-b', verdict: 'lane-unreadable' };
  assert.equal(summarise(r), "lane-b: unreadable \u2014 a fault, not an empty lane");
});

test('summarise returns undatable message for CLOCK_UNREADABLE', () => {
  const r = { name: 'lane-c', verdict: 'clock-unreadable' };
  assert.equal(summarise(r), "lane-c: output undatable \u2014 UNKNOWN, never \"recent\"");
});

test('summarise returns never-produced message for NEVER_PRODUCED', () => {
  const r = { name: 'lane-d', verdict: 'never-produced' };
  assert.equal(summarise(r), "lane-d: has never produced output here");
});

test('summarise returns voids-only message with rows for VOIDS_ONLY', () => {
  const r = { name: 'lane-e', verdict: 'voids-only', rows: 5 };
  assert.equal(summarise(r), "lane-e: 5 run(s), 0 outputs \u2014 running and producing nothing");
});

test('summarise returns cadence-undeclared message with age for CADENCE_UNDECLARED', () => {
  const r = { name: 'lane-f', verdict: 'cadence-undeclared', ageMs: 3600000 };
  assert.equal(summarise(r), "lane-f: last output 1h 0m ago, no cadence declared \u2014 UNKNOWN, not stale");
});

test('summarise returns producing message with age for PRODUCING', () => {
  const r = { name: 'lane-g', verdict: 'producing', ageMs: 60000 };
  assert.equal(summarise(r), "lane-g: producing, last output 1m ago");
});

test('summarise returns stale message with age and overdue for STALE', () => {
  const r = { name: 'lane-h', verdict: 'stale', ageMs: 86400000, overdueMs: 3600000 };
  assert.equal(summarise(r), "lane-h: STALE \u2014 last output 1d 0h ago, overdue by 1h 0m");
});

test('summarise returns fallback message for unknown verdict', () => {
  const r = { name: 'lane-i', verdict: 'mystery' };
  assert.equal(summarise(r), "lane-i: mystery");
});
