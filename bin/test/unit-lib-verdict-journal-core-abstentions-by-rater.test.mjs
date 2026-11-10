// Maps abstention records to per-rater declined and recording sets (bin/lib/verdict-journal-core.mjs abstentionsByRater).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abstentionsByRater } from '../lib/verdict-journal-core.mjs';

test('skips non-abstention records', () => {
  const r = abstentionsByRater([{ kind: 'adjudication', gate: 'g1', recordAt: 't1', method: 'r1' }]);
  assert.deepEqual(r, { declined: new Map([]), recording: new Set([]) });
});

test('skips abstentions without a gate', () => {
  const r = abstentionsByRater([{ kind: 'adjudication-abstention', recordAt: 't1', method: 'r1' }]);
  assert.deepEqual(r, { declined: new Map([]), recording: new Set([]) });
});

test('skips abstentions without a recordAt', () => {
  const r = abstentionsByRater([{ kind: 'adjudication-abstention', gate: 'g1', method: 'r1' }]);
  assert.deepEqual(r, { declined: new Map([]), recording: new Set([]) });
});

test('skips abstentions without a rater', () => {
  const r = abstentionsByRater([{ kind: 'adjudication-abstention', gate: 'g1', recordAt: 't1' }]);
  assert.deepEqual(r, { declined: new Map([]), recording: new Set([]) });
});

test('records a valid abstention', () => {
  const r = abstentionsByRater([{ kind: 'adjudication-abstention', gate: 'g1', recordAt: 't1', method: 'r1' }]);
  assert.deepEqual(r, { declined: new Map([["r1", new Set(["g1@t1"])]]), recording: new Set(["r1"]) });
});

test('collapses duplicate abstentions for the same rater and gate', () => {
  const rec = { kind: 'adjudication-abstention', gate: 'g1', recordAt: 't1', method: 'r1' };
  const r = abstentionsByRater([rec, { ...rec }, { ...rec }]);
  assert.deepEqual(r, { declined: new Map([["r1", new Set(["g1@t1"])]]), recording: new Set(["r1"]) });
});

test('distinguishes model-default sampling from pinned sampling for the same rater', () => {
  const pinned = { kind: 'adjudication-abstention', gate: 'g1', recordAt: 't1', method: 'r1' };
  const modelDefault = { kind: 'adjudication-abstention', gate: 'g1', recordAt: 't1', method: 'r1', sampling: 'model-default' };
  const r = abstentionsByRater([pinned, modelDefault]);
  assert.deepEqual(r, { declined: new Map([["r1", new Set(["g1@t1"])], ["r1 [model-default sampling]", new Set(["g1@t1"])]]), recording: new Set(["r1", "r1 [model-default sampling]"]) });
});

test('handles multiple raters with distinct gates', () => {
  const r = abstentionsByRater([
    { kind: 'adjudication-abstention', gate: 'g1', recordAt: 't1', method: 'r1' },
    { kind: 'adjudication-abstention', gate: 'g2', recordAt: 't2', method: 'r2' },
    { kind: 'adjudication-abstention', gate: 'g1', recordAt: 't3', method: 'r1' }
  ]);
  assert.deepEqual(r, { declined: new Map([["r1", new Set(["g1@t1", "g1@t3"])], ["r2", new Set(["g2@t2"])]]), recording: new Set(["r1", "r2"]) });
});
