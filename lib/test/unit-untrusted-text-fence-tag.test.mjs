// The first 12 hex chars of a sha256 chain that do not occur in the text (lib/untrusted-text.mjs fenceTag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fenceTag } from '../untrusted-text.mjs';
import { createHash } from 'node:crypto';

const h12 = (x) => createHash('sha256').update(x).digest('hex').slice(0, 12);

const shifting = (first, second) => {
  let n = 0;
  return { toString: () => (n++ === 0 ? first : second) };
};

test('returns the first twelve hex chars of the sha256 of a short string', () => {
  assert.equal(fenceTag('hello'), '2cf24dba5fb0');
});

test('returns the first twelve hex chars of the sha256 of the empty string', () => {
  assert.equal(fenceTag(''), 'e3b0c44298fc');
});

test('returns the first twelve hex chars of the sha256 of abc', () => {
  assert.equal(fenceTag('abc'), 'ba7816bf8f01');
});

test('coerces a number to its decimal string before hashing', () => {
  assert.equal(fenceTag(12345), h12('12345'));
});

test('coerces null to the string null before hashing', () => {
  assert.equal(fenceTag(null), h12('null'));
});

test('hashes an object through its toString result', () => {
  assert.equal(fenceTag({ toString: () => 'hello' }), '2cf24dba5fb0');
});

test('keeps the initial tag when the text only contains the tag of some other string', () => {
  const text = 'abc' + 'ba7816bf8f01' + 'def';
  assert.equal(fenceTag(text), h12(text));
});

test('rehashes the tag once when the text contains its initial tag', () => {
  const t1 = h12('a');
  const r = fenceTag(shifting('a', 'a' + t1));
  assert.equal(r, h12(t1));
});

test('rehashes the tag twice when the text contains the initial and the first rehashed tag', () => {
  const t1 = h12('b');
  const t2 = h12(t1);
  const r = fenceTag(shifting('b', 'b' + t1 + '-' + t2));
  assert.equal(r, h12(t2));
});
