// Computes the timestamp of the earliest consecutive 'worse' record with identical metrics and baseline (bin/gate-ratchet-core.mjs standingSince).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standingSince } from '../gate-ratchet-core.mjs';

test('returns null when records is empty', () => {
  const r = standingSince([], { m: 1 }, { m: 1 }, ['m']);
  assert.equal(r, null);
});

test('returns null when the most recent record is not worse', () => {
  const records = [
    { verdict: 'worse', at: 't1', metrics: { m: 1 }, baseline: { m: 1 } },
    { verdict: 'better', at: 't2', metrics: { m: 1 }, baseline: { m: 1 } }
  ];
  const r = standingSince(records, { m: 1 }, { m: 1 }, ['m']);
  assert.equal(r, null);
});

test('returns the timestamp of the earliest worse record when all match', () => {
  const records = [
    { verdict: 'worse', at: 't1', metrics: { m: 1 }, baseline: { m: 1 } },
    { verdict: 'worse', at: 't2', metrics: { m: 1 }, baseline: { m: 1 } },
    { verdict: 'worse', at: 't3', metrics: { m: 1 }, baseline: { m: 1 } }
  ];
  const r = standingSince(records, { m: 1 }, { m: 1 }, ['m']);
  assert.equal(r, "t1");
});

test('returns null when the most recent record has different metrics', () => {
  const records = [
    { verdict: 'worse', at: 't1', metrics: { m: 1 }, baseline: { m: 1 } },
    { verdict: 'worse', at: 't2', metrics: { m: 2 }, baseline: { m: 1 } }
  ];
  const r = standingSince(records, { m: 1 }, { m: 1 }, ['m']);
  assert.equal(r, null);
});

test('returns null when the most recent record has different baseline', () => {
  const records = [
    { verdict: 'worse', at: 't1', metrics: { m: 1 }, baseline: { m: 1 } },
    { verdict: 'worse', at: 't2', metrics: { m: 1 }, baseline: { m: 2 } }
  ];
  const r = standingSince(records, { m: 1 }, { m: 1 }, ['m']);
  assert.equal(r, null);
});

test('returns the timestamp of the first record when only it matches and is worse', () => {
  const records = [
    { verdict: 'worse', at: 't1', metrics: { m: 1 }, baseline: { m: 1 } },
    { verdict: 'worse', at: 't2', metrics: { m: 2 }, baseline: { m: 1 } }
  ];
  const r = standingSince(records, { m: 1 }, { m: 1 }, ['m']);
  assert.equal(r, null);
});

test('returns null when a middle record breaks the consecutive worse chain', () => {
  const records = [
    { verdict: 'worse', at: 't1', metrics: { m: 1 }, baseline: { m: 1 } },
    { verdict: 'better', at: 't2', metrics: { m: 1 }, baseline: { m: 1 } },
    { verdict: 'worse', at: 't3', metrics: { m: 1 }, baseline: { m: 1 } }
  ];
  const r = standingSince(records, { m: 1 }, { m: 1 }, ['m']);
  assert.equal(r, "t3");
});

test('returns null when the most recent record is null', () => {
  const records = [
    { verdict: 'worse', at: 't1', metrics: { m: 1 }, baseline: { m: 1 } },
    null
  ];
  const r = standingSince(records, { m: 1 }, { m: 1 }, ['m']);
  assert.equal(r, null);
});
