// Distils a GitHub advisory into a compact index entry (bin/advisory-index.mjs distil).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distil } from '../advisory-index.mjs';

test('returns null when input is null', () => {
  assert.equal(distil(null), null);
});

test('returns null when ghsa_id is missing', () => {
  assert.equal(distil({ cve_id: 'CVE-2024-0001' }), null);
});

test('returns null when ghsa_id is empty string', () => {
  assert.equal(distil({ ghsa_id: '' }), null);
});

test('returns minimal entry with only id when no optional fields', () => {
  const result = distil({ ghsa_id: 'GHSA-abc' });
  assert.deepEqual(result, { id: 'GHSA-abc', entry: {}, names: {} });
});

test('includes lowercased severity label', () => {
  const result = distil({ ghsa_id: 'GHSA-1', severity: 'CRITICAL' });
  assert.equal(result.entry.label, 'critical');
});

test('includes cve_id when present', () => {
  const result = distil({ ghsa_id: 'GHSA-2', cve_id: 'CVE-2024-1234' });
  assert.equal(result.entry.cve, 'CVE-2024-1234');
});

test('includes cvss_v3 vector and score from cvss_severities', () => {
  const result = distil({
    ghsa_id: 'GHSA-3',
    cvss_severities: { cvss_v3: { vector_string: 'CVSS:3.1/AV:N', score: 9.8 } }
  });
  assert.equal(result.entry.v3, 'CVSS:3.1/AV:N');
  assert.equal(result.entry.s3, 9.8);
});

test('falls back to cvss field when cvss_severities is absent', () => {
  const result = distil({
    ghsa_id: 'GHSA-4',
    cvss: { vector_string: 'CVSS:3.1/AV:L', score: 7.5 }
  });
  assert.equal(result.entry.v3, 'CVSS:3.1/AV:L');
  assert.equal(result.entry.s3, 7.5);
});

test('includes cvss_v4 vector and score', () => {
  const result = distil({
    ghsa_id: 'GHSA-5',
    cvss_severities: { cvss_v4: { vector_string: 'CVSS:4.0/AV:N', score: 10.0 } }
  });
  assert.equal(result.entry.v4, 'CVSS:4.0/AV:N');
  assert.equal(result.entry.s4, 10.0);
});

test('collects sorted cwe ids and deduplicated names', () => {
  const result = distil({
    ghsa_id: 'GHSA-6',
    cwes: [
      { cwe_id: 79, name: 'XSS' },
      { cwe_id: 89, name: 'SQLi' },
      { cwe_id: 79, name: 'Cross-Site Scripting' }
    ]
  });
  assert.deepEqual(result.entry.cwe, [79, 79, 89]);
  assert.deepEqual(result.names, { 79: 'Cross-Site Scripting', 89: 'SQLi' });
});
