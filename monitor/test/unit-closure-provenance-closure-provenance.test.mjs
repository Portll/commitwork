// Determines how an issue was closed: auto, human, unmarked, or none (monitor/closure-provenance.mjs closureProvenance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closureProvenance } from '../closure-provenance.mjs';

test('returns none when there is no close event for the issue', () => {
  const r = closureProvenance([{ type: 'issue-opened', issueId: 1 }], 1);
  assert.deepEqual(r, { provenance: "none", closedAs: null, why: "no close event for this issue" });
});

test('returns none when events is null', () => {
  const r = closureProvenance(null, 1);
  assert.deepEqual(r, { provenance: "none", closedAs: null, why: "no close event for this issue" });
});

test('returns auto when the last close event has auto true', () => {
  const r = closureProvenance([{ type: 'issue-closed', issueId: 1, data: { auto: true, closedAs: 'duplicate' } }], 1);
  assert.deepEqual(r, { provenance: "auto", closedAs: "duplicate", why: "closed by the auto-close gate on ledger evidence" });
});

test('returns human when the last close event has non-empty evidence', () => {
  const r = closureProvenance([{ type: 'issue-closed', issueId: 1, data: { evidence: 'verified' } }], 1);
  assert.deepEqual(r, { provenance: "human", closedAs: null, why: "closed with recorded evidence" });
});

test('returns unmarked when the last close event has no auto flag and no evidence', () => {
  const r = closureProvenance([{ type: 'issue-closed', issueId: 1, data: {} }], 1);
  assert.deepEqual(r, { provenance: "unmarked", closedAs: null, why: "no auto flag and no evidence \u2014 provenance cannot be established from the record" });
});

test('returns unmarked when evidence is an empty string', () => {
  const r = closureProvenance([{ type: 'issue-closed', issueId: 1, data: { evidence: '' } }], 1);
  assert.deepEqual(r, { provenance: "unmarked", closedAs: null, why: "no auto flag and no evidence \u2014 provenance cannot be established from the record" });
});

test('returns unmarked when evidence is whitespace only', () => {
  const r = closureProvenance([{ type: 'issue-closed', issueId: 1, data: { evidence: '   ' } }], 1);
  assert.deepEqual(r, { provenance: "unmarked", closedAs: null, why: "no auto flag and no evidence \u2014 provenance cannot be established from the record" });
});

test('uses the last matching close event when multiple exist', () => {
  const r = closureProvenance([
    { type: 'issue-closed', issueId: 1, data: { auto: true } },
    { type: 'issue-closed', issueId: 1, data: { evidence: 'manual' } }
  ], 1);
  assert.deepEqual(r, { provenance: "human", closedAs: null, why: "closed with recorded evidence" });
});

test('ignores close events for a different issue id', () => {
  const r = closureProvenance([{ type: 'issue-closed', issueId: 2, data: { auto: true } }], 1);
  assert.deepEqual(r, { provenance: "none", closedAs: null, why: "no close event for this issue" });
});

test('returns unmarked when data is absent on the close event', () => {
  const r = closureProvenance([{ type: 'issue-closed', issueId: 1 }], 1);
  assert.deepEqual(r, { provenance: "unmarked", closedAs: null, why: "no auto flag and no evidence \u2014 provenance cannot be established from the record" });
});
