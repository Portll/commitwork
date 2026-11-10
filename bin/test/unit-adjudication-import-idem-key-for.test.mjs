// Computes a sha256 idempotency key from identity parts and annotation fields (bin/adjudication-import.mjs idemKeyFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idemKeyFor } from '../adjudication-import.mjs';
import { createHash } from 'node:crypto';

function expectedKey(identityParts, a) {
  const basis = { ...identityParts, action: a.action, reason: a.reason, who: a.who, at: a.at, expires: a.expires ?? null };
  return createHash('sha256').update(JSON.stringify(basis)).digest('hex');
}

test('returns a 64-character hex string for a minimal annotation', () => {
  const key = idemKeyFor({ id: 'f1' }, { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' });
  assert.equal(key.length, 64);
  assert.match(key, /^[0-9a-f]{64}$/);
});

test('produces the same key for identical inputs', () => {
  const parts = { id: 'f1', scanner: 's1' };
  const a = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  assert.equal(idemKeyFor(parts, a), idemKeyFor(parts, a));
});

test('produces a different key when the reason changes', () => {
  const parts = { id: 'f1' };
  const a1 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  const a2 = { action: 'approve', reason: 'edited', who: 'alice', at: '2024-01-01T00:00:00Z' };
  assert.notEqual(idemKeyFor(parts, a1), idemKeyFor(parts, a2));
});

test('produces a different key when the who field changes', () => {
  const parts = { id: 'f1' };
  const a1 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  const a2 = { action: 'approve', reason: 'ok', who: 'bob', at: '2024-01-01T00:00:00Z' };
  assert.notEqual(idemKeyFor(parts, a1), idemKeyFor(parts, a2));
});

test('produces a different key when the at timestamp changes', () => {
  const parts = { id: 'f1' };
  const a1 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  const a2 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-02T00:00:00Z' };
  assert.notEqual(idemKeyFor(parts, a1), idemKeyFor(parts, a2));
});

test('produces a different key when the action changes', () => {
  const parts = { id: 'f1' };
  const a1 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  const a2 = { action: 'reject', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  assert.notEqual(idemKeyFor(parts, a1), idemKeyFor(parts, a2));
});

test('treats undefined expires as null in the hash basis', () => {
  const parts = { id: 'f1' };
  const a1 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  const a2 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z', expires: null };
  assert.equal(idemKeyFor(parts, a1), idemKeyFor(parts, a2));
});

test('produces a different key when expires is set versus null', () => {
  const parts = { id: 'f1' };
  const a1 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  const a2 = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z', expires: '2025-01-01T00:00:00Z' };
  assert.notEqual(idemKeyFor(parts, a1), idemKeyFor(parts, a2));
});

test('produces a different key when identity parts differ', () => {
  const a = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  assert.notEqual(idemKeyFor({ id: 'f1' }, a), idemKeyFor({ id: 'f2' }, a));
});

test('matches the manually computed sha256 of the JSON basis', () => {
  const parts = { id: 'f1', scanner: 's1' };
  const a = { action: 'approve', reason: 'ok', who: 'alice', at: '2024-01-01T00:00:00Z' };
  const basis = { ...parts, action: a.action, reason: a.reason, who: a.who, at: a.at, expires: a.expires ?? null };
  const expected = createHash('sha256').update(JSON.stringify(basis)).digest('hex');
  assert.equal(idemKeyFor(parts, a), expected);
});
