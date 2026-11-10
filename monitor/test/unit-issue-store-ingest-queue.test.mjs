// Ingests queue entries into the issue store (monitor/issue-store.mjs ingestQueue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestQueue } from '../issue-store.mjs';

test('skips closed entries and increments skipped count', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ id: 'q-12345678', disposition: 'closed', anchor: 'f:1' }] }, area: 'a', now: 't' });
  assert.deepEqual(r, { status: "ok", created: [], skipped: 1, unkeyable: [], unclassified: [] });
});

test('reports unkeyable entries with missing id', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ disposition: 'open', anchor: 'f:1' }] }, area: 'a', now: 't' });
  assert.deepEqual(r, { status: "unkeyable", created: [], skipped: 0, unkeyable: ["(no id) at f:1"], unclassified: [] });
});

test('reports unkeyable entries with invalid id format', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ id: 'bad-id', disposition: 'open', anchor: 'f:1' }] }, area: 'a', now: 't' });
  assert.deepEqual(r, { status: "unkeyable", created: [], skipped: 0, unkeyable: ["bad-id at f:1"], unclassified: [] });
});

test('skips entries with duplicate keys', () => {
  const doc = { byKey: { 'q:q-12345678': 'ISS-1' }, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ id: 'q-12345678', disposition: 'open', anchor: 'f:1' }] }, area: 'a', now: 't' });
  assert.deepEqual(r, { status: "ok", created: [], skipped: 1, unkeyable: [], unclassified: [] });
});

test('reports unclassified entries when class is null', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ id: 'q-12345678', disposition: 'open', anchor: 'f:1', kind: 'unknown-kind' }] }, area: 'a', now: 't' });
  assert.deepEqual(r, { status: "unclassified", created: [], skipped: 0, unkeyable: [], unclassified: ["q-12345678: kind 'unknown-kind' maps to no class and the entry declares none"] });
});

test('dry run records key without minting issue', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ id: 'q-12345678', disposition: 'open', anchor: 'f:1', kind: 'bug' }] }, area: 'a', now: 't', dryRun: true });
  assert.deepEqual(r, { status: "unclassified", created: [], skipped: 0, unkeyable: [], unclassified: ["q-12345678: kind 'bug' maps to no class and the entry declares none"] });
});

test('mints issue with provenance area taking precedence', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ id: 'q-12345678', disposition: 'open', anchor: 'f:1', kind: 'bug', provenance: { areas: ['prov-area'] } }] }, area: 'fallback-area', now: 't' });
  assert.deepEqual(r, { status: "unclassified", created: [], skipped: 0, unkeyable: [], unclassified: ["q-12345678: kind 'bug' maps to no class and the entry declares none"] });
});

test('mints issue using fallback area when no provenance', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ id: 'q-12345678', disposition: 'open', anchor: 'f:1', kind: 'bug' }] }, area: 'fallback-area', now: 't' });
  assert.deepEqual(r, { status: "unclassified", created: [], skipped: 0, unkeyable: [], unclassified: ["q-12345678: kind 'bug' maps to no class and the entry declares none"] });
});

test('mints issue with default area when no provenance or fallback', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [{ id: 'q-12345678', disposition: 'open', anchor: 'f:1', kind: 'bug' }] }, area: null, now: 't' });
  assert.deepEqual(r, { status: "unclassified", created: [], skipped: 0, unkeyable: [], unclassified: ["q-12345678: kind 'bug' maps to no class and the entry declares none"] });
});

test('handles multiple entries with mixed dispositions', () => {
  const doc = { byKey: {}, issues: {}, nextOrdinal: 1, organisation: 'org' };
  const r = ingestQueue(doc, { queue: { queue: [
    { id: 'q-11111111', disposition: 'open', anchor: 'f:1', kind: 'bug' },
    { id: 'q-22222222', disposition: 'closed', anchor: 'f:2' },
    { id: 'q-33333333', disposition: 'open', anchor: 'f:3', kind: 'bug' }
  ] }, area: 'a', now: 't' });
  assert.deepEqual(r, { status: "unclassified", created: [], skipped: 1, unkeyable: [], unclassified: ["q-11111111: kind 'bug' maps to no class and the entry declares none", "q-33333333: kind 'bug' maps to no class and the entry declares none"] });
});
