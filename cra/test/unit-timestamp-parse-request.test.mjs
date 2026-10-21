// Parses a DER-encoded TimeStampReq into its fields (cra/timestamp.mjs parseRequest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../timestamp.mjs';

function encodeInt(value) {
  if (value === 0n) return Buffer.from([0x02, 0x01, 0x00]);
  const bytes = [];
  let v = value;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return Buffer.concat([Buffer.from([0x02, bytes.length]), Buffer.from(bytes)]);
}

function encodeBool(value) {
  return Buffer.from([0x01, 0x01, value ? 0xff : 0x00]);
}

function encodeOid(oid) {
  const parts = oid.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const enc = [];
    while (v >= 128) {
      enc.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    enc.unshift(v);
    bytes.push(...enc);
  }
  return Buffer.concat([Buffer.from([0x06, bytes.length]), Buffer.from(bytes)]);
}

function encodeOctetString(hex) {
  const buf = Buffer.from(hex, 'hex');
  return Buffer.concat([Buffer.from([0x04, buf.length]), buf]);
}

function encodeSequence(children) {
  const content = Buffer.concat(children);
  return Buffer.concat([Buffer.from([0x30, content.length]), content]);
}

function buildRequest(version, hashAlgOid, hashedHex, nonce, certReq) {
  const versionBuf = encodeInt(version);
  const algId = encodeSequence([encodeOid(hashAlgOid)]);
  const hashed = encodeOctetString(hashedHex);
  const mi = encodeSequence([algId, hashed]);
  const children = [versionBuf, mi];
  if (nonce !== null) children.push(encodeInt(nonce));
  if (certReq !== undefined) children.push(encodeBool(certReq));
  return encodeSequence(children);
}

test('parses a minimal TimeStampReq with version 1, a hash imprint, no nonce, no certReq', () => {
  const buf = buildRequest(1n, '1.3.14.3.2.26', 'aabbccdd', null, undefined);
  const result = parseRequest(buf);
  assert.deepEqual(result, {
    hashAlg: '1.3.14.3.2.26',
    imprint: 'aabbccdd',
    nonce: null,
    certReq: false
  });
});

test('parses a TimeStampReq with a nonce and certReq true', () => {
  const buf = buildRequest(1n, '1.3.14.3.2.26', 'aabbccdd', 12345n, true);
  const result = parseRequest(buf);
  assert.deepEqual(result, {
    hashAlg: '1.3.14.3.2.26',
    imprint: 'aabbccdd',
    nonce: '3039',
    certReq: true
  });
});

test('parses a TimeStampReq with a nonce and certReq false', () => {
  const buf = buildRequest(1n, '1.3.14.3.2.26', 'aabbccdd', 12345n, false);
  const result = parseRequest(buf);
  assert.deepEqual(result, {
    hashAlg: '1.3.14.3.2.26',
    imprint: 'aabbccdd',
    nonce: '3039',
    certReq: false
  });
});

test('parses a TimeStampReq with a different hash algorithm OID', () => {
  const buf = buildRequest(1n, '1.3.14.3.2.29', 'deadbeef', null, undefined);
  const result = parseRequest(buf);
  assert.deepEqual(result, {
    hashAlg: '1.3.14.3.2.29',
    imprint: 'deadbeef',
    nonce: null,
    certReq: false
  });
});

test('rejects a TimeStampReq with version 2', () => {
  const buf = buildRequest(2n, '1.3.14.3.2.26', 'aabbccdd', null, undefined);
  assert.throws(() => parseRequest(buf), {
    name: 'Error',
    code: 'invalid',
    message: 'TimeStampReq.version is not 1'
  });
});

test('rejects a TimeStampReq with version 0', () => {
  const buf = buildRequest(0n, '1.3.14.3.2.26', 'aabbccdd', null, undefined);
  assert.throws(() => parseRequest(buf), {
    name: 'Error',
    code: 'invalid',
    message: 'TimeStampReq.version is not 1'
  });
});

test('parses a TimeStampReq with a zero nonce', () => {
  const buf = buildRequest(1n, '1.3.14.3.2.26', 'aabbccdd', 0n, undefined);
  const result = parseRequest(buf);
  assert.deepEqual(result, {
    hashAlg: '1.3.14.3.2.26',
    imprint: 'aabbccdd',
    nonce: '0',
    certReq: false
  });
});

test('parses a TimeStampReq with a large nonce', () => {
  const buf = buildRequest(1n, '1.3.14.3.2.26', 'aabbccdd', 0x1234567890abcdefn, undefined);
  const result = parseRequest(buf);
  assert.deepEqual(result, {
    hashAlg: '1.3.14.3.2.26',
    imprint: 'aabbccdd',
    nonce: '1234567890abcdef',
    certReq: false
  });
});
