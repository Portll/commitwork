// Computes the set of currently open remediation PRs from a ledger document (monitor/draft-pr-ledger.mjs openPrs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPrs } from '../draft-pr-ledger.mjs';

test('returns an empty array when the document has no events', () => {
  const doc = { events: [] };
  const r = openPrs(doc);
  assert.deepEqual(r, []);
});

test('returns an empty array when the only event has no url', () => {
  const doc = { events: [{ type: 'remediation-pr-opened', data: {} }] };
  const r = openPrs(doc);
  assert.deepEqual(r, []);
});

test('returns the opened event when a single opened event has a url', () => {
  const doc = { events: [{ type: 'remediation-pr-opened', data: { url: 'https://pr/1' } }] };
  const r = openPrs(doc);
  assert.deepEqual(r, [{ type: "remediation-pr-opened", data: { url: "https://pr/1" } }]);
});

test('returns an empty array when an opened event is later merged', () => {
  const doc = { events: [
    { type: 'remediation-pr-opened', data: { url: 'https://pr/1' } },
    { type: 'remediation-pr-merged', data: { url: 'https://pr/1' } }
  ]};
  const r = openPrs(doc);
  assert.deepEqual(r, []);
});

test('returns an empty array when an opened event is later closed', () => {
  const doc = { events: [
    { type: 'remediation-pr-opened', data: { url: 'https://pr/1' } },
    { type: 'remediation-pr-closed', data: { url: 'https://pr/1' } }
  ]};
  const r = openPrs(doc);
  assert.deepEqual(r, []);
});

test('returns the opened event when a merged event has no url', () => {
  const doc = { events: [
    { type: 'remediation-pr-opened', data: { url: 'https://pr/1' } },
    { type: 'remediation-pr-merged', data: {} }
  ]};
  const r = openPrs(doc);
  assert.deepEqual(r, [{ type: "remediation-pr-opened", data: { url: "https://pr/1" } }]);
});

test('returns the opened event when a not-opened event has a url', () => {
  const doc = { events: [
    { type: 'remediation-pr-opened', data: { url: 'https://pr/1' } },
    { type: 'remediation-pr-not-opened', data: { url: 'https://pr/1' } }
  ]};
  const r = openPrs(doc);
  assert.deepEqual(r, [{ type: "remediation-pr-opened", data: { url: "https://pr/1" } }]);
});

test('returns the opened event when a merged event has a different url', () => {
  const doc = { events: [
    { type: 'remediation-pr-opened', data: { url: 'https://pr/1' } },
    { type: 'remediation-pr-merged', data: { url: 'https://pr/2' } }
  ]};
  const r = openPrs(doc);
  assert.deepEqual(r, [{ type: "remediation-pr-opened", data: { url: "https://pr/1" } }]);
});
