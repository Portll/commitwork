// Builds a TSP TimeStampReq DER structure with SHA-256 imprint and nonce (cra/timestamp.mjs buildRequest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from '../timestamp.mjs';
import { Buffer } from 'node:buffer';

test('returns request with certReq true by default when nonce provided', () => {
  const input = Buffer.from('hello');
  const nonce = Buffer.from('0102030405060708', 'hex');
  const result = buildRequest(input, { nonce });
  assert.deepEqual(result, { der: Buffer.from("30430201013031300d0609608648016503040201050004202cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824020801020304050607080101ff", 'hex'), imprint: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", nonce: "102030405060708" });
});

test('returns request without certReq when certReq false', () => {
  const input = Buffer.from('hello');
  const nonce = Buffer.from('0102030405060708', 'hex');
  const result = buildRequest(input, { nonce, certReq: false });
  assert.deepEqual(result, { der: Buffer.from("30400201013031300d0609608648016503040201050004202cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b982402080102030405060708", 'hex'), imprint: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", nonce: "102030405060708" });
});

test('returns request with 9-byte nonce', () => {
  const input = Buffer.from('data');
  const nonce = Buffer.from('010203040506070809', 'hex');
  const result = buildRequest(input, { nonce });
  assert.deepEqual(result, { der: Buffer.from("30440201013031300d0609608648016503040201050004203a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b702090102030405060708090101ff", 'hex'), imprint: "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7", nonce: "10203040506070809" });
});

test('returns request with empty nonce as zero integer', () => {
  const input = Buffer.from('data');
  const nonce = Buffer.alloc(0);
  const result = buildRequest(input, { nonce });
  assert.deepEqual(result, { der: Buffer.from("303c0201013031300d0609608648016503040201050004203a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b70201000101ff", 'hex'), imprint: "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7", nonce: "0" });
});

test('computes correct imprint for empty record bytes', () => {
  const input = Buffer.alloc(0);
  const nonce = Buffer.from('aabbccdd', 'hex');
  const result = buildRequest(input, { nonce });
  assert.deepEqual(result, { der: Buffer.from("30400201013031300d060960864801650304020105000420e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855020500aabbccdd0101ff", 'hex'), imprint: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", nonce: "aabbccdd" });
});

test('computes correct imprint for non-empty record bytes', () => {
  const input = Buffer.alloc(16, 0xff);
  const nonce = Buffer.from('1122334455667788', 'hex');
  const result = buildRequest(input, { nonce });
  assert.deepEqual(result, { der: Buffer.from("30430201013031300d0609608648016503040201050004205ac6a5945f16500911219129984ba8b387a06f24fe383ce4e81a73294065461b020811223344556677880101ff", 'hex'), imprint: "5ac6a5945f16500911219129984ba8b387a06f24fe383ce4e81a73294065461b", nonce: "1122334455667788" });
});

test('returns request with certReq true when explicitly set', () => {
  const input = Buffer.from('test');
  const nonce = Buffer.from('deadbeef', 'hex');
  const result = buildRequest(input, { nonce, certReq: true });
  assert.deepEqual(result, { der: Buffer.from("30400201013031300d0609608648016503040201050004209f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08020500deadbeef0101ff", 'hex'), imprint: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", nonce: "deadbeef" });
});
