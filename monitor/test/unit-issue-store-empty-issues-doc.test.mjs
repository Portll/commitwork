// emptyIssuesDoc creates a fresh issue tracker document with default fields (monitor/issue-store.mjs emptyIssuesDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyIssuesDoc } from '../issue-store.mjs';

test('emptyIssuesDoc returns the default document structure', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});

test('emptyIssuesDoc result is consistent on repeated calls', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});

test('emptyIssuesDoc does not depend on environment variables when none are set', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});

test('emptyIssuesDoc produces the same object shape regardless of call order', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});

test('emptyIssuesDoc returns an object with a note property', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});

test('emptyIssuesDoc includes a version field', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});

test('emptyIssuesDoc sets organisation to null when CW_ISSUE_ORG is unset', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});

test('emptyIssuesDoc initializes nextOrdinal to zero', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});

test('emptyIssuesDoc starts with empty byKey, lastIngest, events, and issues objects', () => {
  assert.deepEqual(emptyIssuesDoc(), { note: "commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); issues{} is derived current state. Never edit by hand; linear git history only. Verify: node bin/issue.mjs verify", version: 1, organisation: null, nextOrdinal: 0, byKey: {}, lastIngest: {}, events: [], issues: {} });
});
