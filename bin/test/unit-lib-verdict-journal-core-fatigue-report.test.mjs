// Names suppressed-but-never-adjudicated targets with counts and sentences (bin/lib/verdict-journal-core.mjs fatigueReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fatigueReport } from '../lib/verdict-journal-core.mjs';

test('returns empty targets and empty true for null records', () => {
  const r = fatigueReport(null);
  assert.deepEqual(r, { targets: [], empty: true });
});

test('returns empty targets and empty true for empty array', () => {
  const r = fatigueReport([]);
  assert.deepEqual(r, { targets: [], empty: true });
});

test('skips null entries in records array', () => {
  const r = fatigueReport([null, { kind: 'suppression-label', target: 'a', count: 1 }]);
  assert.deepEqual(r, { targets: [{ target: "a", count: 1, labels: 1, everExpiring: false, sentence: "a: suppressed 1 times, never adjudicated \u2014 adjudicate or retune" }], empty: false });
});

test('excludes targets that have a finding-adjudication record', () => {
  const r = fatigueReport([
    { kind: 'finding-adjudication', findingKey: 'a' },
    { kind: 'suppression-label', target: 'a', count: 5 }
  ]);
  assert.deepEqual(r, { targets: [], empty: true });
});

test('includes suppression-label targets without adjudication', () => {
  const r = fatigueReport([
    { kind: 'suppression-label', target: 'x', count: 3 }
  ]);
  assert.deepEqual(r, { targets: [{ target: "x", count: 3, labels: 1, everExpiring: false, sentence: "x: suppressed 3 times, never adjudicated \u2014 adjudicate or retune" }], empty: false });
});

test('accumulates count across multiple suppression-label records for same target', () => {
  const r = fatigueReport([
    { kind: 'suppression-label', target: 't', count: 2 },
    { kind: 'suppression-label', target: 't', count: 3 }
  ]);
  assert.deepEqual(r, { targets: [{ target: "t", count: 5, labels: 2, everExpiring: false, sentence: "t: suppressed 5 times, never adjudicated \u2014 adjudicate or retune" }], empty: false });
});

test('treats non-finite count as zero contribution', () => {
  const r = fatigueReport([
    { kind: 'suppression-label', target: 'z', count: 'abc' }
  ]);
  assert.deepEqual(r, { targets: [{ target: "z", count: 0, labels: 1, everExpiring: false, sentence: "z: suppressed 0 times, never adjudicated \u2014 adjudicate or retune" }], empty: false });
});

test('sets everExpiring true when any record has expires', () => {
  const r = fatigueReport([
    { kind: 'suppression-label', target: 'e', count: 1, expires: '2025-01-01' }
  ]);
  assert.deepEqual(r, { targets: [{ target: "e", count: 1, labels: 1, everExpiring: true, sentence: "e: suppressed 1 times, never adjudicated \u2014 adjudicate or retune" }], empty: false });
});

test('respects limit option to cap returned targets', () => {
  const records = Array.from({ length: 5 }, (_, i) => ({ kind: 'suppression-label', target: `t${i}`, count: 5 - i }));
  const r = fatigueReport(records, { limit: 2 });
  assert.deepEqual(r, { targets: [{ target: "t0", count: 5, labels: 1, everExpiring: false, sentence: "t0: suppressed 5 times, never adjudicated \u2014 adjudicate or retune" }, { target: "t1", count: 4, labels: 1, everExpiring: false, sentence: "t1: suppressed 4 times, never adjudicated \u2014 adjudicate or retune" }], empty: false });
});

test('sorts targets by count descending', () => {
  const r = fatigueReport([
    { kind: 'suppression-label', target: 'low', count: 1 },
    { kind: 'suppression-label', target: 'high', count: 10 },
    { kind: 'suppression-label', target: 'mid', count: 5 }
  ]);
  assert.deepEqual(r, { targets: [{ target: "high", count: 10, labels: 1, everExpiring: false, sentence: "high: suppressed 10 times, never adjudicated \u2014 adjudicate or retune" }, { target: "mid", count: 5, labels: 1, everExpiring: false, sentence: "mid: suppressed 5 times, never adjudicated \u2014 adjudicate or retune" }, { target: "low", count: 1, labels: 1, everExpiring: false, sentence: "low: suppressed 1 times, never adjudicated \u2014 adjudicate or retune" }], empty: false });
});
