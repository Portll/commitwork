// Extracts a valid sha256 digest from a report subject (monitor/a11y-attestations.mjs reportDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportDigest } from '../a11y-attestations.mjs';

test('returns null when report is null', () => {
  const r = reportDigest(null);
  assert.equal(r, null);
});

test('returns null when report is undefined', () => {
  const r = reportDigest(undefined);
  assert.equal(r, null);
});

test('returns null when report has no subject', () => {
  const r = reportDigest({});
  assert.equal(r, null);
});

test('returns null when subject has no digest', () => {
  const r = reportDigest({ subject: {} });
  assert.equal(r, null);
});

test('returns null when digest is not a string', () => {
  const r = reportDigest({ subject: { digest: 123 } });
  assert.equal(r, null);
});

test('returns null when digest is an empty string', () => {
  const r = reportDigest({ subject: { digest: '' } });
  assert.equal(r, null);
});

test('returns null when digest has wrong prefix', () => {
  const r = reportDigest({ subject: { digest: 'md5:' + 'a'.repeat(64) } });
  assert.equal(r, null);
});

test('returns null when digest has uppercase hex', () => {
  const r = reportDigest({ subject: { digest: 'sha256:' + 'A'.repeat(64) } });
  assert.equal(r, null);
});

test('returns null when digest is too short', () => {
  const r = reportDigest({ subject: { digest: 'sha256:' + 'a'.repeat(63) } });
  assert.equal(r, null);
});

test('returns null when digest is too long', () => {
  const r = reportDigest({ subject: { digest: 'sha256:' + 'a'.repeat(65) } });
  assert.equal(r, null);
});

test('returns null when digest contains invalid character', () => {
  const r = reportDigest({ subject: { digest: 'sha256:' + 'a'.repeat(63) + 'g' } });
  assert.equal(r, null);
});

test('returns the digest when it is a valid sha256 string', () => {
  const r = reportDigest({ subject: { digest: 'sha256:' + 'a'.repeat(64) } });
  assert.equal(r, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('returns the digest when it contains zero characters', () => {
  const r = reportDigest({ subject: { digest: 'sha256:' + '0'.repeat(64) } });
  assert.equal(r, "sha256:0000000000000000000000000000000000000000000000000000000000000000");
});

test('returns the digest when it contains f characters', () => {
  const r = reportDigest({ subject: { digest: 'sha256:' + 'f'.repeat(64) } });
  assert.equal(r, "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
});
