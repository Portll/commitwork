// bin/test/touch-ledger-core-units.test.mjs — case tests for parseLedger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger } from '../lib/touch-ledger-core.mjs';

test('parses valid JSON lines into rows', () => {
  const result = parseLedger(['{"a":1}', '{"b":2}']);
  assert.deepEqual(result.rows, [{ a: 1 }, { b: 2 }]);
  assert.equal(result.torn, 0);
});

test('counts invalid JSON lines as torn', () => {
  const result = parseLedger(['{"a":1}', 'not-json', '{"b":2}']);
  assert.deepEqual(result.rows, [{ a: 1 }, { b: 2 }]);
  assert.equal(result.torn, 1);
});

test('ignores empty and whitespace-only lines', () => {
  const result = parseLedger(['', '   ', '{"x":9}', '\n']);
  assert.deepEqual(result.rows, [{ x: 9 }]);
  assert.equal(result.torn, 0);
});

test('handles multiple text entries', () => {
  const result = parseLedger(['{"a":1}', '{"b":2}', '{"c":3}']);
  assert.deepEqual(result.rows, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  assert.equal(result.torn, 0);
});

test('returns empty rows and zero torn for empty input', () => {
  const result = parseLedger([]);
  assert.deepEqual(result.rows, []);
  assert.equal(result.torn, 0);
});

test('handles null and undefined entries in texts', () => {
  const result = parseLedger([null, undefined, '{"z":0}']);
  assert.deepEqual(result.rows, [{ z: 0 }]);
  assert.equal(result.torn, 0);
});

test('counts multiple torn lines correctly', () => {
  const result = parseLedger(['bad1', 'bad2', '{"ok":true}']);
  assert.deepEqual(result.rows, [{ ok: true }]);
  assert.equal(result.torn, 2);
});
