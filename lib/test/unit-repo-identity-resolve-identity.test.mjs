// Resolves a v4 UUID to its identity reference (lib/repo-identity.mjs resolveIdentity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity } from '../repo-identity.mjs';

test('returns bad-identity for a non-UUID string', () => {
  const r = resolveIdentity('not-a-uuid');
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "\"not-a-uuid\" is not a v4 UUID" });
});

test('returns bad-identity for an empty string', () => {
  const r = resolveIdentity('');
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "\"\" is not a v4 UUID" });
});

test('returns bad-identity for a v1 UUID', () => {
  const r = resolveIdentity('123e4567-e89b-12d3-a456-426614174000');
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "\"123e4567-e89b-12d3-a456-426614174000\" is not a v4 UUID" });
});

test('returns bad-identity for a UUID with uppercase hex', () => {
  const r = resolveIdentity('123E4567-E89B-42D3-A456-426614174000');
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "\"123E4567-E89B-42D3-A456-426614174000\" is not a v4 UUID" });
});

test('returns bad-identity for a UUID with wrong version digit', () => {
  const r = resolveIdentity('123e4567-e89b-32d3-a456-426614174000');
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "\"123e4567-e89b-32d3-a456-426614174000\" is not a v4 UUID" });
});

test('returns bad-identity for a UUID with wrong variant digit', () => {
  const r = resolveIdentity('123e4567-e89b-42d3-c456-426614174000');
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "\"123e4567-e89b-42d3-c456-426614174000\" is not a v4 UUID" });
});

test('returns bad-identity for a UUID that is too short', () => {
  const r = resolveIdentity('123e4567-e89b-42d3-a456-42661417400');
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "\"123e4567-e89b-42d3-a456-42661417400\" is not a v4 UUID" });
});

test('returns bad-identity for a UUID that is too long', () => {
  const r = resolveIdentity('123e4567-e89b-42d3-a456-4266141740001');
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "\"123e4567-e89b-42d3-a456-4266141740001\" is not a v4 UUID" });
});

test('returns bad-identity for null input', () => {
  const r = resolveIdentity(null);
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "null is not a v4 UUID" });
});

test('returns bad-identity for a number input', () => {
  const r = resolveIdentity(12345);
  assert.deepEqual(r, { ok: false, reason: "bad-identity", detail: "12345 is not a v4 UUID" });
});
