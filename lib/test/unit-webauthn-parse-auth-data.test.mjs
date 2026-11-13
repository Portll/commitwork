// parseAuthData returns parsed authenticator data with flags, attested credential data, and extensions (lib/webauthn.mjs parseAuthData).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthData } from '../webauthn.mjs';

function makeCoseKey() {
  const x = Buffer.alloc(32, 0x01);
  const y = Buffer.alloc(32, 0x02);
  const buf = Buffer.alloc(1 + 1 + 1 + 1 + 2 + 32 + 1 + 2 + 32);
  let o = 0;
  buf[o++] = 0xA3;
  buf[o++] = 0x03;
  buf[o++] = 0x26;
  buf[o++] = 0x21;
  buf[o++] = 0x58; buf[o++] = 0x20;
  x.copy(buf, o); o += 32;
  buf[o++] = 0x22;
  buf[o++] = 0x58; buf[o++] = 0x20;
  y.copy(buf, o); o += 32;
  return buf.subarray(0, o);
}

const COSE_KEY = makeCoseKey();

test('parseAuthData returns early when AT flag not set', () => {
  const buf = Buffer.alloc(37, 0);
  buf[32] = 0x01;
  const result = parseAuthData(buf);
  assert.deepEqual(result, { rpIdHash: Buffer.from("0000000000000000000000000000000000000000000000000000000000000000", 'hex'), flags: 1, signCount: 0, userPresent: true, userVerified: false, attested: false, extensionData: false });
});

test('parseAuthData throws when buffer shorter than 37 bytes', () => {
  const buf = Buffer.alloc(36, 0);
  assert.throws(() => parseAuthData(buf), '__expected__');
});

test('parseAuthData extracts rpIdHash from first 32 bytes', () => {
  const buf = Buffer.alloc(37, 0);
  for (let i = 0; i < 32; i++) buf[i] = i + 1;
  buf[32] = 0x01;
  const result = parseAuthData(buf);
  assert.deepEqual(result.rpIdHash, Buffer.from("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20", 'hex'));
});

test('parseAuthData throws when AT flag set but buffer shorter than 55 bytes', () => {
  const buf = Buffer.alloc(54, 0);
  buf[32] = 0x41;
  assert.throws(() => parseAuthData(buf), '__expected__');
});

test('parseAuthData parses attested credential data with zero-length credential ID', () => {
  const buf = Buffer.alloc(55 + COSE_KEY.length, 0);
  buf[32] = 0x41;
  COSE_KEY.copy(buf, 55);
  const result = parseAuthData(buf);
  assert.deepEqual(result, { rpIdHash: Buffer.from("0000000000000000000000000000000000000000000000000000000000000000", 'hex'), flags: 65, signCount: 0, userPresent: true, userVerified: false, attested: true, extensionData: false, aaguid: Buffer.from("00000000000000000000000000000000", 'hex'), credentialId: Buffer.from("", 'hex'), cose: new Map([[3, -7], [-2, Buffer.from("0101010101010101010101010101010101010101010101010101010101010101", 'hex')], [-3, Buffer.from("0202020202020202020202020202020202020202020202020202020202020202", 'hex')]]), publicKey: { jwk: { kty: "EC", crv: "P-256", x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", y: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI" }, alg: "ES256", hash: "sha256" }, extensionBytes: Buffer.from("", 'hex') });
});

test('parseAuthData parses attested credential data with non-zero credential ID and extension data', () => {
  const credId = Buffer.from('cred1234');
  const ext = Buffer.from('ext');
  const buf = Buffer.alloc(55 + credId.length + COSE_KEY.length + ext.length, 0);
  buf[32] = 0xC1;
  buf.writeUInt16BE(credId.length, 53);
  credId.copy(buf, 55);
  COSE_KEY.copy(buf, 55 + credId.length);
  ext.copy(buf, 55 + credId.length + COSE_KEY.length);
  const result = parseAuthData(buf);
  assert.deepEqual(result, { rpIdHash: Buffer.from("0000000000000000000000000000000000000000000000000000000000000000", 'hex'), flags: 193, signCount: 0, userPresent: true, userVerified: false, attested: true, extensionData: true, aaguid: Buffer.from("00000000000000000000000000000000", 'hex'), credentialId: Buffer.from("6372656431323334", 'hex'), cose: new Map([[3, -7], [-2, Buffer.from("0101010101010101010101010101010101010101010101010101010101010101", 'hex')], [-3, Buffer.from("0202020202020202020202020202020202020202020202020202020202020202", 'hex')]]), publicKey: { jwk: { kty: "EC", crv: "P-256", x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", y: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI" }, alg: "ES256", hash: "sha256" }, extensionBytes: Buffer.from("657874", 'hex') });
});

test('parseAuthData returns empty extensionBytes when no extension data present', () => {
  const credId = Buffer.from('cred');
  const buf = Buffer.alloc(55 + credId.length + COSE_KEY.length, 0);
  buf[32] = 0x41;
  buf.writeUInt16BE(credId.length, 53);
  credId.copy(buf, 55);
  COSE_KEY.copy(buf, 55 + credId.length);
  const result = parseAuthData(buf);
  assert.deepEqual(result.extensionBytes, Buffer.from("", 'hex'));
});

test('parseAuthData throws when credential ID length makes idEnd equal buffer length', () => {
  const credId = Buffer.alloc(10, 0xAA);
  const buf = Buffer.alloc(55 + credId.length, 0);
  buf[32] = 0x41;
  buf.writeUInt16BE(credId.length, 53);
  credId.copy(buf, 55);
  assert.throws(() => parseAuthData(buf), '__expected__');
});

test('parseAuthData correctly parses COSE key at start of rest buffer', () => {
  const credId = Buffer.from('id');
  const buf = Buffer.alloc(55 + credId.length + COSE_KEY.length, 0);
  buf[32] = 0x41;
  buf.writeUInt16BE(credId.length, 53);
  credId.copy(buf, 55);
  COSE_KEY.copy(buf, 55 + credId.length);
  const result = parseAuthData(buf);
  assert.deepEqual(result.publicKey, { jwk: { kty: "EC", crv: "P-256", x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", y: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI" }, alg: "ES256", hash: "sha256" });
});
