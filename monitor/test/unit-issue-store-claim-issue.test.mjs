// The issue after taking a time-limited claim on it (monitor/issue-store.mjs claimIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimIssue } from '../issue-store.mjs';

const docWith = (issue) => ({ issues: { 'a-1': issue }, events: [] });
const withoutHash = ({ hash, ...rest }) => rest;
const heldClaim = {
  by: 'other',
  sessionId: 's2',
  at: '2024-01-01T00:00:00.000Z',
  expiresAt: '2024-01-01T04:00:00.000Z',
};

test('an id missing from the document is rejected as unknown', () => {
  const doc = docWith({ state: 'open', attemptCount: 0 });
  assert.throws(
    () => claimIssue(doc, 'missing', { by: 'u', sessionId: 's1', at: '2024-01-01T00:00:00.000Z', ttlHours: 4 }),
    { name: 'Error', message: 'unknown issue missing' },
  );
});

test('a closed issue cannot be claimed', () => {
  const doc = docWith({ state: 'closed', attemptCount: 0 });
  assert.throws(
    () => claimIssue(doc, 'a-1', { by: 'u', sessionId: 's1', at: '2024-01-01T00:00:00.000Z', ttlHours: 4 }),
    { name: 'Error', message: 'a-1 is closed' },
  );
  assert.deepEqual(doc.events, []);
});

test('a blocked issue cannot be claimed and the error gives the blocked reason', () => {
  const doc = docWith({ state: 'blocked', blockedReason: 'dep', attemptCount: 0 });
  assert.throws(
    () => claimIssue(doc, 'a-1', { by: 'u', sessionId: 's1', at: '2024-01-01T00:00:00.000Z', ttlHours: 4 }),
    { name: 'Error', message: 'a-1 is blocked: dep' },
  );
  assert.deepEqual(doc.events, []);
});

test('an unsatisfiable issue cannot be claimed, with or without a recorded reason', () => {
  const opts = { by: 'u', sessionId: 's1', at: '2024-01-01T00:00:00.000Z', ttlHours: 4 };
  const withReason = docWith({ state: 'unsatisfiable', unsatisfiable: { reason: 'x' }, attemptCount: 0 });
  const noReason = docWith({ state: 'unsatisfiable', attemptCount: 0 });
  assert.throws(() => claimIssue(withReason, 'a-1', opts), { name: 'Error', message: 'a-1 is unsatisfiable: x' });
  assert.throws(() => claimIssue(noReason, 'a-1', opts), { name: 'Error', message: 'a-1 is unsatisfiable: undefined' });
});

test('a claim held by another session with one millisecond left is a conflict and changes nothing', () => {
  const doc = docWith({ state: 'claimed', attemptCount: 1, claim: { ...heldClaim } });
  assert.throws(
    () => claimIssue(doc, 'a-1', { by: 'u', sessionId: 's1', at: '2024-01-01T03:59:59.999Z', ttlHours: 4 }),
    { name: 'Error', code: 'CLAIM_CONFLICT', message: 'a-1 is claimed by other until 2024-01-01T04:00:00.000Z' },
  );
  assert.deepEqual(doc.issues['a-1'], { state: 'claimed', attemptCount: 1, claim: heldClaim });
  assert.deepEqual(doc.events, []);
});

test('a claim held by another session can be taken at the exact moment it expires', () => {
  const doc = docWith({ state: 'claimed', attemptCount: 1, claim: { ...heldClaim } });
  const r = claimIssue(doc, 'a-1', { by: 'u', sessionId: 's1', at: '2024-01-01T04:00:00.000Z', ttlHours: 2 });
  assert.deepEqual(r, {
    state: 'claimed',
    attemptCount: 2,
    claim: { by: 'u', sessionId: 's1', at: '2024-01-01T04:00:00.000Z', expiresAt: '2024-01-01T06:00:00.000Z' },
    updatedAt: '2024-01-01T04:00:00.000Z',
  });
});

test('the session holding an unexpired claim can renew it', () => {
  const doc = docWith({ state: 'claimed', attemptCount: 1, claim: { ...heldClaim } });
  const r = claimIssue(doc, 'a-1', { by: 'other-2', sessionId: 's2', at: '2024-01-01T01:00:00.000Z', ttlHours: 4 });
  assert.deepEqual(r, {
    state: 'claimed',
    attemptCount: 2,
    claim: { by: 'other-2', sessionId: 's2', at: '2024-01-01T01:00:00.000Z', expiresAt: '2024-01-01T05:00:00.000Z' },
    updatedAt: '2024-01-01T01:00:00.000Z',
  });
});

test('an open issue with no claim becomes claimed and its attempt count goes up by one', () => {
  const doc = docWith({ state: 'open', attemptCount: 3 });
  const r = claimIssue(doc, 'a-1', { by: 'alice', sessionId: 'sess-1', at: '2024-06-15T12:00:00.000Z', ttlHours: 4 });
  assert.equal(r, doc.issues['a-1']);
  assert.deepEqual(r, {
    state: 'claimed',
    attemptCount: 4,
    claim: { by: 'alice', sessionId: 'sess-1', at: '2024-06-15T12:00:00.000Z', expiresAt: '2024-06-15T16:00:00.000Z' },
    updatedAt: '2024-06-15T12:00:00.000Z',
  });
});

test('each claim appends a chained event whose attempt is one above the prior attempt count', () => {
  const doc = docWith({ state: 'open', attemptCount: 2 });
  claimIssue(doc, 'a-1', { by: 'bob', sessionId: 's9', at: '2024-01-01T00:00:00.000Z', ttlHours: 1 });
  claimIssue(doc, 'a-1', { by: 'bob', sessionId: 's9', at: '2024-01-01T00:30:00.000Z', ttlHours: 1 });
  assert.deepEqual(doc.events.map(withoutHash), [
    {
      type: 'issue-claimed',
      issueId: 'a-1',
      at: '2024-01-01T00:00:00.000Z',
      data: { by: 'bob', sessionId: 's9', attempt: 3 },
      prevHash: null,
    },
    {
      type: 'issue-claimed',
      issueId: 'a-1',
      at: '2024-01-01T00:30:00.000Z',
      data: { by: 'bob', sessionId: 's9', attempt: 4 },
      prevHash: doc.events[0].hash,
    },
  ]);
});

test('a fractional ttl of half an hour expires thirty minutes after the claim time', () => {
  const doc = docWith({ state: 'open', attemptCount: 0 });
  const r = claimIssue(doc, 'a-1', { by: 'c', sessionId: 's', at: '2024-01-01T23:45:00.000Z', ttlHours: 0.5 });
  assert.deepEqual(r.claim, { by: 'c', sessionId: 's', at: '2024-01-01T23:45:00.000Z', expiresAt: '2024-01-02T00:15:00.000Z' });
});
