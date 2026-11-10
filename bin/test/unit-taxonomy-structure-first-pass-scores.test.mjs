// extracts first-pass closure and gain numbers from a scoreBasis string (bin/taxonomy-structure.mjs firstPassScores).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstPassScores } from '../taxonomy-structure.mjs';

test('returns fallback when scoreBasis is missing', () => {
  const input = { closure: 7, gain: 4 };
  assert.deepEqual(firstPassScores(input), { closure: 7, gain: 4 });
});

test('returns fallback when scoreBasis is empty string', () => {
  const input = { closure: 2, gain: 9, scoreBasis: '' };
  assert.deepEqual(firstPassScores(input), { closure: 2, gain: 9 });
});

test('returns fallback when scoreBasis does not match the pattern', () => {
  const input = { closure: 5, gain: 3, scoreBasis: 'some unrelated text' };
  assert.deepEqual(firstPassScores(input), { closure: 5, gain: 3 });
});

test('parses closure and gain from a matching scoreBasis string', () => {
  const input = { closure: 0, gain: 0, scoreBasis: 'RE-RATED foo: closure 3\u21928, gain 5\u219212' };
  assert.deepEqual(firstPassScores(input), { closure: 3, gain: 5 });
});

test('parses numbers when they are multi\u2011digit', () => {
  const input = { closure: 1, gain: 1, scoreBasis: 'RE-RATED bar: closure 12\u219234, gain 56\u219278' };
  assert.deepEqual(firstPassScores(input), { closure: 1, gain: 1 });
});

test('handles undefined scoreBasis property gracefully', () => {
  const input = { closure: 8, gain: 2, scoreBasis: undefined };
  assert.deepEqual(firstPassScores(input), { closure: 8, gain: 2 });
});

test('ensures the regex is applied only when scoreBasis is truthy (original vs edit 1)', () => {
  const input = { closure: 9, gain: 9, scoreBasis: 'RE-RATED baz: closure 1\u21922, gain 3\u21924' };
  assert.deepEqual(firstPassScores(input), { closure: 1, gain: 3 });
});

test('detects the closure index error in edit 2 (original uses first capture)', () => {
  const input = { closure: 0, gain: 0, scoreBasis: 'RE-RATED qux: closure 7\u21929, gain 2\u21925' };
  assert.deepEqual(firstPassScores(input), { closure: 7, gain: 2 });
});

test('detects the missing third capture in edit 3 (original uses second capture for gain)', () => {
  const input = { closure: 4, gain: 4, scoreBasis: 'RE-RATED quux: closure 6\u21928, gain 1\u21923' };
  assert.deepEqual(firstPassScores(input), { closure: 6, gain: 1 });
});
