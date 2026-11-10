// Validates a tuning request body against profile, depth, intensity, and override rules (admin/routes/perf.mjs validateTuningRequest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTuningRequest } from '../routes/perf.mjs';

const mod = {
  PROFILES: { fast: {}, slow: {} },
  DEPTH_LEVELS: [{ level: 1 }, { level: 2 }, { level: 3 }],
  INTENSITY_LEVELS: [{ level: 4 }, { level: 5 }]
};

test('returns error when body is not an object', () => {
  const result = validateTuningRequest(null, mod);
  assert.deepEqual(result, ['the body must be an object of {profileId, depth, intensity, overrides}']);
});

test('returns error when body is an array', () => {
  const result = validateTuningRequest([], mod);
  assert.deepEqual(result, ['the body must be an object of {profileId, depth, intensity, overrides}']);
});

test('returns error for unknown profileId', () => {
  const body = { profileId: 'unknown', depth: 1, intensity: 4, overrides: {} };
  const result = validateTuningRequest(body, mod);
  assert.equal(result.length, 1);
  assert.match(result[0], /unknown profileId "unknown"/);
});

test('returns error for non-string profileId', () => {
  const body = { profileId: 123, depth: 1, intensity: 4, overrides: {} };
  const result = validateTuningRequest(body, mod);
  assert.equal(result.length, 1);
  assert.match(result[0], /profileId must be one of fast, slow/);
});

test('returns error for non-integer depth', () => {
  const body = { profileId: 'fast', depth: 1.5, intensity: 4, overrides: {} };
  const result = validateTuningRequest(body, mod);
  assert.equal(result.length, 1);
  assert.match(result[0], /depth must be an integer level/);
});

test('returns error for depth not in allowed levels', () => {
  const body = { profileId: 'fast', depth: 5, intensity: 4, overrides: {} };
  const result = validateTuningRequest(body, mod);
  assert.equal(result.length, 1);
  assert.match(result[0], /depth must be one of 1, 2, 3/);
});

test('returns error for intensity not in allowed levels', () => {
  const body = { profileId: 'fast', depth: 1, intensity: 1, overrides: {} };
  const result = validateTuningRequest(body, mod);
  assert.equal(result.length, 1);
  assert.match(result[0], /intensity must be one of 4, 5/);
});

test('returns error for invalid override state', () => {
  const body = { profileId: 'fast', depth: 1, intensity: 4, overrides: { scanner1: 'maybe' } };
  const result = validateTuningRequest(body, mod);
  assert.equal(result.length, 1);
  assert.match(result[0], /overrides\.scanner1 must be exactly "on" or "off"/);
});

test('returns error for invalid scanner id in overrides', () => {
  const body = { profileId: 'fast', depth: 1, intensity: 4, overrides: { 'Invalid ID': 'on' } };
  const result = validateTuningRequest(body, mod);
  assert.equal(result.length, 1);
  assert.match(result[0], /is not a scanner id/);
});

test('returns empty array for valid request', () => {
  const body = { profileId: 'fast', depth: 2, intensity: 5, overrides: { scanner1: 'on', scanner2: 'off' } };
  const result = validateTuningRequest(body, mod);
  assert.deepEqual(result, []);
});
