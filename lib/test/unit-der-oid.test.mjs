// Encodes a dotted OID string as a DER TLV buffer (lib/der.mjs oid).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oid, DerError } from '../der.mjs';

test('encodes a simple two-arc OID with a single byte content', () => {
  const result = oid('1.2');
  assert.deepEqual(result, Buffer.from([0x06, 0x01, 0x2a]));
});

test('encodes a three-arc OID with multi-byte base encoding', () => {
  const result = oid('1.2.840');
  assert.deepEqual(result, Buffer.from([0x06, 0x03, 0x2a, 0x86, 0x48]));
});

test('encodes a four-arc OID with large values requiring multiple bytes', () => {
  const result = oid('1.2.840.113556');
  assert.deepEqual(result, Buffer.from([0x06, 0x06, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x14]));
});

test('throws DerError for a single arc OID', () => {
  assert.throws(() => oid('1'), DerError);
});

test('throws DerError for an empty string OID', () => {
  assert.throws(() => oid(''), DerError);
});

test('encodes OID with zero in the second arc', () => {
  const result = oid('1.0');
  assert.deepEqual(result, Buffer.from([0x06, 0x01, 0x28]));
});

test('encodes OID with zero in the third arc', () => {
  const result = oid('1.2.0');
  assert.deepEqual(result, Buffer.from([0x06, 0x02, 0x2a, 0x00]));
});

test('encodes OID with first arc 2', () => {
  const result = oid('2.5');
  assert.deepEqual(result, Buffer.from([0x06, 0x01, 0x55]));
});
