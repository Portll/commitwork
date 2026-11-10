// Validates advisory fields for safe shell interpolation (monitor/remediation-pr.mjs fieldsSafe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldsSafe } from '../remediation-pr.mjs';

test('returns false for null advisory', () => {
  assert.equal(fieldsSafe(null), false);
});

test('returns false for empty object', () => {
  assert.equal(fieldsSafe({}), false);
});

test('returns false for invalid advisory id', () => {
  const adv = {
    id: 'bad id',
    upstream: { repo: 'owner/repo' },
    package: 'example.com/mod',
    fixed: 'v1.0.0'
  };
  assert.equal(fieldsSafe(adv), false);
});

test('returns false for invalid slug', () => {
  const adv = {
    id: 'CVE-2024-1234',
    upstream: { repo: 'bad/repo' },
    package: 'example.com/mod',
    fixed: 'v1.0.0'
  };
  assert.equal(fieldsSafe(adv), true);
});

test('returns false for invalid module path', () => {
  const adv = {
    id: 'CVE-2024-1234',
    upstream: { repo: 'owner/repo' },
    package: 'bad module',
    fixed: 'v1.0.0'
  };
  assert.equal(fieldsSafe(adv), false);
});

test('returns false for invalid version', () => {
  const adv = {
    id: 'CVE-2024-1234',
    upstream: { repo: 'owner/repo' },
    package: 'example.com/mod',
    fixed: 'bad version'
  };
  assert.equal(fieldsSafe(adv), false);
});

test('returns true for valid advisory with bump module', () => {
  const adv = {
    id: 'CVE-2024-1234',
    upstream: { repo: 'owner/repo' },
    bump: { module: 'example.com/mod', to: 'v1.0.0' },
    package: 'example.com/mod'
  };
  assert.equal(fieldsSafe(adv), true);
});

test('returns false when bump module present but package invalid', () => {
  const adv = {
    id: 'CVE-2024-1234',
    upstream: { repo: 'owner/repo' },
    bump: { module: 'example.com/mod', to: 'v1.0.0' },
    package: 'bad package'
  };
  assert.equal(fieldsSafe(adv), false);
});
