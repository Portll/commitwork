// Computes a stable identity string from a credential (bin/bola-run.mjs subjectOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectOf } from '../bola-run.mjs';
import { createHash } from 'node:crypto';

const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const b64url = (s) => Buffer.from(s).toString('base64url');

test('returns null for empty string input', () => {
  assert.equal(subjectOf(''), null);
});

test('returns null for undefined input', () => {
  assert.equal(subjectOf(undefined), null);
});

test('returns null for null input', () => {
  assert.equal(subjectOf(null), null);
});

test('returns key fingerprint for non-Bearer material', () => {
  const mat = 'secret-token-abc123';
  assert.equal(subjectOf(mat), 'key:' + fp(mat));
});

test('returns sub claim for valid Bearer JWT with sub', () => {
  const payload = b64url(JSON.stringify({ sub: 'user-123' }));
  const mat = `Bearer header.${payload}.signature`;
  assert.equal(subjectOf(mat), 'sub:user-123');
});

test('returns key fingerprint for Bearer JWT with empty sub', () => {
  const payload = b64url(JSON.stringify({ sub: '' }));
  const mat = `Bearer header.${payload}.signature`;
  assert.equal(subjectOf(mat), 'key:' + fp(mat));
});

test('returns key fingerprint for Bearer JWT with missing sub', () => {
  const payload = b64url(JSON.stringify({ name: 'test' }));
  const mat = `Bearer header.${payload}.signature`;
  assert.equal(subjectOf(mat), 'key:' + fp(mat));
});

test('returns key fingerprint for Bearer JWT with invalid base64 payload', () => {
  const mat = 'Bearer header.!!!invalid!!!.signature';
  assert.equal(subjectOf(mat), 'key:' + fp(mat));
});

test('returns key fingerprint for Bearer JWT with invalid JSON payload', () => {
  const payload = b64url('not-json');
  const mat = `Bearer header.${payload}.signature`;
  assert.equal(subjectOf(mat), 'key:' + fp(mat));
});

test('returns key fingerprint for Bearer token without dots', () => {
  const mat = 'Bearer justatoken';
  assert.equal(subjectOf(mat), 'key:' + fp(mat));
});
