import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timestampEvidence,
  TIMESTAMP_EVIDENCE_STATES,
  TIMESTAMP_EVIDENCE_REASONS,
} from '../../lib/security-evidence-timestamp.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER_DIGEST = `sha256:${'b'.repeat(64)}`;
const LOCAL_TIME = '2026-01-01T00:00:00Z';
const RECEIPT_TIME = '2026-01-01T00:00:01Z';
const AUTHORITY = 'tsa.example';
const receipt = (over = {}) => ({ digest: DIGEST, timestamp: RECEIPT_TIME, authority: AUTHORITY, ...over });
const input = (over = {}) => ({ digest: DIGEST, localTime: LOCAL_TIME, receipt: receipt(), verified: true, ...over });
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

test('states and reasons are exported as frozen lists', () => {
  assert.deepEqual(TIMESTAMP_EVIDENCE_STATES, ['local-only', 'verified', 'invalid', 'unmeasured']);
  assert.deepEqual(TIMESTAMP_EVIDENCE_REASONS, ['no-receipt', 'receipt-verified', 'digest-mismatch', 'verification-failed', 'verification-missing']);
  assert.ok(Object.isFrozen(TIMESTAMP_EVIDENCE_STATES));
  assert.ok(Object.isFrozen(TIMESTAMP_EVIDENCE_REASONS));
});

test('no receipt leaves the timestamp local-only, with no receipt fields invented', () => {
  const r = timestampEvidence({ digest: DIGEST, localTime: LOCAL_TIME });
  assert.deepEqual(r, {
    state: 'local-only',
    reason: 'no-receipt',
    digest: DIGEST,
    localTime: LOCAL_TIME,
    timestamp: null,
    authority: null,
    verified: null,
  });
});

test('a verification result without a receipt cannot upgrade local evidence', () => {
  const r = timestampEvidence({ digest: DIGEST, localTime: LOCAL_TIME, verified: true });
  assert.deepEqual(r, {
    state: 'local-only',
    reason: 'no-receipt',
    digest: DIGEST,
    localTime: LOCAL_TIME,
    timestamp: null,
    authority: null,
    verified: null,
  });
});

test('a verified receipt bound to the same digest is trusted evidence', () => {
  const r = timestampEvidence(input());
  assert.deepEqual(r, {
    state: 'verified',
    reason: 'receipt-verified',
    digest: DIGEST,
    localTime: LOCAL_TIME,
    timestamp: RECEIPT_TIME,
    authority: AUTHORITY,
    verified: true,
  });
});

test('a receipt naming another digest is invalid even when its signature verified', () => {
  const r = timestampEvidence(input({ receipt: receipt({ digest: OTHER_DIGEST }) }));
  assert.deepEqual(r, {
    state: 'invalid',
    reason: 'digest-mismatch',
    digest: DIGEST,
    localTime: LOCAL_TIME,
    timestamp: RECEIPT_TIME,
    authority: AUTHORITY,
    verified: true,
  });
});

test('a verifier that rejected the receipt makes the evidence invalid', () => {
  const r = timestampEvidence(input({ verified: false }));
  assert.equal(r.state, 'invalid');
  assert.equal(r.reason, 'verification-failed');
  assert.equal(r.verified, false);
});

test('a receipt without a verification result is unmeasured, never trusted', () => {
  const r = timestampEvidence(input({ verified: undefined }));
  assert.equal(r.state, 'unmeasured');
  assert.equal(r.reason, 'verification-missing');
  assert.equal(r.verified, null);
  assert.equal(r.timestamp, RECEIPT_TIME);
});

test('a known authority label alone does not verify a receipt', () => {
  const r = timestampEvidence(input({ receipt: receipt({ authority: 'Adobe Approved Trust List' }), verified: undefined }));
  assert.deepEqual([r.state, r.reason, r.verified], ['unmeasured', 'verification-missing', null]);
});

test('the result is byte-identical whatever order the receipt fields arrive in', () => {
  const ordered = timestampEvidence({
    digest: DIGEST,
    localTime: LOCAL_TIME,
    receipt: { digest: DIGEST, timestamp: RECEIPT_TIME, authority: AUTHORITY },
    verified: true,
  });
  const reordered = timestampEvidence({
    verified: true,
    receipt: { authority: AUTHORITY, timestamp: RECEIPT_TIME, digest: DIGEST },
    localTime: LOCAL_TIME,
    digest: DIGEST,
  });
  assert.equal(JSON.stringify(ordered), JSON.stringify(reordered));
});

test('a deep-frozen input is not mutated', () => {
  const frozen = deepFreeze(input());
  const before = JSON.stringify(frozen);
  timestampEvidence(frozen);
  assert.equal(JSON.stringify(frozen), before);
});

test('every listed state and reason is reachable', () => {
  const inputs = [
    { digest: DIGEST, localTime: LOCAL_TIME },
    input(),
    input({ receipt: receipt({ digest: OTHER_DIGEST }) }),
    input({ verified: false }),
    input({ verified: undefined }),
  ];
  const results = inputs.map((i) => timestampEvidence(i));
  assert.deepEqual([...new Set(results.map((r) => r.state))].sort(), [...TIMESTAMP_EVIDENCE_STATES].sort());
  assert.deepEqual([...new Set(results.map((r) => r.reason))].sort(), [...TIMESTAMP_EVIDENCE_REASONS].sort());
});

test('a missing or malformed digest is refused, naming the field', () => {
  assert.throws(() => timestampEvidence(), /digest/);
  assert.throws(() => timestampEvidence({ localTime: LOCAL_TIME }), /digest/);
  assert.throws(() => timestampEvidence({ digest: 'a'.repeat(64), localTime: LOCAL_TIME }), /digest/);
  assert.throws(() => timestampEvidence({ digest: `sha256:${'A'.repeat(64)}`, localTime: LOCAL_TIME }), /digest/);
});

test('a missing or malformed local or receipt timestamp is refused, naming the field', () => {
  assert.throws(() => timestampEvidence({ digest: DIGEST }), /localTime/);
  assert.throws(() => timestampEvidence({ digest: DIGEST, localTime: '2026-02-30T00:00:00Z' }), /localTime/);
  assert.throws(() => timestampEvidence(input({ receipt: receipt({ timestamp: undefined }) })), /receipt\.timestamp/);
  assert.throws(() => timestampEvidence(input({ receipt: receipt({ timestamp: '2026-01-01 00:00:00' }) })), /receipt\.timestamp/);
});

test('a malformed receipt is refused, naming the field', () => {
  assert.throws(() => timestampEvidence(input({ receipt: 'receipt' })), /receipt must be an object/);
  assert.throws(() => timestampEvidence(input({ receipt: receipt({ digest: OTHER_DIGEST.slice(7) }) })), /receipt\.digest/);
  assert.throws(() => timestampEvidence(input({ receipt: receipt({ authority: '' }) })), /receipt\.authority/);
  assert.throws(() => timestampEvidence(input({ receipt: receipt({ authority: undefined }) })), /receipt\.authority/);
});

test('a verification result that is neither boolean nor absent is refused', () => {
  assert.throws(() => timestampEvidence(input({ verified: 'true' })), /verified/);
  assert.throws(() => timestampEvidence(input({ verified: 1 })), /verified/);
});
