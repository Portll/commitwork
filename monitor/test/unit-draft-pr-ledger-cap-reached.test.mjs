// Determines whether the open-PR or daily-PR cap is reached (monitor/draft-pr-ledger.mjs capReached).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capReached } from '../draft-pr-ledger.mjs';

const OPENED = 'remediation-pr-opened';
const MERGED = 'remediation-pr-merged';
const CLOSED = 'remediation-pr-closed';
const NOT_OPENED = 'remediation-pr-not-opened';

function makeDoc(events) {
  return { events };
}

function openedEvent(url, upstream, at, existing = false) {
  return { type: OPENED, at, data: { url, upstream, existing } };
}

function mergedEvent(url, upstream, at) {
  return { type: MERGED, at, data: { url, upstream } };
}

function closedEvent(url, upstream, at) {
  return { type: CLOSED, at, data: { url, upstream } };
}

function notOpenedEvent(url, upstream, at, existing = false) {
  return { type: NOT_OPENED, at, data: { url, upstream, existing } };
}

test('returns null when no open PRs and no new PRs opened today', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'other-repo', '2024-01-01T00:00:00Z'),
    mergedEvent('https://github.com/org/repo/pull/1', 'other-repo', '2024-01-01T01:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 1, maxOpenPerDay: 1 });
  assert.deepEqual(r, null);
});

test('returns cap-per-repo when open PRs for the slug equal maxOpenPerRepo', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'my-repo', '2024-01-01T00:00:00Z'),
    openedEvent('https://github.com/org/repo/pull/2', 'my-repo', '2024-01-02T00:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 2, maxOpenPerDay: 10 });
  assert.deepEqual(r, { reason: "cap-per-repo", detail: "2 open on my-repo; maxOpenPerRepo is 2" });
});

test('returns null when open PRs for the slug are below maxOpenPerRepo and perDay is below maxOpenPerDay', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'my-repo', '2024-01-01T00:00:00Z'),
    openedEvent('https://github.com/org/repo/pull/2', 'other-repo', '2024-01-01T00:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 2, maxOpenPerDay: 10 });
  assert.deepEqual(r, null);
});

test('returns cap-per-day when new PRs opened on the day equal maxOpenPerDay', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'other-repo', '2024-01-15T00:00:00Z'),
    openedEvent('https://github.com/org/repo/pull/2', 'other-repo', '2024-01-15T01:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 10, maxOpenPerDay: 2 });
  assert.deepEqual(r, { reason: "cap-per-day", detail: "2 opened on 2024-01-15; maxOpenPerDay is 2" });
});

test('returns null when perDay is below maxOpenPerDay and perRepo is below maxOpenPerRepo', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'other-repo', '2024-01-15T00:00:00Z'),
    openedEvent('https://github.com/org/repo/pull/2', 'other-repo', '2024-01-14T00:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 10, maxOpenPerDay: 2 });
  assert.deepEqual(r, null);
});

test('excludes existing PRs from perDay count', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'other-repo', '2024-01-15T00:00:00Z', true),
    openedEvent('https://github.com/org/repo/pull/2', 'other-repo', '2024-01-15T01:00:00Z', true),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 10, maxOpenPerDay: 1 });
  assert.deepEqual(r, null);
});

test('excludes non-OPENED PR events from perDay count', () => {
  const doc = makeDoc([
    notOpenedEvent('https://github.com/org/repo/pull/1', 'other-repo', '2024-01-15T00:00:00Z'),
    notOpenedEvent('https://github.com/org/repo/pull/2', 'other-repo', '2024-01-15T01:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 10, maxOpenPerDay: 1 });
  assert.deepEqual(r, null);
});

test('merged PRs are not counted as open for perRepo', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'my-repo', '2024-01-01T00:00:00Z'),
    mergedEvent('https://github.com/org/repo/pull/1', 'my-repo', '2024-01-02T00:00:00Z'),
    openedEvent('https://github.com/org/repo/pull/2', 'my-repo', '2024-01-03T00:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 1, maxOpenPerDay: 10 });
  assert.deepEqual(r, { reason: "cap-per-repo", detail: "1 open on my-repo; maxOpenPerRepo is 1" });
});

test('closed PRs are not counted as open for perRepo', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'my-repo', '2024-01-01T00:00:00Z'),
    closedEvent('https://github.com/org/repo/pull/1', 'my-repo', '2024-01-02T00:00:00Z'),
    openedEvent('https://github.com/org/repo/pull/2', 'my-repo', '2024-01-03T00:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 1, maxOpenPerDay: 10 });
  assert.deepEqual(r, { reason: "cap-per-repo", detail: "1 open on my-repo; maxOpenPerRepo is 1" });
});

test('returns cap-per-repo when perRepo exceeds maxOpenPerRepo', () => {
  const doc = makeDoc([
    openedEvent('https://github.com/org/repo/pull/1', 'my-repo', '2024-01-01T00:00:00Z'),
    openedEvent('https://github.com/org/repo/pull/2', 'my-repo', '2024-01-02T00:00:00Z'),
    openedEvent('https://github.com/org/repo/pull/3', 'my-repo', '2024-01-03T00:00:00Z'),
  ]);
  const r = capReached(doc, { slug: 'my-repo', at: '2024-01-15T12:00:00Z', maxOpenPerRepo: 2, maxOpenPerDay: 10 });
  assert.deepEqual(r, { reason: "cap-per-repo", detail: "3 open on my-repo; maxOpenPerRepo is 2" });
});
