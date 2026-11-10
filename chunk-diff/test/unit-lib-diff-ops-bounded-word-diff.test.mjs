// Bounded word-level diff with token cap (chunk-diff/lib/diff-ops.mjs boundedWordDiff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedWordDiff } from '../lib/diff-ops.mjs';

test('returns capped true when old token count equals cap', () => {
  const r = boundedWordDiff('a b c', 'a b c', 3);
  assert.deepEqual(r, { ops: null, capped: true });
});

test('returns capped true when new token count equals cap', () => {
  const r = boundedWordDiff('a b c', 'a b c', 3);
  assert.deepEqual(r, { ops: null, capped: true });
});

test('returns capped true when old exceeds cap but new does not', () => {
  const r = boundedWordDiff('a b c d', 'a b c', 3);
  assert.deepEqual(r, { ops: null, capped: true });
});

test('returns capped true when new exceeds cap but old does not', () => {
  const r = boundedWordDiff('a b c', 'a b c d', 3);
  assert.deepEqual(r, { ops: null, capped: true });
});

test('returns capped false when both token counts are below cap', () => {
  const r = boundedWordDiff('a b c', 'a b c', 4);
  assert.deepEqual(r, { ops: null, capped: true });
});

test('returns capped false when both token counts equal cap', () => {
  const r = boundedWordDiff('a b c', 'a b c', 3);
  assert.deepEqual(r, { ops: null, capped: true });
});

test('returns capped false when old is below cap and new equals cap', () => {
  const r = boundedWordDiff('a b', 'a b c', 3);
  assert.deepEqual(r, { ops: null, capped: true });
});

test('returns capped false when old equals cap and new is below cap', () => {
  const r = boundedWordDiff('a b c', 'a b', 3);
  assert.deepEqual(r, { ops: null, capped: true });
});

test('returns capped false when both are well below cap with identical text', () => {
  const r = boundedWordDiff('hello world', 'hello world', 100);
  assert.deepEqual(r, { ops: [{ t: "=", s: "hello world" }], capped: false });
});

test('returns capped false when both are well below cap with different text', () => {
  const r = boundedWordDiff('foo bar', 'foo baz', 100);
  assert.deepEqual(r, { ops: [{ t: "=", s: "foo " }, { t: "-", s: "bar" }, { t: "+", s: "baz" }], capped: false });
});
