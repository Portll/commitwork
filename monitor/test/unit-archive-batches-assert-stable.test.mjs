// Verifies that a file entry was not modified while being read (monitor/archive-batches.mjs assertStable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStable } from '../archive-batches.mjs';

test('passes when size, mtime, and readBytes all match', () => {
  const before = { size: 100, mtimeMs: 1000 };
  const after = { size: 100, mtimeMs: 1000 };
  assert.equal(assertStable(before, after, 'a.txt', 100), undefined);
});

test('throws when after size differs from before size', () => {
  const before = { size: 100, mtimeMs: 1000 };
  const after = { size: 200, mtimeMs: 1000 };
  assert.throws(() => assertStable(before, after, 'a.txt', 100), {
    name: 'Error',
    message: 'entry a.txt changed size while being read (100 -> 200) \u2014 refusing a torn copy'
  });
});

test('throws when after mtimeMs differs from before mtimeMs', () => {
  const before = { size: 100, mtimeMs: 1000 };
  const after = { size: 100, mtimeMs: 2000 };
  assert.throws(() => assertStable(before, after, 'a.txt', 100), {
    name: 'Error',
    message: 'entry a.txt was rewritten while being read (mtime moved) \u2014 refusing a torn copy'
  });
});

test('throws when readBytes is defined but differs from before size', () => {
  const before = { size: 100, mtimeMs: 1000 };
  const after = { size: 100, mtimeMs: 1000 };
  assert.throws(() => assertStable(before, after, 'a.txt', 50), {
    name: 'Error',
    message: 'entry a.txt read 50 bytes but stat said 100 \u2014 refusing a torn copy'
  });
});

test('passes when readBytes is undefined and size and mtime match', () => {
  const before = { size: 100, mtimeMs: 1000 };
  const after = { size: 100, mtimeMs: 1000 };
  assert.equal(assertStable(before, after, 'a.txt', undefined), undefined);
});

test('throws when size matches but mtime differs and readBytes is undefined', () => {
  const before = { size: 100, mtimeMs: 1000 };
  const after = { size: 100, mtimeMs: 2000 };
  assert.throws(() => assertStable(before, after, 'a.txt', undefined), {
    name: 'Error',
    message: 'entry a.txt was rewritten while being read (mtime moved) \u2014 refusing a torn copy'
  });
});

test('throws when size differs and mtime differs', () => {
  const before = { size: 100, mtimeMs: 1000 };
  const after = { size: 200, mtimeMs: 2000 };
  assert.throws(() => assertStable(before, after, 'a.txt', 100), {
    name: 'Error',
    message: 'entry a.txt changed size while being read (100 -> 200) \u2014 refusing a torn copy'
  });
});

test('throws when readBytes is zero and before size is nonzero', () => {
  const before = { size: 100, mtimeMs: 1000 };
  const after = { size: 100, mtimeMs: 1000 };
  assert.throws(() => assertStable(before, after, 'a.txt', 0), {
    name: 'Error',
    message: 'entry a.txt read 0 bytes but stat said 100 \u2014 refusing a torn copy'
  });
});
