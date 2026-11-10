// computes a relative path from root to p if p is within root (lib/path-contain.mjs relativeWithin)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeWithin } from '../path-contain.mjs';
import path from 'node:path';

test('returns null when root is undefined', () => {
  const r = relativeWithin(undefined, '/some/path');
  assert.equal(r, null);
});

test('returns null when p is undefined', () => {
  const r = relativeWithin('/some/root', undefined);
  assert.equal(r, null);
});

test('returns null when p is outside root (different drive on Windows)', () => {
  const r = relativeWithin('C:\\root', 'D:\\outside');
  assert.equal(r, null);
});

test('returns null when p escapes root with ".."', () => {
  const r = relativeWithin('/a/b', '/a');
  assert.equal(r, null);
});

test('returns null when p escapes root with "../c"', () => {
  const r = relativeWithin('/a/b', '/a/c');
  assert.equal(r, null);
});

test('returns empty string when p equals root', () => {
  const r = relativeWithin('/a/b', '/a/b');
  assert.equal(r, "");
});

test('returns relative path when p is inside root', () => {
  const r = relativeWithin('/a', '/a/b/c');
  assert.equal(r, "b/c");
});
