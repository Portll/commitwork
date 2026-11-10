// Maps a verification verdict to a severity label (monitor/secret-verify.mjs severityFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { severityFor } from '../secret-verify.mjs';

test('returns crit when verified is true', () => {
  assert.equal(severityFor(true), "crit");
});

test('returns low when verified is false', () => {
  assert.equal(severityFor(false), "low");
});

test('returns null when verified is null', () => {
  assert.equal(severityFor(null), null);
});

test('returns null when verified is undefined', () => {
  assert.equal(severityFor(undefined), null);
});

test('returns null when verified is 0', () => {
  assert.equal(severityFor(0), null);
});

test('returns null when verified is 1', () => {
  assert.equal(severityFor(1), null);
});

test('returns null when verified is an empty string', () => {
  assert.equal(severityFor(''), null);
});

test('returns null when verified is an empty object', () => {
  assert.equal(severityFor({}), null);
});
