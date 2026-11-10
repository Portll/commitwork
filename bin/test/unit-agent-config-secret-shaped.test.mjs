// Detects whether a key/value pair looks like a leaked secret (bin/agent-config.mjs secretShaped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretShaped } from '../agent-config.mjs';

test('returns false when the value is not a string', () => {
  assert.equal(secretShaped('api_key', 12345), false);
  assert.equal(secretShaped('token', null), false);
  assert.equal(secretShaped('secret', undefined), false);
});

test('returns false for empty or whitespace-only values', () => {
  assert.equal(secretShaped('api_key', ''), false);
  assert.equal(secretShaped('token', '   '), false);
});

test('returns false when the value is a variable reference', () => {
  assert.equal(secretShaped('api_key', '${API_KEY}'), false);
  assert.equal(secretShaped('token', '$TOKEN'), false);
  assert.equal(secretShaped('secret', '%SECRET%'), false);
  assert.equal(secretShaped('auth', '${env:AUTH_TOKEN}'), false);
});

test('returns false when the value is a placeholder', () => {
  assert.equal(secretShaped('api_key', '<your-key>'), false);
  assert.equal(secretShaped('token', 'your-token'), false);
  assert.equal(secretShaped('secret', 'changeme'), false);
  assert.equal(secretShaped('password', 'example'), false);
  assert.equal(secretShaped('key', 'xxx'), false);
  assert.equal(secretShaped('auth', 'null'), false);
  assert.equal(secretShaped('credential', 'true'), false);
});

test('returns true for known credential prefixes with sufficient length', () => {
  assert.equal(secretShaped('anything', 'ghp_' + 'a'.repeat(36)), true);
  assert.equal(secretShaped('anything', 'sk-' + 'b'.repeat(48)), true);
  assert.equal(secretShaped('anything', 'AKIA' + 'c'.repeat(16)), true);
  assert.equal(secretShaped('anything', 'xoxb-' + 'd'.repeat(38)), true);
  assert.equal(secretShaped('anything', 'glpat-' + 'e'.repeat(20)), true);
});

test('returns false for known prefixes shorter than 10 characters', () => {
  assert.equal(secretShaped('anything', 'ghp_abc'), false);
  assert.equal(secretShaped('anything', 'sk-abc'), false);
  assert.equal(secretShaped('anything', 'AKIA'), false);
});

test('returns false when the key is not key-like and no known prefix matches', () => {
  assert.equal(secretShaped('name', 'a1b2c3d4e5f6g7h8'), false);
  assert.equal(secretShaped('description', 'x9y8z7w6v5u4t3s2'), false);
  assert.equal(secretShaped('label', 'q1r2s3t4u5v6w7x8'), false);
});

test('returns true for key-like keys with high-entropy values of valid shape', () => {
  assert.equal(secretShaped('api_key', 'a1b2c3d4e5f6g7h8i9j0'), true);
  assert.equal(secretShaped('token', 'Zx9Yw8Vv7Uu6Tt5Ss4Rr3Qq2Pp1Oo0Nn9Mm8Ll7Kk6Jj5Ii4Hh3Gg2Ff1Ee0Dd9Cc8Bb7Aa6'), true);
  assert.equal(secretShaped('password', 'p4ssw0rd!@#$%^&*()'), false);
  assert.equal(secretShaped('secret', 's3cr3t!@#$%^&*()_+'), false);
  assert.equal(secretShaped('client_id', 'c1i2e3n4t5i6d7a8b9c0'), true);
});

test('returns false for key-like keys with low-entropy values', () => {
  assert.equal(secretShaped('api_key', 'aaaaaaaaaaaaaaaa'), false);
  assert.equal(secretShaped('token', '1111111111111111'), false);
  assert.equal(secretShaped('password', 'abcdefghij'), false);
});

test('returns false when the value does not match the required character shape', () => {
  assert.equal(secretShaped('api_key', 'a1b2c3d4e5f6g7h8i9j0!'), false);
  assert.equal(secretShaped('token', 'a1b2c3d4e5f6g7h8i9j0 '), true);
  assert.equal(secretShaped('secret', 'a1b2c3d4e5f6g7h8i9j0\n'), true);
});

test('returns false when the value is shorter than 10 characters', () => {
  assert.equal(secretShaped('api_key', 'a1b2c3d4e5'), false);
  assert.equal(secretShaped('token', 'a1b2c3d4'), false);
  assert.equal(secretShaped('secret', 'a1b2c3'), false);
});

test('returns false when the value is longer than 150 characters', () => {
  const long = 'a1b2c3d4e5'.repeat(16);
  assert.equal(secretShaped('api_key', long), false);
});
