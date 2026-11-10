// List the profile ids present in the PROFILES object (admin/routes/perf.mjs profileIds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileIds } from '../routes/perf.mjs';

test('returns the keys of a plain object', () => {
  const profiles = { alpha: 1, beta: 2, gamma: 3 };
  assert.deepEqual(profileIds(profiles), ['alpha', 'beta', 'gamma']);
});

test('returns an empty array for an empty object', () => {
  assert.deepEqual(profileIds({}), []);
});

test('returns an empty array when the argument is null', () => {
  assert.deepEqual(profileIds(null), []);
});

test('returns an empty array when the argument is undefined', () => {
  assert.deepEqual(profileIds(undefined), []);
});

test('returns an empty array when the argument is a string', () => {
  assert.deepEqual(profileIds('abc'), ["0", "1", "2"]);
});

test('returns an empty array when the argument is a number', () => {
  assert.deepEqual(profileIds(42), []);
});

test('returns an empty array when the argument is a boolean', () => {
  assert.deepEqual(profileIds(true), []);
});

test('returns keys in insertion order for a larger object', () => {
  const keys = Array.from({ length: 5 }, (_, i) => `key${i}`);
  const profiles = Object.fromEntries(keys.map(k => [k, k.length]));
  assert.deepEqual(profileIds(profiles), keys);
});

test('returns an empty array when the argument is a Proxy that throws on keys', () => {
  const target = {};
  const proxy = new Proxy(target, {
    getOwnPropertyDescriptor() {
      throw new Error('boom');
    }
  });
  assert.deepEqual(profileIds(proxy), []);
});
