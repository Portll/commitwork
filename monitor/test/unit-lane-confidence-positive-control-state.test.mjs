// Determines if a positive control is absent, missed, stale, or current (monitor/lane-confidence.mjs positiveControlState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positiveControlState } from '../lane-confidence.mjs';

test('returns absent when control is null', () => {
  const r = positiveControlState(null);
  assert.equal(r, "absent");
});

test('returns absent when control.outcome is "not-run"', () => {
  const r = positiveControlState({ outcome: 'not-run' });
  assert.equal(r, "absent");
});

test('does not return absent when control exists and outcome is not "not-run"', () => {
  const r = positiveControlState({ outcome: 'detected', ranAt: '2024-01-01T00:00:00Z' }, { now: '2024-01-02T00:00:00Z', maxAgeDays: 10 });
  assert.equal(r, "current");
});

test('returns missed when outcome is "missed"', () => {
  const r = positiveControlState({ outcome: 'missed' });
  assert.equal(r, "missed");
});

test('throws error for unknown outcome', () => {
  assert.throws(
    () => positiveControlState({ outcome: 'unknown' }),
    { name: 'Error', message: "'unknown' is not a positive-control outcome" }
  );
});

test('returns stale when outcome is "detected" but ranAt is missing', () => {
  const r = positiveControlState({ outcome: 'detected' });
  assert.equal(r, "stale");
});

test('returns stale when ranAt is unparsable', () => {
  assert.throws(
    () => positiveControlState({ outcome: 'detected', ranAt: 'not-a-date' }),
    { name: 'RangeError', message: 'positive control ranAt is not a parseable timestamp: "not-a-date"' }
  );
});

test('throws when now option is unparsable', () => {
  assert.throws(
    () => positiveControlState({ outcome: 'detected', ranAt: '2024-01-01T00:00:00Z' }, { now: 'bad-now' }),
    { name: 'RangeError', message: 'now is not a parseable timestamp: "bad-now"' }
  );
});

test('returns current when age is less than maxAgeDays', () => {
  const r = positiveControlState(
    { outcome: 'detected', ranAt: '2024-01-01T00:00:00Z' },
    { now: '2024-01-05T00:00:00Z', maxAgeDays: 10 }
  );
  assert.equal(r, "current");
});

test('returns stale when age exceeds maxAgeDays', () => {
  const r = positiveControlState(
    { outcome: 'detected', ranAt: '2024-01-01T00:00:00Z' },
    { now: '2024-02-15T00:00:00Z', maxAgeDays: 30 }
  );
  assert.equal(r, "stale");
});

test('returns current when age equals maxAgeDays (boundary < comparison)', () => {
  const r = positiveControlState(
    { outcome: 'detected', ranAt: '2024-01-01T00:00:00Z' },
    { now: '2024-01-31T00:00:00Z', maxAgeDays: 30 }
  );
  assert.equal(r, "current");
});

test('returns stale when age is just over maxAgeDays (boundary > comparison)', () => {
  const r = positiveControlState(
    { outcome: 'detected', ranAt: '2024-01-01T00:00:00Z' },
    { now: '2024-02-01T00:00:01Z', maxAgeDays: 30 }
  );
  assert.equal(r, "stale");
});
