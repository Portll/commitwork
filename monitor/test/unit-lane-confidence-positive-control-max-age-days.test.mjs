// Computes the positive control max age in days from env (monitor/lane-confidence.mjs positiveControlMaxAgeDays).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positiveControlMaxAgeDays } from '../lane-confidence.mjs';

test('returns 30 when CW_POSITIVE_CONTROL_MAX_AGE_DAYS is undefined', () => {
  const r = positiveControlMaxAgeDays({});
  assert.equal(r, 30);
});

test('returns 30 when CW_POSITIVE_CONTROL_MAX_AGE_DAYS is an empty string', () => {
  const r = positiveControlMaxAgeDays({ CW_POSITIVE_CONTROL_MAX_AGE_DAYS: '' });
  assert.equal(r, 30);
});

test('returns 45 when CW_POSITIVE_CONTROL_MAX_AGE_DAYS is "45"', () => {
  const r = positiveControlMaxAgeDays({ CW_POSITIVE_CONTROL_MAX_AGE_DAYS: '45' });
  assert.equal(r, 45);
});

test('returns 0 when CW_POSITIVE_CONTROL_MAX_AGE_DAYS is "0"', () => {
  const r = positiveControlMaxAgeDays({ CW_POSITIVE_CONTROL_MAX_AGE_DAYS: '0' });
  assert.equal(r, 0);
});

test('returns 1 when CW_POSITIVE_CONTROL_MAX_AGE_DAYS is "1"', () => {
  const r = positiveControlMaxAgeDays({ CW_POSITIVE_CONTROL_MAX_AGE_DAYS: '1' });
  assert.equal(r, 1);
});

test('throws RangeError when CW_POSITIVE_CONTROL_MAX_AGE_DAYS is "-1"', () => {
  assert.throws(
    () => positiveControlMaxAgeDays({ CW_POSITIVE_CONTROL_MAX_AGE_DAYS: '-1' }),
    { name: "RangeError", message: "CW_POSITIVE_CONTROL_MAX_AGE_DAYS=\"-1\" is not a number of days" }
  );
});

test('throws RangeError when CW_POSITIVE_CONTROL_MAX_AGE_DAYS is "abc"', () => {
  assert.throws(
    () => positiveControlMaxAgeDays({ CW_POSITIVE_CONTROL_MAX_AGE_DAYS: 'abc' }),
    { name: "RangeError", message: "CW_POSITIVE_CONTROL_MAX_AGE_DAYS=\"abc\" is not a number of days" }
  );
});

test('throws RangeError when CW_POSITIVE_CONTROL_MAX_AGE_DAYS is "Infinity"', () => {
  assert.throws(
    () => positiveControlMaxAgeDays({ CW_POSITIVE_CONTROL_MAX_AGE_DAYS: 'Infinity' }),
    { name: "RangeError", message: "CW_POSITIVE_CONTROL_MAX_AGE_DAYS=\"Infinity\" is not a number of days" }
  );
});
