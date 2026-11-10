// Replaces hit spans with source tags (bin/lib/release-scope.mjs mask).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mask } from '../lib/release-scope.mjs';

test('returns the text unchanged when there are no hits', () => {
  const r = mask('hello world', []);
  assert.equal(r, "hello world");
});

test('replaces a single hit with its source tag', () => {
  const text = 'abcdef';
  const hits = [{ start: 1, end: 3, source: 'A' }];
  const r = mask(text, hits);
  assert.equal(r, "a\u2039A\u203adef");
});

test('replaces multiple non-overlapping hits in order', () => {
  const text = 'abcdefghij';
  const hits = [
    { start: 0, end: 2, source: 'X' },
    { start: 4, end: 6, source: 'Y' },
    { start: 8, end: 10, source: 'Z' }
  ];
  const r = mask(text, hits);
  assert.equal(r, "\u2039X\u203acd\u2039Y\u203agh\u2039Z\u203a");
});

test('handles a hit at the very start of the text', () => {
  const text = 'xyz';
  const hits = [{ start: 0, end: 1, source: 'S' }];
  const r = mask(text, hits);
  assert.equal(r, "\u2039S\u203ayz");
});

test('handles a hit at the very end of the text', () => {
  const text = 'xyz';
  const hits = [{ start: 2, end: 3, source: 'E' }];
  const r = mask(text, hits);
  assert.equal(r, "xy\u2039E\u203a");
});

test('handles a hit covering the entire text', () => {
  const text = 'abc';
  const hits = [{ start: 0, end: 3, source: 'ALL' }];
  const r = mask(text, hits);
  assert.equal(r, "\u2039ALL\u203a");
});

test('handles adjacent hits with no gap between them', () => {
  const text = 'abcdef';
  const hits = [
    { start: 0, end: 2, source: 'L' },
    { start: 2, end: 4, source: 'M' },
    { start: 4, end: 6, source: 'R' }
  ];
  const r = mask(text, hits);
  assert.equal(r, "\u2039L\u203a\u2039M\u203a\u2039R\u203a");
});

test('handles an empty text with no hits', () => {
  const r = mask('', []);
  assert.equal(r, "");
});

test('handles a zero-length hit in the middle of the text', () => {
  const text = 'abc';
  const hits = [{ start: 1, end: 1, source: 'Z' }];
  const r = mask(text, hits);
  assert.equal(r, "a\u2039Z\u203abc");
});

test('handles a hit whose start equals the previous hit end', () => {
  const text = 'ab';
  const hits = [
    { start: 0, end: 1, source: 'P' },
    { start: 1, end: 2, source: 'Q' }
  ];
  const r = mask(text, hits);
  assert.equal(r, "\u2039P\u203a\u2039Q\u203a");
});
