// Normalizes a command string and clips it to a maximum length (bin/lib/touch-ledger-core.mjs fitCommand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCommand } from '../lib/touch-ledger-core.mjs';

test('collapses internal whitespace runs into single spaces', () => {
  const r = fitCommand('a  b\t\nc');
  assert.deepEqual(r, { cmd: "a b c", clipped: false });
});

test('trims leading and trailing whitespace', () => {
  const r = fitCommand('  hello  ');
  assert.deepEqual(r, { cmd: "hello", clipped: false });
});

test('returns clipped false when length equals max', () => {
  const r = fitCommand('a'.repeat(300), 300);
  assert.deepEqual(r, { cmd: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", clipped: false });
});

test('returns clipped false when length is less than max', () => {
  const r = fitCommand('a'.repeat(299), 300);
  assert.deepEqual(r, { cmd: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", clipped: false });
});

test('returns clipped true and slices when length exceeds max', () => {
  const r = fitCommand('a'.repeat(301), 300);
  assert.deepEqual(r, { cmd: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", clipped: true });
});

test('returns clipped true and slices from index 1 when length exceeds max', () => {
  const r = fitCommand('ab'.repeat(151), 300);
  assert.deepEqual(r, { cmd: "abababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababab", clipped: true });
});

test('treats null as empty string', () => {
  const r = fitCommand(null);
  assert.deepEqual(r, { cmd: "", clipped: false });
});

test('treats undefined as empty string', () => {
  const r = fitCommand(undefined);
  assert.deepEqual(r, { cmd: "", clipped: false });
});

test('treats zero as empty string', () => {
  const r = fitCommand(0);
  assert.deepEqual(r, { cmd: "", clipped: false });
});

test('treats empty string as empty string', () => {
  const r = fitCommand('');
  assert.deepEqual(r, { cmd: "", clipped: false });
});
