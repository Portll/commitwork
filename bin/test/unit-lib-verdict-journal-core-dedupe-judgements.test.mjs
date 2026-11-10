// Deduplicate adjudication records by gate, recordAt, and rater, keeping the latest judgement per key (bin/lib/verdict-journal-core.mjs dedupeJudgements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeJudgements } from '../lib/verdict-journal-core.mjs';

test('returns empty records and zero collapsed for empty input', () => {
  const r = dedupeJudgements([]);
  assert.deepEqual(r, { records: [], collapsed: 0 });
});

test('keeps non-adjudication records as-is and reports zero collapsed', () => {
  const r = dedupeJudgements([{ kind: 'note', gate: 'g1', recordAt: 'r1' }]);
  assert.deepEqual(r, { records: [{ kind: "note", gate: "g1", recordAt: "r1" }], collapsed: 0 });
});

test('keeps a single identifiable adjudication with zero collapsed', () => {
  const r = dedupeJudgements([{ kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm1' }]);
  assert.deepEqual(r, { records: [{ kind: "adjudication", gate: "g1", recordAt: "r1", method: "m1" }], collapsed: 0 });
});

test('collapses duplicate adjudications with same key keeping the latest', () => {
  const r = dedupeJudgements([
    { kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm1', verdict: 'first' },
    { kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm1', verdict: 'second' }
  ]);
  assert.deepEqual(r, { records: [{ kind: "adjudication", gate: "g1", recordAt: "r1", method: "m1", verdict: "second" }], collapsed: 1 });
});

test('keeps adjudications with different raters as separate records', () => {
  const r = dedupeJudgements([
    { kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm1' },
    { kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm2' }
  ]);
  assert.deepEqual(r, { records: [{ kind: "adjudication", gate: "g1", recordAt: "r1", method: "m1" }, { kind: "adjudication", gate: "g1", recordAt: "r1", method: "m2" }], collapsed: 0 });
});

test('keeps unidentifiable adjudication missing recordAt', () => {
  const r = dedupeJudgements([{ kind: 'adjudication', gate: 'g1', method: 'm1' }]);
  assert.deepEqual(r, { records: [{ kind: "adjudication", gate: "g1", method: "m1" }], collapsed: 0 });
});

test('keeps unidentifiable adjudication missing gate', () => {
  const r = dedupeJudgements([{ kind: 'adjudication', recordAt: 'r1', method: 'm1' }]);
  assert.deepEqual(r, { records: [{ kind: "adjudication", recordAt: "r1", method: "m1" }], collapsed: 0 });
});

test('keeps unidentifiable adjudication missing rater', () => {
  const r = dedupeJudgements([{ kind: 'adjudication', gate: 'g1', recordAt: 'r1' }]);
  assert.deepEqual(r, { records: [{ kind: "adjudication", gate: "g1", recordAt: "r1" }], collapsed: 0 });
});

test('treats model-default sampling as different rater from pinned', () => {
  const r = dedupeJudgements([
    { kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm1', sampling: 'model-default' },
    { kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm1' }
  ]);
  assert.deepEqual(r, { records: [{ kind: "adjudication", gate: "g1", recordAt: "r1", method: "m1", sampling: "model-default" }, { kind: "adjudication", gate: "g1", recordAt: "r1", method: "m1" }], collapsed: 0 });
});

test('keeps ambiguous records without collapsing', () => {
  const r = dedupeJudgements(
    [
      { kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm1' },
      { kind: 'adjudication', gate: 'g1', recordAt: 'r1', method: 'm1' }
    ],
    { ambiguous: new Set(['g1@r1']) }
  );
  assert.deepEqual(r, { records: [{ kind: "adjudication", gate: "g1", recordAt: "r1", method: "m1" }, { kind: "adjudication", gate: "g1", recordAt: "r1", method: "m1" }], collapsed: 0 });
});
