// node --test lib/test/der.test.mjs — the DER subset: encodings against known bytes, and the strictness the decoder owes a signature check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as der from '../der.mjs';

const hex = (b) => Buffer.from(b).toString('hex');

test('INTEGER is minimal two\'s complement for non-negative values', () => {
  assert.equal(hex(der.int(0)), '020100');
  assert.equal(hex(der.int(127)), '02017f');
  assert.equal(hex(der.int(128)), '02020080');
  assert.equal(hex(der.int(256)), '02020100');
  assert.equal(hex(der.int(Buffer.from('0000ff', 'hex'))), '020200ff');
  assert.throws(() => der.int(-1), der.DerError);
  for (const v of [0n, 1n, 127n, 128n, 0xffffffffffffffffn]) assert.equal(der.readInt(der.decode(der.int(v))), v);
});

test('OID encodes and round-trips, including multi-byte arcs', () => {
  assert.equal(hex(der.oid('2.16.840.1.101.3.4.2.1')), '0609608648016503040201');
  for (const o of ['1.2.840.113549.1.9.16.1.4', '1.3.101.112', '2.999.1']) assert.equal(der.readOid(der.decode(der.oid(o))), o);
});

test('long-form lengths are minimal and decode back', () => {
  const big = der.octets(Buffer.alloc(300));
  assert.equal(hex(big.subarray(0, 4)), '0482012c');
  assert.equal(der.decode(big).content.length, 300);
});

test('the decoder refuses BER and malformed input rather than guessing', () => {
  assert.throws(() => der.decode(Buffer.from('3080000000', 'hex')), /indefinite length/);
  assert.throws(() => der.decode(Buffer.from('04810100', 'hex')), /non-minimal length/);
  assert.throws(() => der.decode(Buffer.from('0401000000', 'hex')), /trailing byte/);
  assert.throws(() => der.decode(Buffer.from('0405aa', 'hex')), /overruns/);
  assert.throws(() => der.readInt(der.decode(Buffer.from('0202007f', 'hex'))), /non-minimal/);
  assert.throws(() => der.readBool(der.decode(Buffer.from('010101', 'hex'))), /not a DER BOOLEAN/);
});

test('SET OF is sorted by encoding', () => {
  assert.equal(hex(der.set(der.int(2), der.int(1))), '3106020101020102');
});

test('GeneralizedTime keeps fractional seconds without trailing zeros; UTCTime maps the century', () => {
  const g = der.genTime('2026-10-08T01:02:03.250Z');
  assert.equal(der.decode(g).content.toString(), '20261008010203.25Z');
  assert.equal(der.readTime(der.decode(g)).iso, '2026-10-08T01:02:03.250Z');
  assert.equal(der.readTime(der.decode(der.utcTime('2049-12-31T00:00:00Z'))).iso, '2049-12-31T00:00:00.000Z');
  assert.throws(() => der.readTime(der.decode(der.tlv(der.TAG.GENTIME, Buffer.from('20261008010203.250Z')))), /not a DER/);
});
