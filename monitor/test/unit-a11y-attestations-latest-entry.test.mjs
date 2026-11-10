// Newest entry for one area+criterion, or null (monitor/a11y-attestations.mjs latestEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestEntry } from '../a11y-attestations.mjs';

test('returns the newest matching entry when multiple match', () => {
  const doc = { entries: [
    { area: 'a', criterion: 'c', ts: '1' },
    { area: 'a', criterion: 'c', ts: '2' },
    { area: 'a', criterion: 'c', ts: '3' }
  ]};
  const r = latestEntry(doc, 'a', 'c');
  assert.deepEqual(r, { area: "a", criterion: "c", ts: "3" });
});

test('returns null when no entry matches the key', () => {
  const doc = { entries: [
    { area: 'a', criterion: 'c', ts: '1' },
    { area: 'b', criterion: 'd', ts: '2' }
  ]};
  const r = latestEntry(doc, 'x', 'y');
  assert.equal(r, null);
});

test('returns the only entry when it is the sole match at index zero', () => {
  const doc = { entries: [
    { area: 'a', criterion: 'c', ts: '1' }
  ]};
  const r = latestEntry(doc, 'a', 'c');
  assert.deepEqual(r, { area: "a", criterion: "c", ts: "1" });
});

test('returns the last entry when it is the only match', () => {
  const doc = { entries: [
    { area: 'x', criterion: 'y', ts: '1' },
    { area: 'a', criterion: 'c', ts: '2' }
  ]};
  const r = latestEntry(doc, 'a', 'c');
  assert.deepEqual(r, { area: "a", criterion: "c", ts: "2" });
});

test('returns null when doc is null', () => {
  const r = latestEntry(null, 'a', 'c');
  assert.equal(r, null);
});

test('returns null when entries is not an array', () => {
  const doc = { entries: 'not-an-array' };
  const r = latestEntry(doc, 'a', 'c');
  assert.equal(r, null);
});

test('returns the newest match when a non-matching entry follows it', () => {
  const doc = { entries: [
    { area: 'a', criterion: 'c', ts: '1' },
    { area: 'a', criterion: 'c', ts: '2' },
    { area: 'z', criterion: 'z', ts: '3' }
  ]};
  const r = latestEntry(doc, 'a', 'c');
  assert.deepEqual(r, { area: "a", criterion: "c", ts: "2" });
});

test('returns null for empty entries array', () => {
  const doc = { entries: [] };
  const r = latestEntry(doc, 'a', 'c');
  assert.equal(r, null);
});
