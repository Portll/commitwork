// gzipOf compresses a buffer with maximum gzip compression, clears the CRC and sets a marker byte (bin/release-build.mjs gzipOf).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipOf } from '../release-build.mjs';

test('gzipOf returns a Buffer that is not the same instance as the input', () => {
  const input = Buffer.from('test');
  const output = gzipOf(input);
  assert.ok(Buffer.isBuffer(output));
  assert.notStrictEqual(output, input);
});

test('gzipOf produces a gzip header with flags byte 0 and zeroed CRC (bytes 4-7)', () => {
  const input = Buffer.from('hello world');
  const output = gzipOf(input);
  assert.strictEqual(output[3], 0);
  assert.strictEqual(output.readUInt32LE(4), 0);
});

test('gzipOf sets the marker byte at index 9 to 0xff', () => {
  const input = Buffer.from('another test');
  const output = gzipOf(input);
  assert.strictEqual(output[9], 0xff);
});

test('gzipOf correctly compresses an empty buffer and sets header fields appropriately', () => {
  const input = Buffer.alloc(0);
  const output = gzipOf(input);
  assert.strictEqual(output[3], 0);
  assert.strictEqual(output.readUInt32LE(4), 0);
  assert.strictEqual(output[9], 0xff);
});

test('gzipOf preserves the compressed data length for a large input', () => {
  const input = Buffer.alloc(1024 * 10, 'a');
  const output = gzipOf(input);
  assert.ok(output.length < input.length);
});
