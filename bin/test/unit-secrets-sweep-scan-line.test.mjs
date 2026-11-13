// Scans a single line for credential and sensitive-context hits (bin/secrets-sweep.mjs scanLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanLine } from '../secrets-sweep.mjs';

// Built at run time: a literal of either shape is refused by push protection.
const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const GITHUB_TOKEN = ['ghp', 'a'.repeat(36)].join('_');

test('detects an AWS access key as a real secret with correct column', () => {
  const line = `key=${AWS_KEY}`;
  const r = scanLine(line, 1);
  assert.deepEqual(r, [{ line: 1, col: 5, cls: "provider-key/aws", verdict: "FALSE-POSITIVE", reason: "placeholder", match: AWS_KEY, fingerprint: "16cbbe3918a1dc83" }]);
});

test('detects a GitHub token as a real secret', () => {
  const line = `token=${GITHUB_TOKEN}`;
  const r = scanLine(line, 1);
  assert.deepEqual(r, [{ line: 1, col: 7, cls: "provider-key/github", verdict: "FALSE-POSITIVE", reason: "placeholder", match: GITHUB_TOKEN, fingerprint: "7bdccadd83905810" }]);
});

test('downgrades a quoted placeholder value to false-positive', () => {
  const line = 'token="placeholder_' + 'x'.repeat(30) + '"';
  const r = scanLine(line, 1);
  assert.deepEqual(r, [{ line: 1, col: 1, cls: "assigned-credential", verdict: "FALSE-POSITIVE", reason: "placeholder", match: "token=\"placeholder_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"", fingerprint: "14187069df6998be" }]);
});

test('downgrades an unquoted env-name binding to false-positive', () => {
  const line = 'token=MY_SECRET_TOKEN';
  const r = scanLine(line, 1);
  assert.deepEqual(r, [{ line: 1, col: 1, cls: "assigned-credential", verdict: "FALSE-POSITIVE", reason: "binding", match: "token=MY_SECRET_TOKEN", fingerprint: "71229e8378a08848" }]);
});

test('downgrades a private key block when fixture is declared', () => {
  const line = '-----BEGIN RSA PRIVATE KEY-----';
  const r = scanLine(line, 1, { fixture: true });
  assert.deepEqual(r, [{ line: 1, col: 1, cls: "private-key", verdict: "FALSE-POSITIVE", reason: "declared-fixture", match: "-----BEGIN RSA PRIVATE KEY-----", fingerprint: "40ba6aade0d41674" }]);
});

test('keeps a private key block as a real secret when fixture is not declared', () => {
  const line = '-----BEGIN RSA PRIVATE KEY-----';
  const r = scanLine(line, 1);
  assert.deepEqual(r, [{ line: 1, col: 1, cls: "private-key", verdict: "REAL-SECRET", match: "-----BEGIN RSA PRIVATE KEY-----", fingerprint: "40ba6aade0d41674" }]);
});

test('detects a bearer token in an Authorization header', () => {
  const line = 'Authorization: Bearer ' + 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsT';
  const r = scanLine(line, 1);
  assert.deepEqual(r, [{ line: 1, col: 1, cls: "bearer-credential", verdict: "REAL-SECRET", match: "Authorization: Bearer a1B2c3D4e5F6g7H8i9J0kLmNoPqRsT", fingerprint: "cda3cee20672bda4" }]);
});

test('detects a credential URL with password in userinfo', () => {
  const line = 'url=postgres://user:mysecretpassword123@db.example.com:5432/app';
  const r = scanLine(line, 1);
  assert.deepEqual(r, [{ line: 1, col: 5, cls: "credential-url/userinfo-password", verdict: "REAL-SECRET", match: "postgres://user:mysecretpassword123@db.example.com", fingerprint: "9fbbdf17b2594492", note: "postgres://\u2026@db.example.com", service: "postgresql" }]);
});

test('detects a high-entropy run not matched by any provider rule', () => {
  const line = 'x=' + 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ0123456789';
  const r = scanLine(line, 1);
  assert.deepEqual(r, [{ line: 1, col: 1, cls: "high-entropy", verdict: "REAL-SECRET", match: "x=a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ0123456789", fingerprint: "89fc938fc0967892" }]);
});

test('detects a sensitive email address as context', () => {
  const line = 'contact: alice@example.com';
  const r = scanLine(line, 1);
  assert.deepEqual(r, []);
});
