// Parses ledger text lines into JSON rows and counts torn lines (bin/lib/touch-ledger-core.mjs parseLedger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger } from '../lib/touch-ledger-core.mjs';

test('returns empty rows and zero torn for empty input array', () => {
  const r = parseLedger([]);
  assert.deepEqual(r, { rows: [], torn: 0 });
});

test('parses valid JSON lines into rows with zero torn', () => {
  const r = parseLedger(['{"a":1}', '{"b":2}']);
  assert.deepEqual(r, { rows: [{ a: 1 }, { b: 2 }], torn: 0 });
});

test('counts unparseable lines as torn and excludes them from rows', () => {
  const r = parseLedger(['{"a":1}', 'not-json', '{"b":2}']);
  assert.deepEqual(r, { rows: [{ a: 1 }, { b: 2 }], torn: 1 });
});

test('skips blank lines without counting them as torn', () => {
  const r = parseLedger(['{"a":1}', '', '   ', '{"b":2}']);
  assert.deepEqual(r, { rows: [{ a: 1 }, { b: 2 }], torn: 0 });
});

test('treats null entries as empty strings producing no rows or torn', () => {
  const r = parseLedger([null, null]);
  assert.deepEqual(r, { rows: [], torn: 0 });
});

test('treats undefined entries as empty strings producing no rows or torn', () => {
  const r = parseLedger([undefined, undefined]);
  assert.deepEqual(r, { rows: [], torn: 0 });
});

test('counts all unparseable lines as torn with no valid rows', () => {
  const r = parseLedger(['bad1', 'bad2', 'bad3']);
  assert.deepEqual(r, { rows: [], torn: 3 });
});

test('handles multiple text blocks with mixed valid and torn lines', () => {
  const r = parseLedger(['{"x":1}', 'garbage', '', '{"y":2}', 'oops']);
  assert.deepEqual(r, { rows: [{ x: 1 }, { y: 2 }], torn: 2 });
});
