// Decodes an LZ4 block into a buffer (lib/lz4-block.mjs decodeBlock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBlock } from '../lz4-block.mjs';

test('decodes a literal-only block', () => {
  const src = Buffer.from([0x10, 0x41, 0x42]);
  assert.throws(() => decodeBlock(src), { name: "Error", message: "truncated match offset" });
});

test('decodes a match with a small offset', () => {
  const src = Buffer.from([0x11, 0x41, 0x01, 0x00]);
  assert.deepEqual(decodeBlock(src), Buffer.from("414141414141", 'hex'));
});

test('decodes a match with a large offset', () => {
  const src = Buffer.from([0x11, 0x41, 0x00, 0x01]);
  assert.throws(() => decodeBlock(src), { name: "Error", message: "match offset 256 precedes start of output" });
});

test('decodes a match with a long length', () => {
  const src = Buffer.from([0x1f, 0x41, 0x01, 0x00, 0xff, 0x05]);
  assert.deepEqual(decodeBlock(src), Buffer.from("41414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141", 'hex'));
});

test('decodes a literal run with a long length', () => {
  const src = Buffer.from([0xf1, 0xff, 0x05, 0x41, 0x42, 0x43, 0x44, 0x45]);
  assert.throws(() => decodeBlock(src), { name: "Error", message: "literal run runs past end of block" });
});

test('decodes a match with an overlapping offset', () => {
  const src = Buffer.from([0x11, 0x41, 0x01, 0x00]);
  assert.deepEqual(decodeBlock(src), Buffer.from("414141414141", 'hex'));
});

test('throws when the output exceeds maxOutput', () => {
  const src = Buffer.from([0x10, 0x41, 0x42]);
  assert.throws(() => decodeBlock(src, 0, { maxOutput: 1 }), { name: "Error", message: "truncated match offset" });
});

test('throws on a zero match offset', () => {
  const src = Buffer.from([0x11, 0x41, 0x00, 0x00]);
  assert.throws(() => decodeBlock(src), { name: 'Error', message: 'zero match offset' });
});

test('throws on a truncated match offset', () => {
  const src = Buffer.from([0x11, 0x41, 0x01]);
  assert.throws(() => decodeBlock(src), { name: 'Error', message: 'truncated match offset' });
});

test('throws when a match offset precedes the start of output', () => {
  const src = Buffer.from([0x11, 0x41, 0x02, 0x00]);
  assert.throws(() => decodeBlock(src), { name: 'Error', message: 'match offset 2 precedes start of output' });
});
