// Detects whether an unquoted assignment value is a credential reference rather than a literal secret. (bin/secrets-sweep.mjs isBinding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBinding } from '../secrets-sweep.mjs';

test('returns false when the value is quoted', () => {
  assert.equal(isBinding('abc', true), false);
});

test('returns true for a member expression value', () => {
  assert.equal(isBinding('body.password', false), true);
});

test('returns true for an uppercase env name value', () => {
  assert.equal(isBinding('CW_TEST_TOKEN', false), true);
});

test('returns true for a bare identifier without digits', () => {
  assert.equal(isBinding('password', false), true);
});

test('returns false for a bare identifier containing digits', () => {
  assert.equal(isBinding('token123', false), false);
});

test('returns false for a value that matches no pattern', () => {
  assert.equal(isBinding('12345', false), false);
});

test('returns false for a bare identifier containing only zero', () => {
  assert.equal(isBinding('a0', false), false);
});

test('returns false for a bare identifier containing one', () => {
  assert.equal(isBinding('a1', false), false);
});
