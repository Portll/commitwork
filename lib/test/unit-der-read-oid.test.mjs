// readOid parses an ASN.1 OBJECT IDENTIFIER into dotted decimal string (lib/der.mjs readOid).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOid, TAG, DerError } from '../der.mjs';

test('throws when node is missing', () => {
  assert.throws(() => readOid(undefined), err => {
    assert(err instanceof DerError);
    assert.strictEqual(err.message, 'OID: missing');
    return true;
  });
});

test('throws when node tag is not OID', () => {
  const node = { tag: TAG.INTEGER, content: new Uint8Array([0x01]) };
  assert.throws(() => readOid(node), err => {
    assert(err instanceof DerError);
    assert.strictEqual(err.message, 'OID: expected tag 0x6, got 0x2');
    return true;
  });
});

test('throws when content is malformed (last byte has continuation bit)', () => {
  const node = { tag: TAG.OID, content: new Uint8Array([0x2a, 0x86, 0x48, 0x80]) };
  assert.throws(() => readOid(node), err => {
    assert(err instanceof DerError);
    assert.strictEqual(err.message, 'OID: malformed');
    return true;
  });
});

test('throws when a non-minimal arc is encoded (0x80 as first byte of an arc)', () => {
  const node = { tag: TAG.OID, content: new Uint8Array([0x80, 0x01]) };
  assert.throws(() => readOid(node), err => {
    assert(err instanceof DerError);
    assert.strictEqual(err.message, 'OID: non-minimal arc');
    return true;
  });
});

test('parses a typical OID 1.2.840.113549', () => {
  const node = { tag: TAG.OID, content: new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d]) };
  assert.strictEqual(readOid(node), '1.2.840.113549');
});

test('computes first arc 0 when first value < 40 (OID 0.9)', () => {
  const node = { tag: TAG.OID, content: new Uint8Array([0x09]) };
  assert.strictEqual(readOid(node), '0.9');
});

test('computes first arc 1 when 40 \u2264 first value < 80 (OID 1.5)', () => {
  const node = { tag: TAG.OID, content: new Uint8Array([0x2d]) };
  assert.strictEqual(readOid(node), '1.5');
});

test('computes first arc 2 when first value \u2265 80 (OID 2.100)', () => {
  const node = { tag: TAG.OID, content: new Uint8Array([0x81, 0x34]) };
  assert.strictEqual(readOid(node), '2.100');
});

test('parses multi-byte first arc and subsequent arcs (OID 2.200.3)', () => {
  const node = { tag: TAG.OID, content: new Uint8Array([0x82, 0x18, 0x03]) };
  assert.strictEqual(readOid(node), '2.200.3');
});

test('parses an OID containing a very large arc using BigInt arithmetic', () => {
  const large = 12345678901234567890n;
  function encodeArc(v) {
    const parts = [];
    do {
      parts.unshift(Number(v & 0x7fn));
      v >>= 7n;
    } while (v > 0n);
    for (let i = 0; i < parts.length - 1; i++) parts[i] |= 0x80;
    return parts;
  }
  const firstCombined = 80n;
  const encoded = [Number(firstCombined), ...encodeArc(large)];
  const node = { tag: TAG.OID, content: new Uint8Array(encoded) };
  assert.strictEqual(readOid(node), `2.0.${large.toString()}`);
});
