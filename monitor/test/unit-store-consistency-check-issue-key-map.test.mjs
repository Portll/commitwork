// Detects orphan, widow, and mismatch anomalies between store.byKey and store.issues (monitor/store-consistency.mjs checkIssueKeyMap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIssueKeyMap } from '../store-consistency.mjs';

test('returns empty anomalies when store has no issues or byKey', () => {
  const r = checkIssueKeyMap({});
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 0, referents: 0, unkeyable: 0, resolvedDuplicates: 0, anomalies: [] });
});

test('flags orphan when byKey references an id missing from issues', () => {
  const r = checkIssueKeyMap({ issues: {}, byKey: { k1: 'i1' } });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 1, referents: 0, unkeyable: 0, resolvedDuplicates: 0, anomalies: [{ class: "orphan", key: "k1", issueId: "i1", detail: "byKey names an issue id that is not in issues{}" }] });
});

test('counts unkeyable when issue has no source key', () => {
  const r = checkIssueKeyMap({ issues: { i1: {} }, byKey: {} });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 0, referents: 1, unkeyable: 1, resolvedDuplicates: 0, anomalies: [] });
});

test('counts unkeyable when issue is null', () => {
  const r = checkIssueKeyMap({ issues: { i1: null }, byKey: {} });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 0, referents: 1, unkeyable: 1, resolvedDuplicates: 0, anomalies: [] });
});

test('counts unkeyable when issue has source but no key', () => {
  const r = checkIssueKeyMap({ issues: { i1: { source: {} } }, byKey: {} });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 0, referents: 1, unkeyable: 1, resolvedDuplicates: 0, anomalies: [] });
});

test('skips issue when byKey maps its source key to itself', () => {
  const r = checkIssueKeyMap({ issues: { i1: { source: { key: 'k1' } } }, byKey: { k1: 'i1' } });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 1, referents: 1, unkeyable: 0, resolvedDuplicates: 0, anomalies: [] });
});

test('flags widow when issue has key not in byKey', () => {
  const r = checkIssueKeyMap({ issues: { i1: { source: { key: 'k1' } } }, byKey: {} });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 0, referents: 1, unkeyable: 0, resolvedDuplicates: 0, anomalies: [{ class: "widow", key: "k1", issueId: "i1", detail: "issue carries a source key that byKey does not map" }] });
});

test('flags widow when byKey maps key to different id without deferral', () => {
  const r = checkIssueKeyMap({ issues: { i1: { source: { key: 'k1' } } }, byKey: { k1: 'i2' } });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 1, referents: 1, unkeyable: 0, resolvedDuplicates: 0, anomalies: [{ class: "orphan", key: "k1", issueId: "i2", detail: "byKey names an issue id that is not in issues{}" }, { class: "widow", key: "k1", issueId: "i1", detail: "byKey maps this key to i2, and this issue does not defer to it" }] });
});

test('counts resolved duplicate when issue defers via duplicateOf', () => {
  const r = checkIssueKeyMap({ issues: { i1: { source: { key: 'k1' }, deps: { duplicateOf: 'i2' } } }, byKey: { k1: 'i2' } });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 1, referents: 1, unkeyable: 0, resolvedDuplicates: 1, anomalies: [{ class: "orphan", key: "k1", issueId: "i2", detail: "byKey names an issue id that is not in issues{}" }] });
});

test('counts resolved duplicate when issue defers via supersededBy', () => {
  const r = checkIssueKeyMap({ issues: { i1: { source: { key: 'k1' }, deps: { supersededBy: 'i2' } } }, byKey: { k1: 'i2' } });
  assert.deepEqual(r, { pair: "issues.byKey\u2192issues", ok: true, referrer: "byKey", referrers: 1, referents: 1, unkeyable: 0, resolvedDuplicates: 1, anomalies: [{ class: "orphan", key: "k1", issueId: "i2", detail: "byKey names an issue id that is not in issues{}" }] });
});
