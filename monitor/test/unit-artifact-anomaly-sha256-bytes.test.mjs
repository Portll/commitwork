// Computes the SHA-256 hex digest of a buffer (monitor/artifact-anomaly.mjs sha256Bytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Bytes } from '../artifact-anomaly.mjs';

test('returns the sha256 hex digest of an empty buffer', () => {
  const r = sha256Bytes(Buffer.alloc(0));
  assert.equal(r, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test('returns the sha256 hex digest of a single zero byte', () => {
  const r = sha256Bytes(Buffer.alloc(1, 0));
  assert.equal(r, "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d");
});

test('returns the sha256 hex digest of the ascii string a', () => {
  const r = sha256Bytes(Buffer.from('a'));
  assert.equal(r, "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
});

test('returns the sha256 hex digest of a 64 byte buffer of x', () => {
  const r = sha256Bytes(Buffer.alloc(64, 0x78));
  assert.equal(r, "7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c");
});

test('returns the sha256 hex digest of a 1024 byte buffer of zeros', () => {
  const r = sha256Bytes(Buffer.alloc(1024, 0));
  assert.equal(r, "5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef");
});

test('returns the sha256 hex digest of a buffer with mixed byte values', () => {
  const r = sha256Bytes(Buffer.from([0, 1, 255, 128, 64, 32, 16, 8]));
  assert.equal(r, "d19a0ff1f4d01c1141bd1565bc605e1323ad997f262a7d4b7c71d09aa3b608a4");
});

test('returns the sha256 hex digest of a 16 byte buffer of 0xff', () => {
  const r = sha256Bytes(Buffer.alloc(16, 0xff));
  assert.equal(r, "5ac6a5945f16500911219129984ba8b387a06f24fe383ce4e81a73294065461b");
});

test('returns the sha256 hex digest of a 32 byte buffer of 0x41', () => {
  const r = sha256Bytes(Buffer.alloc(32, 0x41));
  assert.equal(r, "22a48051594c1949deed7040850c1f0f8764537f5191be56732d16a54c1d8153");
});
