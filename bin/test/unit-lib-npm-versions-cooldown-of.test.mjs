// Computes per-version cooldown days from a number or partial object (bin/lib/npm-versions.mjs cooldownOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cooldownOf } from '../lib/npm-versions.mjs';

test('returns uniform object when given a number', () => {
  assert.deepEqual(cooldownOf(3), { patch: 3, minor: 3, major: 3 });
});

test('returns default object when given null', () => {
  assert.deepEqual(cooldownOf(null), { patch: 7, minor: 7, major: 7 });
});

test('returns default object when given undefined', () => {
  assert.deepEqual(cooldownOf(undefined), { patch: 7, minor: 7, major: 7 });
});

test('returns default object when given empty object', () => {
  assert.deepEqual(cooldownOf({}), { patch: 7, minor: 7, major: 7 });
});

test('merges partial object with defaults', () => {
  assert.deepEqual(cooldownOf({ patch: 1 }), { patch: 1, minor: 7, major: 7 });
});

test('returns default object when given string', () => {
  assert.deepEqual(cooldownOf('x'), { patch: 7, minor: 7, major: 7 });
});

test('returns default object when given boolean true', () => {
  assert.deepEqual(cooldownOf(true), { patch: 7, minor: 7, major: 7 });
});

test('returns default object when given boolean false', () => {
  assert.deepEqual(cooldownOf(false), { patch: 7, minor: 7, major: 7 });
});
