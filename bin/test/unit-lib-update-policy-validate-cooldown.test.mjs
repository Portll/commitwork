// Validates that a cooldown value is a number 0-365 or an object with patch/minor/major keys (bin/lib/update-policy.mjs validateCooldown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCooldown } from '../lib/update-policy.mjs';

test('accepts a valid number within range', () => {
  assert.equal(validateCooldown(30), null);
});

test('rejects a number above the maximum', () => {
  assert.equal(validateCooldown(366), "cooldownDays must be 0\u2013365 days");
});

test('rejects a number below the minimum', () => {
  assert.equal(validateCooldown(-1), "cooldownDays must be 0\u2013365 days");
});

test('rejects a non-number primitive', () => {
  assert.equal(validateCooldown('30'), "cooldownDays must be a number of days or { patch, minor, major }");
});

test('rejects an array input', () => {
  assert.equal(validateCooldown([1, 2]), "cooldownDays must be a number of days or { patch, minor, major }");
});

test('rejects an object with unknown keys', () => {
  assert.equal(validateCooldown({ patch: 1, foo: 2 }), "cooldownDays: unknown update type(s) foo");
});

test('rejects an object with an out-of-range value', () => {
  assert.equal(validateCooldown({ patch: 366 }), "cooldownDays: each value must be 0\u2013365 days");
});

test('accepts an object with all valid values', () => {
  assert.equal(validateCooldown({ patch: 1, minor: 2, major: 3 }), null);
});

test('rejects a null input', () => {
  assert.equal(validateCooldown(null), "cooldownDays must be a number of days or { patch, minor, major }");
});

test('rejects an object with a non-number value', () => {
  assert.equal(validateCooldown({ patch: '1' }), "cooldownDays: each value must be 0\u2013365 days");
});
