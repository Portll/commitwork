// Read a JSON value by dotted/bracketed path (bin/bola-run.mjs pluck).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluck } from '../bola-run.mjs';

test('returns undefined when path is empty string', () => {
  assert.equal(pluck({ a: 1 }, ''), undefined);
});

test('returns undefined when path is null', () => {
  assert.equal(pluck({ a: 1 }, null), undefined);
});

test('returns undefined when path is zero', () => {
  assert.equal(pluck({ a: 1 }, 0), undefined);
});

test('returns the object itself when path is undefined', () => {
  const obj = { a: 1 };
  assert.equal(pluck(obj, undefined), undefined);
});

test('returns top-level property value', () => {
  assert.equal(pluck({ a: 42 }, 'a'), 42);
});

test('returns nested property value via dot notation', () => {
  assert.equal(pluck({ a: { b: 7 } }, 'a.b'), 7);
});

test('returns array element via bracket notation', () => {
  assert.equal(pluck({ data: [10, 20, 30] }, 'data.1'), 20);
});

test('returns undefined when intermediate is null', () => {
  assert.equal(pluck({ a: null, b: 5 }, 'a.b'), null);
});

test('returns undefined when intermediate is undefined', () => {
  assert.equal(pluck({ a: undefined, b: 5 }, 'a.b'), undefined);
});

test('handles multiple bracket segments in path', () => {
  assert.equal(pluck({ a: [{ b: 99 }] }, 'a[0].b'), 99);
});
