// Converts a string to a lowercase alphanumeric slug with hyphens (cra/lib.mjs slugify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../lib.mjs';

test('lowercases letters and replaces non-alphanumeric runs with a single hyphen', () => {
  assert.equal(slugify('Hello, World!'), "hello-world");
});

test('strips leading and trailing hyphens produced by edge punctuation', () => {
  assert.equal(slugify('  Foo  '), "foo");
});

test('collapses consecutive digits and letters into a single hyphen segment', () => {
  assert.equal(slugify('a1b2c3'), "a1b2c3");
});

test('returns an empty string when the input is only punctuation', () => {
  assert.equal(slugify('!!!'), "");
});

test('preserves the digit 1 inside a mixed alphanumeric token', () => {
  assert.equal(slugify('a1b'), "a1b");
});

test('preserves the digit 2 inside a mixed alphanumeric token', () => {
  assert.equal(slugify('a2b'), "a2b");
});

test('preserves the digit 9 inside a mixed alphanumeric token', () => {
  assert.equal(slugify('a9b'), "a9b");
});

test('handles a long repeated pattern with embedded digits', () => {
  const s = 'x1'.repeat(50);
  assert.equal(slugify(s), "x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1");
});
