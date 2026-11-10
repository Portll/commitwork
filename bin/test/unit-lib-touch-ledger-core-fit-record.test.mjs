// Serialised JSONL line, its byte count including newline, and the over-ceiling flag (bin/lib/touch-ledger-core.mjs fitRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitRecord } from '../lib/touch-ledger-core.mjs';

const xLine = (n) => '{"a":"' + 'x'.repeat(n) + '"}';

test('a small record yields its JSON line, byte count plus one for the newline, and no excess', () => {
  const r = fitRecord({ a: 1 });
  assert.deepEqual(r, { line: '{"a":1}', bytes: 8, exceeds: false });
});

test('an empty object whose byte count equals the max does not exceed it', () => {
  const r = fitRecord({}, 3);
  assert.deepEqual(r, { line: '{}', bytes: 3, exceeds: false });
});

test('an empty object whose byte count is one over the max exceeds it', () => {
  const r = fitRecord({}, 2);
  assert.deepEqual(r, { line: '{}', bytes: 3, exceeds: true });
});

test('a record whose byte count equals the max does not exceed it', () => {
  const r = fitRecord({ a: 'x'.repeat(100) }, 109);
  assert.deepEqual(r, { line: xLine(100), bytes: 109, exceeds: false });
});

test('a record whose byte count is one over the max exceeds it', () => {
  const r = fitRecord({ a: 'x'.repeat(100) }, 108);
  assert.deepEqual(r, { line: xLine(100), bytes: 109, exceeds: true });
});

test('a record whose byte count is one under the max does not exceed it', () => {
  const r = fitRecord({ a: 'x'.repeat(100) }, 110);
  assert.deepEqual(r, { line: xLine(100), bytes: 109, exceeds: false });
});

test('multi-byte UTF-8 characters are counted by their encoded byte length', () => {
  const r = fitRecord({ a: '\u00e9' });
  assert.deepEqual(r, { line: '{"a":"\u00e9"}', bytes: 11, exceeds: false });
});

test('a record of exactly 4096 bytes does not exceed the default max', () => {
  const r = fitRecord({ a: 'x'.repeat(4087) });
  assert.deepEqual(r, { line: xLine(4087), bytes: 4096, exceeds: false });
});

test('a record of 4097 bytes exceeds the default max', () => {
  const r = fitRecord({ a: 'x'.repeat(4088) });
  assert.deepEqual(r, { line: xLine(4088), bytes: 4097, exceeds: true });
});
