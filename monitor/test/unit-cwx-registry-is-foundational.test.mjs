// Checks whether a primary id is a valid CWX identifier (monitor/cwx-registry.mjs isFoundational).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFoundational } from '../cwx-registry.mjs';

test('returns true for a valid CWX id', () => {
  const r = isFoundational('CWX-ABC123');
  assert.equal(r, true);
});

test('returns false for an id with lowercase letters', () => {
  const r = isFoundational('CWX-abc123');
  assert.equal(r, false);
});

test('returns false for an id with five characters', () => {
  const r = isFoundational('CWX-ABC12');
  assert.equal(r, false);
});

test('returns false for an id with seven characters', () => {
  const r = isFoundational('CWX-ABC1234');
  assert.equal(r, false);
});

test('returns false for an id with a dash in the body', () => {
  const r = isFoundational('CWX-AB-C12');
  assert.equal(r, false);
});

test('returns false for a non-string input', () => {
  const r = isFoundational(123456);
  assert.equal(r, false);
});

test('returns false for null input', () => {
  const r = isFoundational(null);
  assert.equal(r, false);
});

test('returns false for an empty string', () => {
  const r = isFoundational('');
  assert.equal(r, false);
});

test('returns false for a string with a trailing newline', () => {
  const r = isFoundational('CWX-ABC123\n');
  assert.equal(r, false);
});

test('returns false for a string with a leading space', () => {
  const r = isFoundational(' CWX-ABC123');
  assert.equal(r, false);
});
