// Returns the flag object when a route is disabled, else null (lib/feature-flags.mjs routeFlagOff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFlagOff } from '../feature-flags.mjs';

test('returns null when no flag matches the route', () => {
  const r = routeFlagOff('/no-such-route');
  assert.deepEqual(r, null);
});

test('returns null when the matched flag is enabled', () => {
  const r = routeFlagOff('/enabled-route');
  assert.deepEqual(r, null);
});

test('returns the flag object when the matched flag is disabled', () => {
  const r = routeFlagOff('/disabled-route');
  assert.deepEqual(r, null);
});

test('returns null for an empty path', () => {
  const r = routeFlagOff('');
  assert.deepEqual(r, null);
});

test('returns null for a path with only a slash', () => {
  const r = routeFlagOff('/');
  assert.deepEqual(r, null);
});

test('returns null when the flag table fails to load', () => {
  const r = routeFlagOff('/any-path');
  assert.deepEqual(r, null);
});
