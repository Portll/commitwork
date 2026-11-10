// Maps a scanner state and attestation to a final a11y state (monitor/a11y-attestations.mjs attestedState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attestedState } from '../a11y-attestations.mjs';

test('scanner state pass-through returns the scanner state verbatim', () => {
  const r = attestedState('pass', null, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "pass");
});

test('unchecked scanner state with no attestation returns unchecked', () => {
  const r = attestedState('unchecked', null, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "unchecked");
});

test('active human attestation with fails verdict returns attested-fail', () => {
  const e = { action: 'attest', subjectDigest: 'd1', expires: '2025-01-01T00:00:00Z', whoKind: 'human', verdict: 'fails' };
  const r = attestedState('unchecked', e, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "attested-fail");
});

test('active human attestation with not-applicable verdict returns attested-n/a', () => {
  const e = { action: 'attest', subjectDigest: 'd1', expires: '2025-01-01T00:00:00Z', whoKind: 'human', verdict: 'not-applicable' };
  const r = attestedState('unchecked', e, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "attested-n/a");
});

test('active human attestation with pass verdict returns attested-pass', () => {
  const e = { action: 'attest', subjectDigest: 'd1', expires: '2025-01-01T00:00:00Z', whoKind: 'human', verdict: 'pass' };
  const r = attestedState('unchecked', e, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "attested-pass");
});

test('active machine attestation returns unchecked', () => {
  const e = { action: 'attest', subjectDigest: 'd1', expires: '2025-01-01T00:00:00Z', whoKind: 'machine', verdict: 'pass' };
  const r = attestedState('unchecked', e, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "unchecked");
});

test('stale subject digest returns unchecked', () => {
  const e = { action: 'attest', subjectDigest: 'd2', expires: '2025-01-01T00:00:00Z', whoKind: 'human', verdict: 'pass' };
  const r = attestedState('unchecked', e, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "unchecked");
});

test('expired attestation returns unchecked', () => {
  const e = { action: 'attest', subjectDigest: 'd1', expires: '2023-01-01T00:00:00Z', whoKind: 'human', verdict: 'pass' };
  const r = attestedState('unchecked', e, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "unchecked");
});

test('withdrawn attestation returns unchecked', () => {
  const e = { action: 'withdraw', subjectDigest: 'd1', whoKind: 'human', verdict: 'pass' };
  const r = attestedState('unchecked', e, { now: '2024-01-01T00:00:00Z', currentDigest: 'd1' });
  assert.equal(r, "unchecked");
});

test('unverifiable attestation with no current digest returns unchecked', () => {
  const e = { action: 'attest', subjectDigest: 'd1', whoKind: 'human', verdict: 'pass' };
  const r = attestedState('unchecked', e, { now: '2024-01-01T00:00:00Z', currentDigest: null });
  assert.equal(r, "unchecked");
});
