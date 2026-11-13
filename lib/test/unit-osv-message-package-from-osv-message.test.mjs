// extracts package name and version from OSV message (lib/osv-message.mjs packageFromOsvMessage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageFromOsvMessage } from '../osv-message.mjs';

test('returns null when input is not a string', () => {
  const input = 123;
  const result = packageFromOsvMessage(input);
  assert.equal(result, null);
});

test('returns null when message does not contain a package pattern', () => {
  const input = "No package here";
  const result = packageFromOsvMessage(input);
  assert.equal(result, null);
});

test('returns null when quoted part lacks an @ character', () => {
  const input = "Package 'foobar' is vulnerable";
  const result = packageFromOsvMessage(input);
  assert.equal(result, null);
});

test('returns null when @ is the first character in quoted part', () => {
  const input = "Package '@1.2.3' is vulnerable";
  const result = packageFromOsvMessage(input);
  assert.equal(result, null);
});

test('returns object with name and version for a normal package string', () => {
  const input = "Package 'lodash@4.17.21' has a known issue";
  const result = packageFromOsvMessage(input);
  assert.deepEqual(result, { name: "lodash", version: "4.17.21" });
});

test('returns null when name part before @ is empty', () => {
  const input = "Package '@2.0.0' is vulnerable";
  const result = packageFromOsvMessage(input);
  assert.equal(result, null);
});

test('returns null when version part after @ is empty', () => {
  const input = "Package 'express@' is vulnerable";
  const result = packageFromOsvMessage(input);
  assert.equal(result, null);
});

test('returns object when @ appears after first character', () => {
  const input = "Package 'a@1.0.0' is vulnerable";
  const result = packageFromOsvMessage(input);
  assert.deepEqual(result, { name: "a", version: "1.0.0" });
});

test('keeps an npm scope by splitting at the last @', () => {
  const input = "Package '@scope/pkg@1.2.3' is vulnerable";
  const result = packageFromOsvMessage(input);
  assert.deepEqual(result, { name: '@scope/pkg', version: '1.2.3' });
});

test('returns null for a non-string whose string form is a valid message', () => {
  const input = { toString: () => "Package 'lodash@4.17.21' has a known issue" };
  const result = packageFromOsvMessage(input);
  assert.equal(result, null);
});
