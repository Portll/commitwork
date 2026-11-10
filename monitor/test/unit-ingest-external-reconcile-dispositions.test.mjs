// stale disposition invalidation and waiver withdrawal (monitor/ingest-external.mjs reconcileDispositions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDispositions } from '../ingest-external.mjs';
import { subjectDigest } from '../ingest-external.mjs';

const NOW = '2026-01-02T03:04:05.000Z';
const EARLIER = '2025-06-07T08:09:10.000Z';
const SUBJECT = { title: 'lodash 4.17.20 advisory', severity: 'high', repo: 'demo' };
const OLD = `sha256:${'a'.repeat(64)}`;
const CURRENT = subjectDigest(SUBJECT);

const issue = (id, fields = {}) => ({ id, ...SUBJECT, events: [], history: [], ...fields });
const docOf = (...issues) => ({
  issues: Object.fromEntries(issues.map((i) => [i.id, i])),
  events: [],
});

test('a stale disposition is stamped with the time and exact reason when dryRun is not given', () => {
  const doc = docOf(issue('ISS1', { dispositions: [{ id: 'D1', subjectDigest: OLD, invalidatedAt: null }] }));
  const r = reconcileDispositions(doc, { now: NOW });
  assert.deepEqual(r, { invalidated: ['ISS1/D1'] });
  const d = doc.issues.ISS1.dispositions[0];
  assert.equal(d.invalidatedAt, NOW);
  assert.equal(
    d.invalidatedReason,
    `subject moved: judged sha256:${'a'.repeat(16)}\u2026, now ${CURRENT.slice(0, 23)}\u2026`,
  );
});

test('a dry run reports stale dispositions with a prefix and changes nothing', () => {
  const doc = docOf(issue('ISS2', {
    dispositions: [{ id: 'D2a', subjectDigest: OLD }, { id: 'D2b', subjectDigest: OLD }],
    waiver: { annotationId: 'D2a' },
  }));
  const r = reconcileDispositions(doc, { now: NOW, dryRun: true });
  assert.deepEqual(r, { invalidated: ['(dry) ISS2/D2a', '(dry) ISS2/D2b'] });
  assert.equal(doc.issues.ISS2.dispositions[0].invalidatedAt, undefined);
  assert.equal(doc.issues.ISS2.dispositions[1].invalidatedAt, undefined);
  assert.deepEqual(doc.issues.ISS2.waiver, { annotationId: 'D2a' });
});

test('an already invalidated disposition is skipped and keeps its original stamp', () => {
  const doc = docOf(issue('ISS3', {
    dispositions: [{ id: 'D3', subjectDigest: OLD, invalidatedAt: EARLIER }],
  }));
  const r = reconcileDispositions(doc, { now: NOW });
  assert.deepEqual(r, { invalidated: [] });
  assert.equal(doc.issues.ISS3.dispositions[0].invalidatedAt, EARLIER);
  assert.equal(doc.issues.ISS3.dispositions[0].invalidatedReason, undefined);
});

test('a disposition stays valid until a subject field changes the digest', () => {
  const doc = docOf(issue('ISS4', { dispositions: [{ id: 'D4', subjectDigest: CURRENT }] }));
  assert.deepEqual(reconcileDispositions(doc, { now: NOW }), { invalidated: [] });
  assert.equal(doc.issues.ISS4.dispositions[0].invalidatedAt, undefined);
  doc.issues.ISS4.severity = 'low';
  assert.deepEqual(reconcileDispositions(doc, { now: NOW }), { invalidated: ['ISS4/D4'] });
  assert.equal(doc.issues.ISS4.dispositions[0].invalidatedAt, NOW);
});

test('only the stale disposition is stamped among current and already invalidated ones', () => {
  const doc = docOf(issue('ISS5', {
    dispositions: [
      { id: 'D5a', subjectDigest: OLD },
      { id: 'D5b', subjectDigest: CURRENT },
      { id: 'D5c', subjectDigest: OLD, invalidatedAt: EARLIER },
    ],
  }));
  const r = reconcileDispositions(doc, { now: NOW });
  assert.deepEqual(r, { invalidated: ['ISS5/D5a'] });
  const [a, b, c] = doc.issues.ISS5.dispositions;
  assert.equal(a.invalidatedAt, NOW);
  assert.equal(b.invalidatedAt, undefined);
  assert.equal(b.invalidatedReason, undefined);
  assert.equal(c.invalidatedAt, EARLIER);
  assert.equal(c.invalidatedReason, undefined);
});

test('a waiver installed by an invalidated disposition is withdrawn', () => {
  const doc = docOf(issue('ISS6', {
    dispositions: [{ id: 'D6', subjectDigest: OLD }],
    waiver: { annotationId: 'D6' },
  }));
  const r = reconcileDispositions(doc, { now: NOW });
  assert.deepEqual(r, { invalidated: ['ISS6/D6'] });
  assert.equal(doc.issues.ISS6.waiver, null);
});

test('a waiver installed by a disposition that is still valid is kept', () => {
  const doc = docOf(issue('ISS7', {
    dispositions: [{ id: 'D7a', subjectDigest: OLD }, { id: 'D7b', subjectDigest: CURRENT }],
    waiver: { annotationId: 'D7b' },
  }));
  const r = reconcileDispositions(doc, { now: NOW });
  assert.deepEqual(r, { invalidated: ['ISS7/D7a'] });
  assert.deepEqual(doc.issues.ISS7.waiver, { annotationId: 'D7b' });
});

test('issues with missing, non-array or empty dispositions are skipped and later issues still run', () => {
  const doc = docOf(
    issue('A'),
    issue('B', { dispositions: 'D8' }),
    issue('C', { dispositions: [] }),
    issue('E', { dispositions: [{ id: 'D8', subjectDigest: OLD }] }),
  );
  const r = reconcileDispositions(doc, { now: NOW });
  assert.deepEqual(r, { invalidated: ['E/D8'] });
});

test('a doc without issues gives an empty result with or without options', () => {
  assert.deepEqual(reconcileDispositions({}), { invalidated: [] });
  assert.deepEqual(reconcileDispositions({ issues: null }, { now: NOW }), { invalidated: [] });
  assert.deepEqual(reconcileDispositions({ issues: {} }, { now: NOW }), { invalidated: [] });
});

test('stale dispositions are listed in issue order and a second run finds nothing', () => {
  const doc = docOf(
    issue('ISS10A', { dispositions: [{ id: 'D1', subjectDigest: OLD }, { id: 'D2', subjectDigest: OLD }] }),
    issue('ISS10B', { dispositions: [{ id: 'D3', subjectDigest: CURRENT }] }),
    issue('ISS10C', { dispositions: [{ id: 'D4', subjectDigest: OLD }] }),
  );
  const r = reconcileDispositions(doc, { now: EARLIER });
  assert.deepEqual(r, { invalidated: ['ISS10A/D1', 'ISS10A/D2', 'ISS10C/D4'] });
  assert.deepEqual(reconcileDispositions(doc, { now: NOW }), { invalidated: [] });
  assert.equal(doc.issues.ISS10A.dispositions[0].invalidatedAt, EARLIER);
  assert.equal(doc.issues.ISS10C.dispositions[0].invalidatedAt, EARLIER);
});
