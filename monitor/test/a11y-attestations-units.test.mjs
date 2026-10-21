// monitor/test/a11y-attestations-units.test.mjs — case tests for attestationView.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attestationView } from '../a11y-attestations.mjs';

test('returns null for null input', () => {
  assert.equal(attestationView(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(attestationView(undefined), null);
});

test('active human attestation with unchecked scanner state', () => {
  const e = {
    id: 'ATT-1', action: 'attest', verdict: 'meets', who: 'alice',
    whoKind: 'human', channel: 'http', at: '2024-01-01T00:00:00Z',
    expires: '2025-01-01T00:00:00Z', note: 'checked', subjectDigest: 'sha256:' + 'a'.repeat(64),
  };
  const v = attestationView(e, { now: '2024-06-01T00:00:00Z', currentDigest: 'sha256:' + 'a'.repeat(64), scannerState: 'unchecked' });
  assert.equal(v.status, 'active');
  assert.equal(v.counts, true);
  assert.equal(v.id, 'ATT-1');
  assert.equal(v.who, 'alice');
  assert.equal(v.verdict, 'meets');
  assert.equal('notCounted' in v, false);
});

test('machine attestation gets notCounted and counts false', () => {
  const e = {
    id: 'ATT-2', action: 'attest', verdict: 'meets', who: 'bot',
    whoKind: 'machine', channel: 'mcp', at: '2024-01-01T00:00:00Z',
    expires: '2025-01-01T00:00:00Z', note: null, subjectDigest: 'sha256:' + 'b'.repeat(64),
  };
  const v = attestationView(e, { now: '2024-06-01T00:00:00Z', currentDigest: 'sha256:' + 'b'.repeat(64), scannerState: 'unchecked' });
  assert.equal(v.status, 'active');
  assert.equal(v.counts, false);
  assert.equal(v.notCounted, 'machine-attributed — an agent-signed attestation is recorded, but it clears nothing');
});

test('withdraw action returns withdrawn status', () => {
  const e = {
    id: 'ATT-3', action: 'withdraw', verdict: null, who: 'alice',
    whoKind: 'human', channel: 'http', at: '2024-01-01T00:00:00Z',
    expires: null, note: null, subjectDigest: 'sha256:' + 'c'.repeat(64),
  };
  const v = attestationView(e, { now: '2024-06-01T00:00:00Z', currentDigest: 'sha256:' + 'c'.repeat(64), scannerState: 'unchecked' });
  assert.equal(v.status, 'withdrawn');
  assert.equal(v.counts, false);
  assert.equal(v.action, 'withdraw');
});

test('scanner state pass overrides status to superseded-by-scanner', () => {
  const e = {
    id: 'ATT-4', action: 'attest', verdict: 'meets', who: 'alice',
    whoKind: 'human', channel: 'http', at: '2024-01-01T00:00:00Z',
    expires: '2025-01-01T00:00:00Z', note: null, subjectDigest: 'sha256:' + 'd'.repeat(64),
  };
  const v = attestationView(e, { now: '2024-06-01T00:00:00Z', currentDigest: 'sha256:' + 'd'.repeat(64), scannerState: 'pass' });
  assert.equal(v.status, 'superseded-by-scanner');
  assert.equal(v.counts, false);
});

test('expired attestation returns expired status', () => {
  const e = {
    id: 'ATT-5', action: 'attest', verdict: 'meets', who: 'alice',
    whoKind: 'human', channel: 'http', at: '2024-01-01T00:00:00Z',
    expires: '2024-01-02T00:00:00Z', note: null, subjectDigest: 'sha256:' + 'e'.repeat(64),
  };
  const v = attestationView(e, { now: '2024-06-01T00:00:00Z', currentDigest: 'sha256:' + 'e'.repeat(64), scannerState: 'unchecked' });
  assert.equal(v.status, 'expired');
  assert.equal(v.counts, false);
});

test('stale subject digest returns stale-subject status', () => {
  const e = {
    id: 'ATT-6', action: 'attest', verdict: 'meets', who: 'alice',
    whoKind: 'human', channel: 'http', at: '2024-01-01T00:00:00Z',
    expires: '2025-01-01T00:00:00Z', note: null, subjectDigest: 'sha256:' + 'f'.repeat(64),
  };
  const v = attestationView(e, { now: '2024-06-01T00:00:00Z', currentDigest: 'sha256:' + 'a'.repeat(64), scannerState: 'unchecked' });
  assert.equal(v.status, 'stale-subject');
  assert.equal(v.counts, false);
});
