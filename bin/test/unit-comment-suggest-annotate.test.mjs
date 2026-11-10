// Maps comment lines to fate-tagged segments (bin/comment-suggest.mjs annotate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotate } from '../comment-suggest.mjs';

test('empty block returns empty array', () => {
  const raw = [];
  const block = [];
  const d = { sentences: [] };
  const fate = {};
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, []);
});

test('non-prose line with text gets dropped fate', () => {
  const raw = ['// usage: foo()'];
  const block = ['usage: foo()'];
  const d = { sentences: [] };
  const fate = {};
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "usage: foo()", f1: "dropped", f2: "dropped" }] }]);
});

test('banner line gets dropped fate', () => {
  const raw = ['// \u2500\u2500\u2500 heading \u2500\u2500\u2500'];
  const block = ['\u2500\u2500\u2500 heading \u2500\u2500\u2500'];
  const d = { sentences: [] };
  const fate = {};
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "\u2500\u2500\u2500 heading \u2500\u2500\u2500", f1: null, f2: null }] }]);
});

test('prose line with no sentence match gets null fate', () => {
  const raw = ['// hello world'];
  const block = ['hello world'];
  const d = { sentences: [] };
  const fate = {};
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "hello world", f1: null, f2: null }] }]);
});

test('prose line with matching sentence gets fate', () => {
  const raw = ['// hello world'];
  const block = ['hello world'];
  const d = { sentences: ['hello'] };
  const fate = { 0: ['keep', 'keep'] };
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "hello", f1: "keep", f2: "keep" }, { t: " world", f1: null, f2: null }] }]);
});

test('void block makes non-prose lines null fate', () => {
  const raw = ['// usage: foo()'];
  const block = ['usage: foo()'];
  const d = { sentences: [], void: true };
  const fate = {};
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "usage: foo()", f1: null, f2: null }] }]);
});

test('first sentence at index zero advances cursor for second sentence', () => {
  const raw = ['// a a'];
  const block = ['a a'];
  const d = { sentences: ['a', 'a'] };
  const fate = { 0: ['f1_0', 'f2_0'], 1: ['f1_1', 'f2_1'] };
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "a", f1: "f1_0", f2: "f2_0" }, { t: " ", f1: null, f2: null }, { t: "a", f1: "f1_1", f2: "f2_1" }] }]);
});

test('sentence span ending exactly at line start', () => {
  const raw = ['// hello', '// world'];
  const block = ['hello', 'world'];
  const d = { sentences: ['hello '] };
  const fate = { 0: ['keep', 'keep'] };
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "hello", f1: "keep", f2: "keep" }] }, { mark: "//", segs: [{ t: "world", f1: null, f2: null }] }]);
});

test('sentence span starting exactly at line end', () => {
  const raw = ['// hello', '// world'];
  const block = ['hello', 'world'];
  const d = { sentences: [' world'] };
  const fate = { 0: ['keep', 'keep'] };
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "hello", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "world", f1: "keep", f2: "keep" }] }]);
});

test('sentence not found with length>1', () => {
  const raw = ['// hello'];
  const block = ['hello'];
  const d = { sentences: ['xyz'] };
  const fate = { 0: ['keep', 'keep'] };
  const result = annotate(raw, block, d, fate);
  assert.deepEqual(result, [{ mark: "//", segs: [{ t: "hello", f1: null, f2: null }] }]);
});
