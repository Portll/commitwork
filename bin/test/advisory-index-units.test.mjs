// bin/test/advisory-index-units.test.mjs — case tests for fetchIds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchIds } from '../advisory-index.mjs';

test('fetchIds returns empty objects for an empty ids array', async () => {
  const r = await fetchIds([]);
  assert.deepEqual(r, { out: {}, names: {} });
});

test('fetchIds returns empty objects when the advisory body has no ghsa_id', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    headers: { get: () => '' },
    json: async () => ({ severity: 'HIGH' }),
  });
  try {
    const r = await fetchIds(['GHSA-1']);
    assert.deepEqual(r, { out: {}, names: {} });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchIds returns empty objects when the advisory body is null', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    headers: { get: () => '' },
    json: async () => null,
  });
  try {
    const r = await fetchIds(['GHSA-2']);
    assert.deepEqual(r, { out: {}, names: {} });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchIds distils a full advisory into out and names', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    headers: { get: () => '' },
    json: async () => ({
      ghsa_id: 'GHSA-abc',
      cve_id: 'CVE-2024-1',
      severity: 'CRITICAL',
      cvss_severities: {
        cvss_v3: { vector_string: 'CVSS:3.1/AV:N', score: 9.8 },
        cvss_v4: { vector_string: 'CVSS:4.0/AV:N', score: 10 },
      },
      cwes: [{ cwe_id: 'CWE-79', name: 'XSS' }],
    }),
  });
  try {
    const r = await fetchIds(['GHSA-abc']);
    assert.deepEqual(r.out, {
      'GHSA-abc': {
        label: 'critical',
        cve: 'CVE-2024-1',
        v3: 'CVSS:3.1/AV:N',
        s3: 9.8,
        v4: 'CVSS:4.0/AV:N',
        s4: 10,
        cwe: ['CWE-79'],
      },
    });
    assert.deepEqual(r.names, { 'CWE-79': 'XSS' });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchIds throws on a non-ok GitHub response', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 500,
    ok: false,
    headers: { get: () => '' },
    json: async () => ({}),
  });
  try {
    await assert.rejects(() => fetchIds(['GHSA-x']), /GitHub 500/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchIds throws on a 403 rate-limit response', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 403,
    ok: false,
    headers: { get: () => '' },
    json: async () => ({}),
  });
  try {
    await assert.rejects(() => fetchIds(['GHSA-y']), /rate limited \(403\)/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
