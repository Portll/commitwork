// Computes signature and certificate paths from a checksums value (lib/release-signing.mjs signingAssets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signingAssets } from '../release-signing.mjs';

test('returns checksums, signature, and certificate for a simple string', () => {
  const r = signingAssets({ checksums: 'abc' });
  assert.deepEqual(r, { checksums: "abc", signature: "abc.sig", certificate: "abc.pem" });
});

test('returns checksums, signature, and certificate for a long repeated string', () => {
  const r = signingAssets({ checksums: 'x'.repeat(100) });
  assert.deepEqual(r, { checksums: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", signature: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.sig", certificate: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.pem" });
});

test('returns checksums, signature, and certificate for an empty string', () => {
  const r = signingAssets({ checksums: '' });
  assert.deepEqual(r, { checksums: "", signature: ".sig", certificate: ".pem" });
});

test('returns checksums, signature, and certificate for a numeric checksums value', () => {
  const r = signingAssets({ checksums: 12345 });
  assert.deepEqual(r, { checksums: 12345, signature: "12345.sig", certificate: "12345.pem" });
});

test('returns checksums, signature, and certificate for a zero checksums value', () => {
  const r = signingAssets({ checksums: 0 });
  assert.deepEqual(r, { checksums: 0, signature: "0.sig", certificate: "0.pem" });
});

test('returns checksums, signature, and certificate for a boolean checksums value', () => {
  const r = signingAssets({ checksums: true });
  assert.deepEqual(r, { checksums: true, signature: "true.sig", certificate: "true.pem" });
});

test('returns checksums, signature, and certificate for a null checksums value', () => {
  const r = signingAssets({ checksums: null });
  assert.deepEqual(r, { checksums: null, signature: "null.sig", certificate: "null.pem" });
});

test('returns checksums, signature, and certificate for a checksums with special characters', () => {
  const r = signingAssets({ checksums: 'a-b_c.d/e' });
  assert.deepEqual(r, { checksums: "a-b_c.d/e", signature: "a-b_c.d/e.sig", certificate: "a-b_c.d/e.pem" });
});
