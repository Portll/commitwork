// Detects orphan and widow anomalies between issue events and issue records (monitor/store-consistency.mjs checkIssueEvents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIssueEvents } from '../store-consistency.mjs';

test('returns unknown when events is not an array', () => {
  const r = checkIssueEvents({ issues: { a: {} }, events: null });
  assert.deepEqual(r, { pair: "issues.events\u2192issues", unknown: true, unknownReason: "not-recorded", unknownDetail: "no events[] array in the issue store" });
});

test('returns unknown when events is undefined', () => {
  const r = checkIssueEvents({ issues: { a: {} } });
  assert.deepEqual(r, { pair: "issues.events\u2192issues", unknown: true, unknownReason: "not-recorded", unknownDetail: "no events[] array in the issue store" });
});

test('returns ok with no anomalies when events and issues are both empty', () => {
  const r = checkIssueEvents({ issues: {}, events: [] });
  assert.deepEqual(r, { pair: "issues.events\u2192issues", ok: true, referrer: "events[]", referrers: 0, referents: 0, anomalies: [] });
});

test('detects orphan when event references issue not in issues', () => {
  const r = checkIssueEvents({ issues: {}, events: [{ type: 'issue-opened', issueId: 'x' }] });
  assert.deepEqual(r, { pair: "issues.events\u2192issues", ok: true, referrer: "events[]", referrers: 1, referents: 0, anomalies: [{ class: "orphan", key: "x", detail: "the event log records this issue; issues{} does not contain it" }] });
});

test('detects widow when issue exists without opened event', () => {
  const r = checkIssueEvents({ issues: { a: {} }, events: [{ type: 'issue-closed', issueId: 'a' }] });
  assert.deepEqual(r, { pair: "issues.events\u2192issues", ok: true, referrer: "events[]", referrers: 1, referents: 1, anomalies: [{ class: "widow", key: "a", detail: "issue present in derived state with no issue-opened event \u2014 state without history" }] });
});

test('returns no anomalies when issue has matching opened event', () => {
  const r = checkIssueEvents({ issues: { a: {} }, events: [{ type: 'issue-opened', issueId: 'a' }] });
  assert.deepEqual(r, { pair: "issues.events\u2192issues", ok: true, referrer: "events[]", referrers: 1, referents: 1, anomalies: [] });
});

test('skips null events and non-string issueId entries', () => {
  const r = checkIssueEvents({ issues: { a: {} }, events: [null, { issueId: 42 }, { type: 'issue-opened', issueId: 'a' }] });
  assert.deepEqual(r, { pair: "issues.events\u2192issues", ok: true, referrer: "events[]", referrers: 3, referents: 1, anomalies: [] });
});

test('detects both orphan and widow anomalies together', () => {
  const r = checkIssueEvents({ issues: { b: {} }, events: [{ type: 'issue-opened', issueId: 'a' }] });
  assert.deepEqual(r, { pair: "issues.events\u2192issues", ok: true, referrer: "events[]", referrers: 1, referents: 1, anomalies: [{ class: "orphan", key: "a", detail: "the event log records this issue; issues{} does not contain it" }, { class: "widow", key: "b", detail: "issue present in derived state with no issue-opened event \u2014 state without history" }] });
});
