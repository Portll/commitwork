// Formats a duration in milliseconds as a human readable age string (bin/lane-staleness-core.mjs humanAge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanAge } from '../lane-staleness-core.mjs';

test('returns unknown for non-finite input', () => {
  assert.equal(humanAge(NaN), "unknown");
});

test('returns the formatted age for a positive duration with days', () => {
  assert.equal(humanAge(90061000), "1d 1h");
});

test('returns the formatted age for a negative duration with days', () => {
  assert.equal(humanAge(-90061000), "-1d 1h");
});

test('returns the formatted age for a duration with hours but no days', () => {
  assert.equal(humanAge(3661000), "1h 1m");
});

test('returns the formatted age for a duration with minutes but no hours', () => {
  assert.equal(humanAge(61000), "1m");
});

test('returns the formatted age for zero milliseconds', () => {
  assert.equal(humanAge(0), "0m");
});

test('returns the formatted age for one day exactly', () => {
  assert.equal(humanAge(86400000), "1d 0h");
});

test('returns the formatted age for one hour exactly', () => {
  assert.equal(humanAge(3600000), "1h 0m");
});
