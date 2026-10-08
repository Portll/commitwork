// monitor/test/cwx-registry-units.test.mjs — case tests for isCwx, isFoundational, isPublicAdvisory, ordinalToSuffix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCwx, isFoundational, isPublicAdvisory, ordinalToSuffix } from '../cwx-registry.mjs';

test('accepts valid CWX id with digits', () => {
  assert.equal(isCwx('CWX-000000'), true);
});

test('accepts valid CWX id with uppercase letters', () => {
  assert.equal(isCwx('CWX-ABCDEF'), true);
});

test('accepts valid CWX id with mixed alphanumerics', () => {
  assert.equal(isCwx('CWX-123456'), true);
  assert.equal(isCwx('CWX-ABC123'), true);
});

test('rejects lowercase letters (case-sensitive)', () => {
  assert.equal(isCwx('CWX-abcdef'), false);
  assert.equal(isCwx('cwx-000000'), false);
});

test('rejects wrong length suffix', () => {
  assert.equal(isCwx('CWX-12345'), false);
  assert.equal(isCwx('CWX-1234567'), false);
});

test('rejects non-string inputs', () => {
  assert.equal(isCwx(null), false);
  assert.equal(isCwx(undefined), false);
  assert.equal(isCwx(123456), false);
  assert.equal(isCwx({}), false);
});

test('rejects invalid characters in suffix', () => {
  assert.equal(isCwx('CWX-00000!'), false);
  assert.equal(isCwx('CWX-00000 '), false);
});

test('rejects empty string and non-matching prefixes', () => {
  assert.equal(isCwx(''), false);
  assert.equal(isCwx('CWE-000000'), false);
  assert.equal(isCwx('CVE-2024-0001'), false);
});

test('returns true for valid CWX id', () => {
  assert.equal(isFoundational('CWX-000000'), true);
});

test('returns true for CWX id with hex chars', () => {
  assert.equal(isFoundational('CWX-ABCDEF'), true);
});

test('returns false for CVE id', () => {
  assert.equal(isFoundational('CVE-2023-1234'), false);
});

test('returns false for GHSA id', () => {
  assert.equal(isFoundational('GHSA-abc1-def2-ghi3'), false);
});

test('returns false for lowercase cwx prefix', () => {
  assert.equal(isFoundational('cwx-000000'), false);
});

test('returns false for non-string input', () => {
  assert.equal(isFoundational(12345), false);
  assert.equal(isFoundational(null), false);
  assert.equal(isFoundational(undefined), false);
});

test('returns false for CWX with wrong length', () => {
  assert.equal(isFoundational('CWX-00000'), false);
  assert.equal(isFoundational('CWX-0000000'), false);
});

test('returns true for valid CVE id', () => {
  assert.equal(isPublicAdvisory('CVE-2021-44228'), true);
});

test('returns true for valid GHSA id', () => {
  assert.equal(isPublicAdvisory('GHSA-8h47-627j-qx2m'), true);
});

test('returns false for CWX id', () => {
  assert.equal(isPublicAdvisory('CWX-000001'), false);
});

test('returns false for lowercase cve prefix', () => {
  assert.equal(isPublicAdvisory('cve-2021-44228'), false);
});

test('returns false for non-string input', () => {
  assert.equal(isPublicAdvisory(12345), false);
});

test('returns false for empty string', () => {
  assert.equal(isPublicAdvisory(''), false);
});

test('returns false for GHSA with uppercase letters', () => {
  assert.equal(isPublicAdvisory('GHSA-8H47-627J-QX2M'), false);
});

test('returns false for CVE with non-numeric year', () => {
  assert.equal(isPublicAdvisory('CVE-ABCD-1234'), false);
});

test('ordinalToSuffix(0) returns "000000"', () => {
  assert.equal(ordinalToSuffix(0), '000000');
});

test('ordinalToSuffix(1) returns "000001"', () => {
  assert.equal(ordinalToSuffix(1), '000001');
});

test('ordinalToSuffix(999999) returns "999999"', () => {
  assert.equal(ordinalToSuffix(999999), '999999');
});

test('ordinalToSuffix(1000000) returns "000000" (hex ladder start)', () => {
  assert.equal(ordinalToSuffix(1000000), '000000');
});

test('ordinalToSuffix(1000001) returns "000001"', () => {
  assert.equal(ordinalToSuffix(1000001), '000001');
});

test('ordinalToSuffix(1000000 + 16**6 - 1) returns "FFFFFF"', () => {
  assert.equal(ordinalToSuffix(1000000 + 16 ** 6 - 1), 'FFFFFF');
});

test('ordinalToSuffix(1000000 + 16**6) returns "000000" (base36 ladder start)', () => {
  assert.equal(ordinalToSuffix(1000000 + 16 ** 6), '000000');
});

test('ordinalToSuffix throws on negative input', () => {
  assert.throws(() => ordinalToSuffix(-1), /non-negative integer/);
});

test('ordinalToSuffix throws on non-integer input', () => {
  assert.throws(() => ordinalToSuffix(1.5), /non-negative integer/);
});

test('ordinalToSuffix throws on space exhaustion', () => {
  assert.throws(() => ordinalToSuffix(1000000 + 16 ** 6 + 36 ** 6), /space exhausted/);
});
