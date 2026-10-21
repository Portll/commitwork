// Decodes a CBOR buffer into a JavaScript value, rejecting trailing bytes by default (lib/webauthn.mjs decodeCbor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCbor } from '../webauthn.mjs';

test('decodes a small unsigned integer', () => {
  const buf = Buffer.from([0x05]);
  assert.equal(decodeCbor(buf), 5);
});

test('decodes a negative integer', () => {
  const buf = Buffer.from([0x20]);
  assert.equal(decodeCbor(buf), -1);
});

test('decodes a byte string', () => {
  const buf = Buffer.from([0x42, 0x01, 0x02]);
  const result = decodeCbor(buf);
  assert.ok(Buffer.isBuffer(result));
  assert.deepEqual(result, Buffer.from([0x01, 0x02]));
});

test('decodes a text string', () => {
  const buf = Buffer.from([0x62, 0x68, 0x69]);
  assert.equal(decodeCbor(buf), 'hi');
});

test('decodes an array', () => {
  const buf = Buffer.from([0x82, 0x01, 0x02]);
  assert.deepEqual(decodeCbor(buf), [1, 2]);
});

test('decodes a map with negative integer keys', () => {
  const buf = Buffer.from([0xa1, 0x20, 0x01]);
  const result = decodeCbor(buf);
  assert.ok(result instanceof Map);
  assert.equal(result.get(-1), 1);
});

test('throws on trailing bytes when requireExact is true', () => {
  const buf = Buffer.from([0x01, 0x02]);
  assert.throws(() => decodeCbor(buf), /trailing byte/);
});

test('allows trailing bytes when requireExact is false', () => {
  const buf = Buffer.from([0x01, 0x02]);
  assert.equal(decodeCbor(buf, { requireExact: false }), 1);
});

test('throws on truncated byte string', () => {
  const buf = Buffer.from([0x42, 0x01]);
  assert.throws(() => decodeCbor(buf), /byte string overruns buffer/);
});

test('throws on unsupported major type', () => {
  const buf = Buffer.from([0xf0]);
  assert.throws(() => decodeCbor(buf), /unsupported major type/);
});
