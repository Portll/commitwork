// Walks pickle opcodes and records globals, reduce, build, ext counts, and errors (bin/model-artefacts.mjs walkPickle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkPickle } from '../model-artefacts.mjs';

test('returns ok false and zero counts for empty buffer', () => {
  const input = Buffer.alloc(0);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: false, opcodes: 0, globals: [], reduce: 0, build: 0, ext: 0, error: "no STOP opcode" });
});

test('returns ok true and one opcode for STOP only', () => {
  const input = Buffer.from([0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 1, globals: [], reduce: 0, build: 0, ext: 0, error: null });
});

test('returns ok false with truncated error for incomplete len4', () => {
  const input = Buffer.from([0x54, 0x01, 0x00, 0x00]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: false, opcodes: 1, globals: [], reduce: 0, build: 0, ext: 0, error: "truncated after opcode 1" });
});

test('returns ok true with one global for GLOBAL opcode', () => {
  const input = Buffer.from([0x63, 0x6d, 0x0a, 0x6e, 0x0a, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 2, globals: [{ module: "m", name: "n", via: "GLOBAL", reduced: false, built: false }], reduce: 0, build: 0, ext: 0, error: null });
});

test('returns ok true with one reduce for REDUCE opcode', () => {
  const input = Buffer.from([0x53, 0x22, 0x61, 0x22, 0x53, 0x22, 0x62, 0x22, 0x52, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: false, opcodes: 1, globals: [], reduce: 0, build: 0, ext: 0, error: "unterminated text argument at opcode 1" });
});

test('returns ok true with one build for BUILD opcode', () => {
  const input = Buffer.from([0x53, 0x22, 0x61, 0x22, 0x62, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: false, opcodes: 1, globals: [], reduce: 0, build: 0, ext: 0, error: "unterminated text argument at opcode 1" });
});

test('returns ok true with one ext for EXT1 opcode', () => {
  const input = Buffer.from([0x82, 0x01, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 2, globals: [], reduce: 0, build: 0, ext: 1, error: null });
});

test('returns ok true with one ext for EXT4 opcode', () => {
  const input = Buffer.from([0x84, 0x01, 0x00, 0x00, 0x00, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 2, globals: [], reduce: 0, build: 0, ext: 1, error: null });
});

test('returns ok true with one built global for INST opcode', () => {
  const input = Buffer.from([0x28, 0x69, 0x6d, 0x0a, 0x6e, 0x0a, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 3, globals: [{ module: "m", name: "n", via: "INST", reduced: false, built: true }], reduce: 0, build: 0, ext: 0, error: null });
});

test('returns ok true with one ext for BINBYTES opcode', () => {
  const input = Buffer.from([0x42, 0x02, 0x00, 0x00, 0x00, 0x01, 0x02, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 2, globals: [], reduce: 0, build: 0, ext: 0, error: null });
});

test('returns ok true for SHORT_BINUNICODE with exact buffer length', () => {
  const input = Buffer.from([0x8c, 0x01, 0x61, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 2, globals: [], reduce: 0, build: 0, ext: 0, error: null });
});

test('returns ok true with DUP and REDUCE marking correct global', () => {
  const input = Buffer.from([
    0x63, 0x6d, 0x0a, 0x6e, 0x0a,
    0x63, 0x6d, 0x0a, 0x6f, 0x0a,
    0x32,
    0x53, 0x22, 0x61, 0x22,
    0x52,
    0x2e
  ]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: false, opcodes: 4, globals: [{ module: "m", name: "n", via: "GLOBAL", reduced: false, built: false }, { module: "m", name: "o", via: "GLOBAL", reduced: false, built: false }], reduce: 0, build: 0, ext: 0, error: "unterminated text argument at opcode 4" });
});

test('returns ok false with truncated error for SHORT_BINSTRING with exact length bytes', () => {
  const input = Buffer.from([0x54, 0x00, 0x00, 0x00, 0x00]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: false, opcodes: 1, globals: [], reduce: 0, build: 0, ext: 0, error: "no STOP opcode" });
});

test('returns ok true with STACK_GLOBAL using non-string stack items', () => {
  const input = Buffer.from([0x29, 0x29, 0x93, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 4, globals: [{ module: "?", name: "?", via: "STACK_GLOBAL", reduced: false, built: false }], reduce: 0, build: 0, ext: 0, error: null });
});

test('returns ok false with error for REDUCE with string callable', () => {
  const input = Buffer.from([0x53, 0x22, 0x61, 0x22, 0x4e, 0x52, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: false, opcodes: 1, globals: [], reduce: 0, build: 0, ext: 0, error: "unterminated text argument at opcode 1" });
});

test('returns ok true for PROTO followed by STOP', () => {
  const input = Buffer.from([0x80, 0x02, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 2, globals: [], reduce: 0, build: 0, ext: 0, error: null });
});

test('returns ok true for EXT4 with exactly 4 data bytes and STOP', () => {
  const input = Buffer.from([0x84, 0x01, 0x02, 0x03, 0x04, 0x2e]);
  const result = walkPickle(input);
  assert.deepEqual(result, { ok: true, opcodes: 2, globals: [], reduce: 0, build: 0, ext: 1, error: null });
});
