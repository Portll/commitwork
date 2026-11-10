// Extracts a key=value pair from config text, handling quotes and comments (lib/secrets.mjs valueFromConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueFromConfig } from '../secrets.mjs';

test('returns null when the key is not present in the text', () => {
  const r = valueFromConfig('foo=bar\nbaz=qux', 'missing');
  assert.equal(r, null);
});

test('returns the unquoted value when the key is present without quotes', () => {
  const r = valueFromConfig('  key = hello world  ', 'key');
  assert.equal(r, "hello world");
});

test('returns the inner content when the value is double-quoted', () => {
  const r = valueFromConfig('key = "hello world"', 'key');
  assert.equal(r, "hello world");
});

test('returns the inner content when the value is single-quoted', () => {
  const r = valueFromConfig("key = 'hello world'", 'key');
  assert.equal(r, "hello world");
});

test('strips a trailing hash comment from an unquoted value', () => {
  const r = valueFromConfig('key = value # comment', 'key');
  assert.equal(r, "value");
});

test('strips a trailing semicolon comment from an unquoted value', () => {
  const r = valueFromConfig('key = value ; comment', 'key');
  assert.equal(r, "value");
});

test('returns the quoted content even if it contains a hash', () => {
  const r = valueFromConfig('key = "value # not a comment"', 'key');
  assert.equal(r, "value # not a comment");
});

test('returns null when the key appears but with no equals sign', () => {
  const r = valueFromConfig('key without equals', 'key');
  assert.equal(r, null);
});
