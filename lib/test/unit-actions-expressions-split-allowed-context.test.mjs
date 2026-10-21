// Splits allowed-context list into plain contexts and function specs (lib/actions-expressions.mjs splitAllowedContext).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAllowedContext } from '../actions-expressions.mjs';

test('returns empty contexts and functions for empty input', () => {
  const result = splitAllowedContext([]);
  assert.deepEqual(result, { contexts: [], functions: [] });
});

test('puts plain context strings into contexts', () => {
  const result = splitAllowedContext(['github', 'always']);
  assert.deepEqual(result, { contexts: ['github', 'always'], functions: [] });
});

test('parses function with numeric max into functions', () => {
  const result = splitAllowedContext(['hashFiles(2,255)']);
  assert.deepEqual(result, { contexts: [], functions: [{ name: 'hashFiles', minArgs: 2, maxArgs: 255 }] });
});

test('parses function with MAX max into functions with MAX_SAFE_INTEGER', () => {
  const result = splitAllowedContext(['always(0,MAX)']);
  assert.deepEqual(result, { contexts: [], functions: [{ name: 'always', minArgs: 0, maxArgs: Number.MAX_SAFE_INTEGER }] });
});

test('separates contexts and functions in mixed list', () => {
  const result = splitAllowedContext(['github', 'always(0,0)', 'hashFiles(2,255)']);
  assert.deepEqual(result, { contexts: ['github'], functions: [{ name: 'always', minArgs: 0, maxArgs: 0 }, { name: 'hashFiles', minArgs: 2, maxArgs: 255 }] });
});

test('treats string with space as context not function', () => {
  const result = splitAllowedContext(['always (0,0)']);
  assert.deepEqual(result, { contexts: ['always (0,0)'], functions: [] });
});

test('treats string with negative number as context not function', () => {
  const result = splitAllowedContext(['always(-1,0)']);
  assert.deepEqual(result, { contexts: ['always(-1,0)'], functions: [] });
});

test('treats string with extra argument as context not function', () => {
  const result = splitAllowedContext(['always(0,0,0)']);
  assert.deepEqual(result, { contexts: ['always(0,0,0)'], functions: [] });
});

test('treats string with non-numeric max as context not function', () => {
  const result = splitAllowedContext(['always(0,abc)']);
  assert.deepEqual(result, { contexts: ['always(0,abc)'], functions: [] });
});

test('treats string with lowercase max as context not function', () => {
  const result = splitAllowedContext(['always(0,max)']);
  assert.deepEqual(result, { contexts: ['always(0,max)'], functions: [] });
});
