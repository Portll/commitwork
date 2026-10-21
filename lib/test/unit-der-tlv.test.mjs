// Builds a DER TLV buffer from a tag and content bytes (lib/der.mjs tlv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tlv } from '../der.mjs';

test('returns a single byte tag with zero-length content', () => {
  const result = tlv(0x02, []);
  assert.deepEqual(result, Buffer.from([0x02, 0x00]));
});

test('returns tag and short length for content under 128 bytes', () => {
  const result = tlv(0x04, [0x01, 0x02, 0x03]);
  assert.deepEqual(result, Buffer.from([0x04, 0x03, 0x01, 0x02, 0x03]));
});

test('returns tag and short length for content of exactly 127 bytes', () => {
  const content = Array.from({ length: 127 }, (_, i) => i % 256);
  const result = tlv(0x05, content);
  assert.deepEqual(result, Buffer.from([0x05, 0x7f, ...content]));
});

test('returns tag and long length marker for content of 128 bytes', () => {
  const content = Array.from({ length: 128 }, (_, i) => i % 256);
  const result = tlv(0x06, content);
  assert.deepEqual(result, Buffer.from([0x06, 0x81, 0x80, ...content]));
});

test('returns tag and long length with two bytes for content of 256 bytes', () => {
  const content = Array.from({ length: 256 }, (_, i) => i % 256);
  const result = tlv(0x07, content);
  assert.deepEqual(result, Buffer.from([0x07, 0x82, 0x01, 0x00, ...content]));
});

test('returns tag and long length with two bytes for content of 300 bytes', () => {
  const content = Array.from({ length: 300 }, (_, i) => i % 256);
  const result = tlv(0x08, content);
  assert.deepEqual(result, Buffer.from([0x08, 0x82, 0x01, 0x2c, ...content]));
});

test('returns tag and long length with three bytes for content of 65536 bytes', () => {
  const content = Array.from({ length: 65536 }, (_, i) => i % 256);
  const result = tlv(0x09, content);
  assert.deepEqual(result, Buffer.from([0x09, 0x83, 0x01, 0x00, 0x00, ...content]));
});

test('returns tag and long length with three bytes for content of 100000 bytes', () => {
  const content = Array.from({ length: 100000 }, (_, i) => i % 256);
  const result = tlv(0x0a, content);
  assert.deepEqual(result, Buffer.from([0x0a, 0x83, 0x01, 0x86, 0xa0, ...content]));
});
