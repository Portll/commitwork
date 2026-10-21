// One-line human summary of a freshness record (monitor/freshness.mjs freshnessSummary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessSummary } from '../freshness.mjs';

test('returns unknown message when state is unknown', () => {
  const f = { state: 'unknown' };
  assert.equal(freshnessSummary(f), 'freshness unknown \u2014 no generation timestamp');
});

test('returns paused message without age when ageHours is null', () => {
  const f = { state: 'paused', ageHours: null };
  assert.equal(freshnessSummary(f), 'PAUSED \u2014 not swept by declaration');
});

test('returns paused message with age when ageHours is a number', () => {
  const f = { state: 'paused', ageHours: 12 };
  assert.equal(freshnessSummary(f), 'PAUSED \u2014 not swept by declaration; last scan 12h ago');
});

test('returns fresh message with age', () => {
  const f = { state: 'fresh', ageHours: 2 };
  assert.equal(freshnessSummary(f), 'fresh (2h old)');
});

test('returns stale message with age', () => {
  const f = { state: 'stale', ageHours: 25 };
  assert.equal(freshnessSummary(f), 'STALE (25h old) \u2014 a scheduled sweep may have been missed');
});

test('returns expired message for any other state', () => {
  const f = { state: 'expired', ageHours: 100 };
  assert.equal(freshnessSummary(f), 'EXPIRED (100h old) \u2014 the sweep has not run; this result is not current');
});

test('returns expired message for unrecognized state value', () => {
  const f = { state: 'weird', ageHours: 5 };
  assert.equal(freshnessSummary(f), 'EXPIRED (5h old) \u2014 the sweep has not run; this result is not current');
});
