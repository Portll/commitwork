// Normalizes a version string into an array of alphanumeric segments (bin/lib/wordpress.mjs canonVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonVersion } from '../lib/wordpress.mjs';

test('returns an empty array for an empty string', () => {
  assert.deepEqual(canonVersion(''), []);
});

test('returns a single segment for a plain numeric version', () => {
  assert.deepEqual(canonVersion('1.2.3'), ["1", "2", "3"]);
});

test('splits on a leading non-alphanumeric character', () => {
  assert.deepEqual(canonVersion('-1.2.3'), ["1", "2", "3"]);
});

test('splits on a trailing non-alphanumeric character', () => {
  assert.deepEqual(canonVersion('1.2.3-'), ["1", "2", "3"]);
});

test('splits on a non-alphanumeric character between digits and letters', () => {
  assert.deepEqual(canonVersion('1.2.3a'), ["1", "2", "3", "a"]);
});

test('splits on a non-alphanumeric character between letters and digits', () => {
  assert.deepEqual(canonVersion('1.2.3a1'), ["1", "2", "3", "a", "1"]);
});

test('splits on a non-alphanumeric character between digits and digits', () => {
  assert.deepEqual(canonVersion('1.2.31'), ["1", "2", "31"]);
});

test('splits on a non-alphanumeric character between letters and letters', () => {
  assert.deepEqual(canonVersion('1.2.3ab'), ["1", "2", "3", "ab"]);
});
