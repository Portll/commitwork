// extracts quoted substrings with their offsets (flow/lexer.mjs rawQuotedRuns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawQuotedRuns } from '../lexer.mjs';

test('single\u2011quoted string on a single line', () => {
  const r = rawQuotedRuns("'abc'");
  assert.deepEqual(r, [{ value: "abc", start: 0 }]);
});

test('double\u2011quoted string on a single line', () => {
  const r = rawQuotedRuns('"def"');
  assert.deepEqual(r, [{ value: "def", start: 0 }]);
});

test('back\u2011ticked string on a single line', () => {
  const r = rawQuotedRuns('`ghi`');
  assert.deepEqual(r, [{ value: "ghi", start: 0 }]);
});

test('multiple lines with offsets accumulating', () => {
  const src = "'x'\n\"y\"\n`z`";
  const r = rawQuotedRuns(src);
  assert.deepEqual(r, [{ value: "x", start: 0 }, { value: "y", start: 4 }, { value: "z", start: 8 }]);
});

test('quoted length exactly one character (tests min\u2011length 1 vs 2)', () => {
  const r = rawQuotedRuns("'a'");
  assert.deepEqual(r, [{ value: "a", start: 0 }]);
});

test('quoted length exactly two characters (tests min\u2011length 2 vs 1)', () => {
  const r = rawQuotedRuns("'ab'");
  assert.deepEqual(r, [{ value: "ab", start: 0 }]);
});

test('value taken from second capture group (original uses first)', () => {
  const r = rawQuotedRuns("'capture'");
  assert.deepEqual(r, [{ value: "capture", start: 0 }]);
});
