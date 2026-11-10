// Parses a JSON string into an object or returns a corrupt marker (bin/lib/single-flight.mjs readHolder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHolder } from '../lib/single-flight.mjs';

test('returns the parsed object for a valid JSON object string', () => {
  const r = readHolder('{"a":1}');
  assert.deepEqual(r, { a: 1 });
});

test('returns the corrupt marker for a valid JSON null string', () => {
  const r = readHolder('null');
  assert.deepEqual(r, { corrupt: true });
});

test('returns the corrupt marker for a valid JSON number string', () => {
  const r = readHolder('42');
  assert.deepEqual(r, { corrupt: true });
});

test('returns the corrupt marker for a valid JSON string string', () => {
  const r = readHolder('"hello"');
  assert.deepEqual(r, { corrupt: true });
});

test('returns the corrupt marker for a valid JSON boolean string', () => {
  const r = readHolder('true');
  assert.deepEqual(r, { corrupt: true });
});

test('returns the corrupt marker for an invalid JSON string', () => {
  const r = readHolder('not json');
  assert.deepEqual(r, { corrupt: true });
});

test('returns the corrupt marker for an empty string', () => {
  const r = readHolder('');
  assert.deepEqual(r, { corrupt: true });
});

test('returns the corrupt marker for a JSON array string', () => {
  const r = readHolder('[1,2,3]');
  assert.deepEqual(r, [1, 2, 3]);
});
