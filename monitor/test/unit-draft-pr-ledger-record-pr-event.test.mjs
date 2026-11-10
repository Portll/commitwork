// Records a PR lifecycle event for an issue, deduplicating repeats (monitor/draft-pr-ledger.mjs recordPrEvent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordPrEvent } from '../draft-pr-ledger.mjs';

const doc = { issues: { i1: {} }, events: [] };

test('rejects a type outside the PR event types', () => {
  assert.throws(() => recordPrEvent(doc, 'i1', 'bogus', {}, '2024-01-01T00:00:00Z'), { name: 'Error', message: 'PR event type must be one of remediation-pr-opened|remediation-pr-not-opened|remediation-pr-merged|remediation-pr-closed' });
});

test('rejects an unknown issue id', () => {
  assert.throws(() => recordPrEvent(doc, 'nope', 'remediation-pr-merged', {}, '2024-01-01T00:00:00Z'), { name: 'Error', message: 'unknown issue nope' });
});

test('rejects a missing at instant', () => {
  assert.throws(() => recordPrEvent(doc, 'i1', 'remediation-pr-merged', {}, null), { name: 'Error', message: 'a PR event requires a parseable at instant' });
});

test('rejects an unparseable at instant', () => {
  assert.throws(() => recordPrEvent(doc, 'i1', 'remediation-pr-merged', {}, 'not-a-date'), { name: 'Error', message: 'a PR event requires a parseable at instant' });
});

test('rejects an opened event without a url', () => {
  assert.throws(() => recordPrEvent(doc, 'i1', 'remediation-pr-opened', {}, '2024-01-01T00:00:00Z'), { name: 'Error', message: 'an opened PR event requires its url' });
});

test('rejects a not-opened event without a reason', () => {
  assert.throws(() => recordPrEvent(doc, 'i1', 'remediation-pr-not-opened', {}, '2024-01-01T00:00:00Z'), { name: 'Error', message: 'a not-opened PR event requires its reason' });
});

test('returns null when a not-opened event repeats the last reason', () => {
  const d = { issues: { i1: {} }, events: [{ type: 'remediation-pr-not-opened', issueId: 'i1', data: { advisory: 'a1', reason: 'r1' } }] };
  assert.equal(recordPrEvent(d, 'i1', 'remediation-pr-not-opened', { advisory: 'a1', reason: 'r1' }, '2024-01-01T00:00:00Z'), null);
});

test('returns null when an opened event duplicates an open pr url', () => {
  const d = { issues: { i1: {} }, events: [{ type: 'remediation-pr-opened', issueId: 'i1', data: { advisory: 'a1', url: 'https://x/p1' } }] };
  assert.equal(recordPrEvent(d, 'i1', 'remediation-pr-opened', { advisory: 'a1', url: 'https://x/p1' }, '2024-01-01T00:00:00Z'), null);
});

test('appends a merged event for a known issue', () => {
  assert.deepEqual(recordPrEvent(doc, 'i1', 'remediation-pr-merged', { advisory: 'a1', url: 'https://x/p1' }, '2024-01-01T00:00:00Z'), { type: "remediation-pr-merged", issueId: "i1", at: "2024-01-01T00:00:00Z", data: { advisory: "a1", url: "https://x/p1" }, prevHash: null, hash: "f50c5e50ac4c719f2bd6521b8f6fd5b6d4505641c93e5a0f2b2849a97a6afdce" });
});
