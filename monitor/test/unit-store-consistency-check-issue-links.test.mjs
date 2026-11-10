// Detects orphaned issue dependency links (monitor/store-consistency.mjs checkIssueLinks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIssueLinks } from '../store-consistency.mjs';

test('returns empty result for store without issues property', () => {
  const r = checkIssueLinks({});
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 0, referents: 0, anomalies: [] });
});

test('returns empty result for store with empty issues object', () => {
  const r = checkIssueLinks({ issues: {} });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 0, referents: 0, anomalies: [] });
});

test('counts one link when issue has duplicateOf pointing to existing issue', () => {
  const r = checkIssueLinks({ issues: { a: { deps: { duplicateOf: 'b' } }, b: {} } });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 1, referents: 2, anomalies: [] });
});

test('reports orphan when duplicateOf points to missing issue', () => {
  const r = checkIssueLinks({ issues: { a: { deps: { duplicateOf: 'zzz' } } } });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 1, referents: 1, anomalies: [{ class: "orphan", key: "a.duplicateOf", issueId: "a", detail: "duplicateOf names zzz, which is not in issues{}" }] });
});

test('reports orphan when supersededBy points to missing issue', () => {
  const r = checkIssueLinks({ issues: { a: { deps: { supersededBy: 'zzz' } } } });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 1, referents: 1, anomalies: [{ class: "orphan", key: "a.supersededBy", issueId: "a", detail: "supersededBy names zzz, which is not in issues{}" }] });
});

test('reports orphan for each blockedBy entry pointing to missing issues', () => {
  const r = checkIssueLinks({ issues: { a: { deps: { blockedBy: ['x', 'y'] } } } });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 2, referents: 1, anomalies: [{ class: "orphan", key: "a.blockedBy", issueId: "a", detail: "blockedBy names x, which is not in issues{}" }, { class: "orphan", key: "a.blockedBy", issueId: "a", detail: "blockedBy names y, which is not in issues{}" }] });
});

test('skips null target in duplicateOf without counting link', () => {
  const r = checkIssueLinks({ issues: { a: { deps: { duplicateOf: null } } } });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 0, referents: 1, anomalies: [] });
});

test('handles issue with null value without throwing', () => {
  const r = checkIssueLinks({ issues: { a: null } });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 0, referents: 1, anomalies: [] });
});

test('handles issue with undefined deps without throwing', () => {
  const r = checkIssueLinks({ issues: { a: {} } });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 0, referents: 1, anomalies: [] });
});

test('counts multiple link types on same issue', () => {
  const r = checkIssueLinks({ issues: { a: { deps: { duplicateOf: 'b', supersededBy: 'c', blockedBy: ['d'] } }, b: {}, c: {}, d: {} } });
  assert.deepEqual(r, { pair: "issues.deps\u2192issues", ok: true, referrer: "deps", referrers: 3, referents: 4, anomalies: [] });
});
