// Decodes a raw terminal input chunk into picker key actions (bin/lib/checkbox-tui.mjs pickerKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerKeys } from '../lib/checkbox-tui.mjs';

test('maps CSI arrow sequences to up and down', () => {
  assert.deepEqual(pickerKeys('\x1b[A\x1b[B'), ['up', 'down']);
});

test('maps application-mode arrow sequences to up and down', () => {
  assert.deepEqual(pickerKeys('\x1bOA\x1bOB'), ['up', 'down']);
});

test('maps single character keys to their actions', () => {
  assert.deepEqual(pickerKeys('kj \r\nq\x03\x04'), ['up', 'down', 'toggle', 'enter', 'enter', 'quit', 'quit', 'quit']);
});

test('maps digits one to three to update types and ignores zero and four', () => {
  assert.deepEqual(pickerKeys('01234'), ['type:patch', 'type:minor', 'type:major']);
});

test('advances past an arrow sequence by its own length before reading the next key', () => {
  assert.deepEqual(pickerKeys('\x1b[Bk\x1bOAj'), ['down', 'up', 'up', 'down']);
});

test('skips an unknown CSI sequence and reads the key right after it', () => {
  assert.deepEqual(pickerKeys('\x1b[1~k'), ['up']);
});

test('skips CSI sequences containing zeros and semicolons', () => {
  assert.deepEqual(pickerKeys('\x1b[20~\x1b[1;5Cj'), ['down']);
});

test('skips an unknown application-mode sequence and reads the key right after it', () => {
  assert.deepEqual(pickerKeys('\x1bOPk'), ['up']);
});

test('treats a lone or unterminated escape as quit and continues with the next character', () => {
  assert.deepEqual(pickerKeys('\x1b'), ['quit']);
  assert.deepEqual(pickerKeys('\x1bk'), ['quit', 'up']);
  assert.deepEqual(pickerKeys('\x1b['), ['quit']);
  assert.deepEqual(pickerKeys('\x1b\x1b[A'), ['quit', 'up']);
});

test('returns no actions for empty input or unmapped characters', () => {
  assert.deepEqual(pickerKeys(''), []);
  assert.deepEqual(pickerKeys('abcK'), []);
});
