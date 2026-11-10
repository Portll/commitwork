// Maps pid lines to command strings (monitor/process-ancestry.mjs parsePidArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePidArgs } from '../process-ancestry.mjs';

test('returns empty map for null input', () => {
  const r = parsePidArgs(null);
  assert.deepEqual(r, new Map([]));
});

test('returns empty map for empty string', () => {
  const r = parsePidArgs('');
  assert.deepEqual(r, new Map([]));
});

test('parses single pid line with leading whitespace', () => {
  const r = parsePidArgs('  123  node app.js');
  assert.deepEqual(r, new Map([[123, "node app.js"]]));
});

test('parses multiple pid lines into map', () => {
  const r = parsePidArgs('1 cmd1\n2 cmd2\n3 cmd3');
  assert.deepEqual(r, new Map([[1, "cmd1"], [2, "cmd2"], [3, "cmd3"]]));
});

test('ignores lines without pid prefix', () => {
  const r = parsePidArgs('no pid here\n456 real cmd');
  assert.deepEqual(r, new Map([[456, "real cmd"]]));
});

test('trims trailing whitespace from command', () => {
  const r = parsePidArgs('789  spaced out   ');
  assert.deepEqual(r, new Map([[789, "spaced out"]]));
});

test('handles undefined input as empty', () => {
  const r = parsePidArgs(undefined);
  assert.deepEqual(r, new Map([]));
});

test('parses line with tabs between pid and command', () => {
  const r = parsePidArgs('10\ttabbed cmd');
  assert.deepEqual(r, new Map([[10, "tabbed cmd"]]));
});
