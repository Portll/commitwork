// Applies a comment suggestion to source text, replacing the matched block with the replacement (bin/comment-suggest.mjs applyTo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTo } from '../comment-suggest.mjs';

test('returns ok false with error when the block at startLine does not match sug.before', () => {
  const src = 'a\nb\nc\nd';
  const sug = { id: 's1', startLine: 2, before: ['x', 'y'] };
  const res = applyTo(src, sug, 'z');
  assert.equal(res.ok, false);
  assert.equal(res.error, 's1: the block at line 2 is not the one this suggestion was drafted from \u2014 re-read before accepting');
});

test('returns ok true with replacement text when the block matches and replacement is provided', () => {
  const src = 'a\nb\nc\nd';
  const sug = { id: 's1', startLine: 2, before: ['b', 'c'] };
  const res = applyTo(src, sug, 'z');
  assert.equal(res.ok, true);
  assert.equal(res.text, 'a\nz\nd');
});

test('returns ok true with sug.after joined when replacement is null and block matches', () => {
  const src = 'a\nb\nc\nd';
  const sug = { id: 's1', startLine: 2, before: ['b', 'c'], after: ['x', 'y'] };
  const res = applyTo(src, sug, null);
  assert.equal(res.ok, true);
  assert.equal(res.text, 'a\nx\ny\nd');
});

test('returns ok true with sug.after joined when replacement is undefined and block matches', () => {
  const src = 'a\nb\nc\nd';
  const sug = { id: 's1', startLine: 2, before: ['b', 'c'], after: ['x', 'y'] };
  const res = applyTo(src, sug, undefined);
  assert.equal(res.ok, true);
  assert.equal(res.text, 'a\nx\ny\nd');
});

test('returns ok true with empty string replacement when replacement is empty string', () => {
  const src = 'a\nb\nc\nd';
  const sug = { id: 's1', startLine: 2, before: ['b', 'c'] };
  const res = applyTo(src, sug, '');
  assert.equal(res.ok, true);
  assert.equal(res.text, 'a\n\nd');
});

test('returns ok true with replacement text when startLine is 1 and block matches', () => {
  const src = 'a\nb\nc\nd';
  const sug = { id: 's1', startLine: 1, before: ['a', 'b'] };
  const res = applyTo(src, sug, 'z');
  assert.equal(res.ok, true);
  assert.equal(res.text, 'z\nc\nd');
});

test('returns ok true with replacement text when startLine is at the last line and block matches', () => {
  const src = 'a\nb\nc\nd';
  const sug = { id: 's1', startLine: 4, before: ['d'] };
  const res = applyTo(src, sug, 'z');
  assert.equal(res.ok, true);
  assert.equal(res.text, 'a\nb\nc\nz');
});

test('returns ok false with error when sug.before is longer than remaining lines', () => {
  const src = 'a\nb';
  const sug = { id: 's1', startLine: 2, before: ['b', 'c'] };
  const res = applyTo(src, sug, 'z');
  assert.equal(res.ok, false);
  assert.equal(res.error, 's1: the block at line 2 is not the one this suggestion was drafted from \u2014 re-read before accepting');
});
