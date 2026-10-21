// Replaces external repository names with their tokens (lib/external-write.mjs redactExternal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactExternal } from '../external-write.mjs';

test('throws TypeError when input is not a string', () => {
  assert.throws(() => redactExternal(123, []), TypeError);
  assert.throws(() => redactExternal(null, []), TypeError);
  assert.throws(() => redactExternal(undefined, []), TypeError);
});

test('returns text unchanged when entries is empty', () => {
  assert.equal(redactExternal('hello world', []), 'hello world');
});

test('replaces exact name match with token', () => {
  const result = redactExternal('acme-labs', [['acme-labs', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('replaces name with different separators', () => {
  const result = redactExternal('acme_labs', [['acme-labs', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('replaces name with no separators', () => {
  const result = redactExternal('acmelabs', [['acme-labs', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('widens match to include adjacent alphanumeric characters', () => {
  const result = redactExternal('XACME', [['ACME', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('widens match to include adjacent digits', () => {
  const result = redactExternal('ACME123', [['ACME', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('widens match to include adjacent letters and digits', () => {
  const result = redactExternal('XACME123', [['ACME', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('replaces multiple occurrences in text', () => {
  const result = redactExternal('acme-labs and acme_labs', [['acme-labs', 'TOKEN']]);
  assert.equal(result, 'TOKEN and TOKEN');
});

test('handles multiple entries sequentially', () => {
  const result = redactExternal('acme-labs and beta-corp', [
    ['acme-labs', 'TOKEN_A'],
    ['beta-corp', 'TOKEN_B']
  ]);
  assert.equal(result, 'TOKEN_A and TOKEN_B');
});

test('preserves non-matching text', () => {
  const result = redactExternal('hello acme-labs world', [['acme-labs', 'TOKEN']]);
  assert.equal(result, 'hello TOKEN world');
});

test('handles case-insensitive matching', () => {
  const result = redactExternal('ACME-LABS', [['acme-labs', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('widens match to include adjacent digits on left side', () => {
  const result = redactExternal('123ACME', [['ACME', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('widens match to include adjacent letters on left side', () => {
  const result = redactExternal('XACME', [['ACME', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('widens match to include adjacent letters on right side', () => {
  const result = redactExternal('ACMEXYZ', [['ACME', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});

test('widens match to include adjacent digits on right side', () => {
  const result = redactExternal('ACME123', [['ACME', 'TOKEN']]);
  assert.equal(result, 'TOKEN');
});
