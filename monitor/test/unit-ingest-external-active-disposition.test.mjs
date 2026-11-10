// Newest disposition still in force for an issue (monitor/ingest-external.mjs activeDisposition).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeDisposition } from '../ingest-external.mjs';
import { subjectDigest } from '../ingest-external.mjs';

const NOW = '2026-01-01T00:00:00.000Z';
const ONE_MS_BEFORE = '2025-12-31T23:59:59.999Z';
const ONE_MS_AFTER = '2026-01-01T00:00:00.001Z';
const DIGEST = 'sha256:current';
const OPTS = { now: NOW, currentDigest: DIGEST };

const disposition = (fields = {}) => ({ subjectDigest: DIGEST, ...fields });

test('returns null when the issue has no usable dispositions list', () => {
  assert.equal(activeDisposition({ dispositions: [] }, OPTS), null);
  assert.equal(activeDisposition({ dispositions: 'not-a-list' }, OPTS), null);
  assert.equal(activeDisposition({}, OPTS), null);
  assert.equal(activeDisposition(undefined, OPTS), null);
  assert.equal(activeDisposition(null, OPTS), null);
});

test('throws when the digest must be computed from a missing issue', () => {
  assert.throws(() => activeDisposition(undefined), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'source')",
  });
  assert.throws(() => activeDisposition(null, { now: NOW }), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'source')",
  });
});

test('returns the only disposition when it is in force', () => {
  const d = disposition({ expires: ONE_MS_AFTER });
  assert.equal(activeDisposition({ dispositions: [d] }, OPTS), d);
});

test('returns the newest disposition when several are in force', () => {
  const older = disposition({ id: 'older' });
  const newer = disposition({ id: 'newer' });
  assert.equal(activeDisposition({ dispositions: [older, newer] }, OPTS), newer);
});

test('walks back past entries not in force to the first entry of the list', () => {
  const kept = disposition({ id: 'kept' });
  const dispositions = [
    kept,
    disposition({ expires: ONE_MS_BEFORE }),
    disposition({ subjectDigest: 'sha256:moved' }),
    disposition({ invalidatedAt: NOW }),
    null,
  ];
  assert.equal(activeDisposition({ dispositions }, OPTS), kept);
});

test('returns null when the only disposition is invalidated, stale, expired or empty', () => {
  const entries = [
    disposition({ invalidatedAt: NOW }),
    disposition({ subjectDigest: 'sha256:moved' }),
    disposition({ expires: ONE_MS_BEFORE }),
    null,
  ];
  for (const d of entries) {
    assert.equal(activeDisposition({ dispositions: [d] }, OPTS), null);
  }
});

test('treats a disposition as expired at its exact expiry instant and in force one millisecond before it', () => {
  const expiresAtNow = disposition({ expires: NOW });
  const expiresJustBefore = disposition({ expires: ONE_MS_BEFORE });
  const expiresJustAfter = disposition({ expires: ONE_MS_AFTER });
  assert.equal(activeDisposition({ dispositions: [expiresAtNow] }, OPTS), null);
  assert.equal(activeDisposition({ dispositions: [expiresJustBefore] }, OPTS), null);
  assert.equal(activeDisposition({ dispositions: [expiresJustAfter] }, OPTS), expiresJustAfter);
});

test('keeps a disposition in force when its expiry is absent or cannot be compared', () => {
  const noExpiry = disposition();
  const badExpiry = disposition({ expires: 'never' });
  const pastExpiry = disposition({ expires: ONE_MS_BEFORE });
  assert.equal(activeDisposition({ dispositions: [noExpiry] }, OPTS), noExpiry);
  assert.equal(activeDisposition({ dispositions: [badExpiry] }, OPTS), badExpiry);
  assert.equal(activeDisposition({ dispositions: [pastExpiry] }, { currentDigest: DIGEST }), pastExpiry);
});

test('computes the digest from the issue when currentDigest is not given', () => {
  const iss = {
    repo: 'acme/api',
    title: 'lodash 4.17.20',
    severity: 'high',
    source: { kind: 'scanner', key: 'k1', tool: 'osv', rule: 'r1' },
  };
  const matching = { subjectDigest: subjectDigest(iss) };
  const moved = { subjectDigest: 'sha256:moved' };
  assert.equal(activeDisposition({ ...iss, dispositions: [matching] }, { now: NOW }), matching);
  assert.equal(activeDisposition({ ...iss, dispositions: [moved] }, { now: NOW }), null);
  assert.equal(activeDisposition({ ...iss, dispositions: [matching, moved] }), matching);
});

test('compares against a supplied currentDigest and skips the comparison when it is null or empty', () => {
  const d = disposition();
  const iss = { title: 'supplied digest', dispositions: [d] };
  assert.equal(activeDisposition(iss, { now: NOW, currentDigest: DIGEST }), d);
  assert.equal(activeDisposition(iss, { now: NOW, currentDigest: 'sha256:other' }), null);
  assert.equal(activeDisposition(iss, { now: NOW, currentDigest: null }), d);
  assert.equal(activeDisposition(iss, { now: NOW, currentDigest: '' }), d);
});
