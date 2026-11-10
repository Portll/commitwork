// Maps Win32 process JSON to a pid-to-command-line map (monitor/port-bind.mjs parseWin32ProcessJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWin32ProcessJson } from '../port-bind.mjs';

test('returns empty map for invalid JSON', () => {
  assert.deepEqual(parseWin32ProcessJson('not json'), new Map([]));
});

test('returns empty map for null input', () => {
  assert.deepEqual(parseWin32ProcessJson(null), new Map([]));
});

test('returns empty map for empty string input', () => {
  assert.deepEqual(parseWin32ProcessJson(''), new Map([]));
});

test('returns empty map for single object with null CommandLine', () => {
  assert.deepEqual(parseWin32ProcessJson(JSON.stringify({ ProcessId: 123, CommandLine: null })), new Map([]));
});

test('returns empty map for single object with empty CommandLine', () => {
  assert.deepEqual(parseWin32ProcessJson(JSON.stringify({ ProcessId: 123, CommandLine: '   ' })), new Map([]));
});

test('returns empty map for single object with non-integer ProcessId', () => {
  assert.deepEqual(parseWin32ProcessJson(JSON.stringify({ ProcessId: 1.5, CommandLine: 'cmd' })), new Map([]));
});

test('returns map with one entry for valid single object', () => {
  assert.deepEqual(parseWin32ProcessJson(JSON.stringify({ ProcessId: 123, CommandLine: '  cmd  ' })), new Map([[123, "cmd"]]));
});

test('returns map with entries from array of valid objects', () => {
  assert.deepEqual(parseWin32ProcessJson(JSON.stringify([{ ProcessId: 1, CommandLine: 'a' }, { ProcessId: 2, CommandLine: 'b' }])), new Map([[1, "a"], [2, "b"]]));
});

test('returns empty map for array with null element', () => {
  assert.deepEqual(parseWin32ProcessJson(JSON.stringify([null])), new Map([]));
});

test('returns empty map for single object with missing ProcessId', () => {
  assert.deepEqual(parseWin32ProcessJson(JSON.stringify({ CommandLine: 'cmd' })), new Map([]));
});
