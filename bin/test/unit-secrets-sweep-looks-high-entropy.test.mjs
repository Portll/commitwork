// Whether a token looks like a random credential rather than a slug, digest or name (bin/secrets-sweep.mjs looksHighEntropy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksHighEntropy } from '../secrets-sweep.mjs';

const letters = 'aBcDeFgHiJkLmNoP';
const marks = '!@#$%^&*()~;:,<>';
const pairs = (digit) => Array.from({ length: 16 }, (_, i) => letters[i] + digit(i)).join('');
const key = pairs((i) => String((i + 1) % 10));

test('A 32 character mixed key is high entropy but its 31 character prefix is too short', () => {
  assert.equal(key.length, 32);
  assert.equal(looksHighEntropy(key), true);
  assert.equal(looksHighEntropy(key.slice(0, 31)), false);
});

test('UUIDs and SRI integrity digests are never reported even when they wrap a key', () => {
  assert.equal(looksHighEntropy('123e4567-e89b-12d3-a456-426614174000'), false);
  assert.equal(looksHighEntropy('sha512-' + key), false);
  assert.equal(looksHighEntropy('sha256-' + key + '=='), false);
});

test('A longest segment of exactly 20 characters is checked while 19 characters is a slug', () => {
  const twenty = key.slice(0, 20);
  const nineteen = key.slice(0, 19);
  assert.equal(looksHighEntropy(twenty + '-' + twenty), true);
  assert.equal(looksHighEntropy(nineteen + '-' + nineteen), false);
});

test('A hex repository digest inside a delimited token is not a key', () => {
  assert.equal(looksHighEntropy('ref-' + '0a1b2c3d'.repeat(5)), false);
});

test('A segment without letters is not a key even when its entropy is high', () => {
  const noLetters = Array.from({ length: 16 }, (_, i) => String(i % 10) + marks[i]).join('');
  assert.equal(noLetters.length, 32);
  assert.equal(looksHighEntropy(noLetters), false);
  assert.equal(looksHighEntropy('1234567890'.repeat(4)), false);
});

test('A segment without digits is not a key', () => {
  assert.equal(looksHighEntropy(letters.repeat(2)), false);
});

test('A segment whose only digit is zero still counts as containing a digit', () => {
  const zeroKey = Array.from({ length: 12 }, (_, i) => letters[i] + '0' + marks[i]).join('');
  assert.equal(zeroKey.length, 36);
  assert.equal(looksHighEntropy(zeroKey), true);
});

test('A segment whose digits are all between 2 and 9 still counts as containing a digit', () => {
  assert.equal(looksHighEntropy(pairs((i) => String(2 + (i % 8)))), true);
});

test('A low entropy camelCase name with a digit is not a key', () => {
  assert.equal(looksHighEntropy('userName' + 'UserName'.repeat(3) + '1'), false);
});

test('A long mixed run with few distinct characters is below the entropy threshold', () => {
  assert.equal(looksHighEntropy('a1b2'.repeat(8)), false);
});
