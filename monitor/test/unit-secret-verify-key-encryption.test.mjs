// Classifies key text as encrypted, plaintext, or unrecognised (monitor/secret-verify.mjs keyEncryption).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyEncryption } from '../secret-verify.mjs';

test('returns encrypted for PKCS8 armor', () => {
  const input = '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB\n-----END ENCRYPTED PRIVATE KEY-----';
  assert.equal(keyEncryption(input), "encrypted");
});

test('returns encrypted for Proc-Type 4 ENCRYPTED header', () => {
  const input = 'Proc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,abc\nMIIB';
  assert.equal(keyEncryption(input), "encrypted");
});

test('returns encrypted for DEK-Info line', () => {
  const input = 'DEK-Info: AES-256-CBC,abcdef\nMIIB';
  assert.equal(keyEncryption(input), "encrypted");
});

test('returns plaintext for RSA private key armor', () => {
  const input = '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----';
  assert.equal(keyEncryption(input), "plaintext");
});

test('returns plaintext for EC private key armor', () => {
  const input = '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----';
  assert.equal(keyEncryption(input), "plaintext");
});

test('returns plaintext for DSA private key armor', () => {
  const input = '-----BEGIN DSA PRIVATE KEY-----\nMIIB\n-----END DSA PRIVATE KEY-----';
  assert.equal(keyEncryption(input), "plaintext");
});

test('returns plaintext for OPENSSH private key armor', () => {
  const input = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n-----END OPENSSH PRIVATE KEY-----';
  assert.equal(keyEncryption(input), "plaintext");
});

test('returns plaintext for bare PRIVATE KEY armor', () => {
  const input = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----';
  assert.equal(keyEncryption(input), "plaintext");
});

test('returns empty string for unrecognised text', () => {
  const input = 'hello world';
  assert.equal(keyEncryption(input), "");
});

test('returns empty string for null input', () => {
  assert.equal(keyEncryption(null), "");
});
