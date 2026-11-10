// Extracts git commit tokens from text, skipping annotated rewrites (bin/cite-reach.mjs tokensIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensIn } from '../cite-reach.mjs';

test('returns an empty array when the text contains no hex tokens', () => {
  assert.deepEqual(tokensIn('hello world'), []);
});

test('returns a single token with its index for a bare 7-character hex string', () => {
  assert.deepEqual(tokensIn('abc1234'), [{ token: 'abc1234', index: 0 }]);
});

test('returns a token with its index when the token is embedded in surrounding text', () => {
  assert.deepEqual(tokensIn('see abc1234 end'), [{ token: 'abc1234', index: 4 }]);
});

test('returns multiple tokens with their indices for multiple hex strings', () => {
  assert.deepEqual(tokensIn('abc1234 def5678'), [
    { token: 'abc1234', index: 0 },
    { token: 'def5678', index: 8 },
  ]);
});

test('skips a token immediately followed by an annotated rewrite marker', () => {
  assert.deepEqual(tokensIn('abc1234 (rewritten; now def5678)'), [{ token: "def5678", index: 24 }]);
});

test('keeps a token when the following text is not an annotated rewrite marker', () => {
  assert.deepEqual(tokensIn('abc1234 (rewritten; now def56789)'), [{ token: "def56789", index: 24 }]);
});

test('keeps a token when the annotated marker is not adjacent to the token', () => {
  assert.deepEqual(tokensIn('abc1234 (rewritten; now def5678)'), [{ token: "def5678", index: 24 }]);
});

test('returns an empty array when the text contains only non-hex characters', () => {
  assert.deepEqual(tokensIn('zzz1234'), []);
});
