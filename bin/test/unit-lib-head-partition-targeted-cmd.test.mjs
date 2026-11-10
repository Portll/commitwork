// Builds a node --test command string for the given files (bin/lib/head-partition.mjs targetedCmd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetedCmd } from '../lib/head-partition.mjs';

test('returns the command with concurrency 1 for a single file', () => {
  const r = targetedCmd(['a.mjs']);
  assert.equal(r, "node --test --test-concurrency=1 \"a.mjs\"");
});

test('returns the command with concurrency 1 for multiple files', () => {
  const r = targetedCmd(['a.mjs', 'b.mjs']);
  assert.equal(r, "node --test --test-concurrency=1 \"a.mjs\" \"b.mjs\"");
});

test('returns the command with concurrency 1 for an empty file list', () => {
  const r = targetedCmd([]);
  assert.equal(r, "node --test --test-concurrency=1 ");
});

test('returns the command with concurrency 1 for a file with special characters', () => {
  const r = targetedCmd(['file with spaces.mjs']);
  assert.equal(r, "node --test --test-concurrency=1 \"file with spaces.mjs\"");
});

test('returns the command with concurrency 1 for a file with quotes', () => {
  const r = targetedCmd(['"quoted".mjs']);
  assert.equal(r, "node --test --test-concurrency=1 \"\\\"quoted\\\".mjs\"");
});

test('returns the command with concurrency 1 for a file with backslashes', () => {
  const r = targetedCmd(['back\\slash.mjs']);
  assert.equal(r, "node --test --test-concurrency=1 \"back\\\\slash.mjs\"");
});

test('returns the command with concurrency 1 for a file with unicode', () => {
  const r = targetedCmd(['unicode-\u00e9.mjs']);
  assert.equal(r, "node --test --test-concurrency=1 \"unicode-\u00e9.mjs\"");
});

test('returns the command with concurrency 1 for a long file path', () => {
  const r = targetedCmd(['x'.repeat(100) + '.mjs']);
  assert.equal(r, "node --test --test-concurrency=1 \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.mjs\"");
});
