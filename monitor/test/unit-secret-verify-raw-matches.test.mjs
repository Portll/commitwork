// Normalized exact or substring match of a secret against raw strings (monitor/secret-verify.mjs rawMatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawMatches } from '../secret-verify.mjs';

test('returns false when the secret is empty', () => {
  assert.equal(rawMatches('', ['abc']), false);
});

test('returns false when the secret is only whitespace', () => {
  assert.equal(rawMatches('   ', ['abc']), false);
});

test('returns true when a raw string equals the secret after normalization', () => {
  assert.equal(rawMatches('abc', ['a bc']), true);
});

test('returns false when no raw string equals the secret', () => {
  assert.equal(rawMatches('abc', ['xyz']), false);
});

test('returns true when a long raw string contains the long secret', () => {
  const s = 'a'.repeat(24);
  const r = 'x' + s + 'y';
  assert.equal(rawMatches(s, [r]), true);
});

test('returns false when the secret is 23 characters and the raw string contains it', () => {
  const s = 'a'.repeat(23);
  const r = 'x' + s + 'y';
  assert.equal(rawMatches(s, [r]), false);
});

test('returns true when the long secret contains the long raw string', () => {
  const s = 'x' + 'a'.repeat(24) + 'y';
  const r = 'a'.repeat(24);
  assert.equal(rawMatches(s, [r]), true);
});

test('returns false when both are long but neither contains the other', () => {
  const s = 'a'.repeat(24);
  const r = 'b'.repeat(24);
  assert.equal(rawMatches(s, [r]), false);
});

test('returns false when the raw string is empty', () => {
  assert.equal(rawMatches('abc', ['']), false);
});

test('returns false when the raw string is only whitespace', () => {
  assert.equal(rawMatches('abc', ['   ']), false);
});
