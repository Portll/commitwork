// Computes the disposition lifecycle state of a stored disposition record (monitor/ingest-external.mjs dispositionStatus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispositionStatus } from '../ingest-external.mjs';

test('returns invalidated when the disposition record is falsy', () => {
  assert.equal(dispositionStatus(null, { now: '2025-01-01T00:00:00.000Z' }), "invalidated");
});

test('returns invalidated when the record has an invalidatedAt timestamp', () => {
  const d = { invalidatedAt: '2025-01-01T00:00:00.000Z', subjectDigest: 'sha256:abc' };
  assert.equal(dispositionStatus(d, { now: '2025-01-01T00:00:00.000Z', currentDigest: 'sha256:abc' }), "invalidated");
});

test('returns stale-subject when the stored digest differs from the current digest', () => {
  const d = { subjectDigest: 'sha256:old' };
  assert.equal(dispositionStatus(d, { now: '2025-01-01T00:00:00.000Z', currentDigest: 'sha256:new' }), "stale-subject");
});

test('returns active when the stored digest matches the current digest and no expiry is set', () => {
  const d = { subjectDigest: 'sha256:same' };
  assert.equal(dispositionStatus(d, { now: '2025-01-01T00:00:00.000Z', currentDigest: 'sha256:same' }), "active");
});

test('returns expired when the expiry timestamp equals the current time', () => {
  const d = { expires: '2025-01-01T00:00:00.000Z' };
  assert.equal(dispositionStatus(d, { now: '2025-01-01T00:00:00.000Z' }), "expired");
});

test('returns active when the expiry timestamp is after the current time', () => {
  const d = { expires: '2025-01-02T00:00:00.000Z' };
  assert.equal(dispositionStatus(d, { now: '2025-01-01T00:00:00.000Z' }), "active");
});

test('returns expired when the expiry timestamp is before the current time', () => {
  const d = { expires: '2024-12-31T00:00:00.000Z' };
  assert.equal(dispositionStatus(d, { now: '2025-01-01T00:00:00.000Z' }), "expired");
});

test('returns active when no current digest is provided and no expiry is set', () => {
  const d = { subjectDigest: 'sha256:any' };
  assert.equal(dispositionStatus(d, { now: '2025-01-01T00:00:00.000Z' }), "active");
});
