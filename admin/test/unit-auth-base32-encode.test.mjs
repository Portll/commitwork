// Encodes a byte sequence into a base32 string (admin/auth.mjs base32Encode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode } from '../auth.mjs';
import { Buffer } from 'node:buffer';

test('encodes an empty buffer to an empty string', () => {
  const input = Buffer.alloc(0);
  const result = base32Encode(input);
  assert.equal(result, "");
});

test('encodes a single zero byte', () => {
  const input = Buffer.from([0]);
  const result = base32Encode(input);
  assert.equal(result, "AA");
});

test('encodes a single byte with value 1', () => {
  const input = Buffer.from([1]);
  const result = base32Encode(input);
  assert.equal(result, "AE");
});

test('encodes a single byte with value 255', () => {
  const input = Buffer.from([255]);
  const result = base32Encode(input);
  assert.equal(result, "74");
});

test('encodes two bytes of zeros', () => {
  const input = Buffer.alloc(2, 0);
  const result = base32Encode(input);
  assert.equal(result, "AAAA");
});

test('encodes two bytes of 255', () => {
  const input = Buffer.alloc(2, 255);
  const result = base32Encode(input);
  assert.equal(result, "777Q");
});

test('encodes three bytes of zeros', () => {
  const input = Buffer.alloc(3, 0);
  const result = base32Encode(input);
  assert.equal(result, "AAAAA");
});

test('encodes three bytes of 255', () => {
  const input = Buffer.alloc(3, 255);
  const result = base32Encode(input);
  assert.equal(result, "77776");
});

test('encodes four bytes of zeros', () => {
  const input = Buffer.alloc(4, 0);
  const result = base32Encode(input);
  assert.equal(result, "AAAAAAA");
});

test('encodes four bytes of 255', () => {
  const input = Buffer.alloc(4, 255);
  const result = base32Encode(input);
  assert.equal(result, "777777Y");
});
