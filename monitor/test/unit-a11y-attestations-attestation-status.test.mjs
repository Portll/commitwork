// Computes the current attestation state from an entry and the current digest (monitor/a11y-attestations.mjs attestationStatus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attestationStatus } from '../a11y-attestations.mjs';

test('returns withdrawn when the entry is null', () => {
  const r = attestationStatus(null, { now: '2024-01-01T00:00:00Z', currentDigest: 'abc' });
  assert.equal(r, "withdrawn");
});

test('returns withdrawn when the action is withdraw', () => {
  const e = { action: 'withdraw', subjectDigest: 'abc', expires: '2025-01-01T00:00:00Z' };
  const r = attestationStatus(e, { now: '2024-01-01T00:00:00Z', currentDigest: 'abc' });
  assert.equal(r, "withdrawn");
});

test('returns unverifiable when currentDigest is null', () => {
  const e = { action: 'attest', subjectDigest: 'abc', expires: '2025-01-01T00:00:00Z' };
  const r = attestationStatus(e, { now: '2024-01-01T00:00:00Z', currentDigest: null });
  assert.equal(r, "unverifiable");
});

test('returns stale-subject when the subject digest differs from the current digest', () => {
  const e = { action: 'attest', subjectDigest: 'old', expires: '2025-01-01T00:00:00Z' };
  const r = attestationStatus(e, { now: '2024-01-01T00:00:00Z', currentDigest: 'new' });
  assert.equal(r, "stale-subject");
});

test('returns expired when the expiration time equals the current time', () => {
  const e = { action: 'attest', subjectDigest: 'abc', expires: '2024-01-01T00:00:00Z' };
  const r = attestationStatus(e, { now: '2024-01-01T00:00:00Z', currentDigest: 'abc' });
  assert.equal(r, "expired");
});

test('returns active when the expiration time is after the current time', () => {
  const e = { action: 'attest', subjectDigest: 'abc', expires: '2025-01-01T00:00:00Z' };
  const r = attestationStatus(e, { now: '2024-01-01T00:00:00Z', currentDigest: 'abc' });
  assert.equal(r, "active");
});

test('returns active when there is no expiration and the digest matches', () => {
  const e = { action: 'attest', subjectDigest: 'abc' };
  const r = attestationStatus(e, { now: '2024-01-01T00:00:00Z', currentDigest: 'abc' });
  assert.equal(r, "active");
});
