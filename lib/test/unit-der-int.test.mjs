// DER encoding of a non-negative INTEGER (lib/der.mjs int).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { int, DerError } from '../der.mjs';
import { Buffer } from 'node:buffer';

function lengthBytes(n) {
  if (n < 0x80) return Buffer.from([n]);
  const out = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return Buffer.from([0x80 | out.length, ...out]);
}
function tlv(tag, content) {
  const body = Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(body.length), body]);
}

test('int encodes the number 0 as a single zero byte', () => {
  const got = int(0);
  const exp = tlv(0x02, Buffer.from([0]));
  assert.deepStrictEqual(got, exp);
});

test('int encodes 127 without a leading zero', () => {
  const got = int(127);
  const exp = tlv(0x02, Buffer.from([0x7f]));
  assert.deepStrictEqual(got, exp);
});

test('int encodes 128 with a leading zero to keep it positive', () => {
  const got = int(128);
  const exp = tlv(0x02, Buffer.from([0x00, 0x80]));
  assert.deepStrictEqual(got, exp);
});

test('int trims leading zeros from a Buffer input', () => {
  const src = Buffer.from([0x00, 0x00, 0x01, 0x02]);
  const got = int(src);
  const exp = tlv(0x02, Buffer.from([0x01, 0x02]));
  assert.deepStrictEqual(got, exp);
});

test('int adds a leading zero when trimmed Buffer starts with 0x80', () => {
  const src = Buffer.from([0x00, 0x80, 0x01]);
  const got = int(src);
  const exp = tlv(0x02, Buffer.from([0x00, 0x80, 0x01]));
  assert.deepStrictEqual(got, exp);
});

test('int throws DerError for negative numbers', () => {
  assert.throws(() => int(-1), DerError);
});

test('int uses long-form length encoding for content longer than 127 bytes', () => {
  const mag = Buffer.alloc(130, 0x01);
  const got = int(mag);
  const exp = tlv(0x02, mag);
  assert.deepStrictEqual(got, exp);
  const lengthField = got.slice(1, 1 + lengthBytes(130).length);
  assert.deepStrictEqual(lengthField, Buffer.from([0x81, 0x82]));
});

test('int encodes a large bigint with leading zero and long-form length', () => {
  const big = (1n << 200n) - 1n;
  const got = int(big);
  const raw = Buffer.alloc(25, 0xff);
  const expectedMag = Buffer.concat([Buffer.from([0x00]), raw]);
  const exp = tlv(0x02, expectedMag);
  assert.deepStrictEqual(got, exp);
});
