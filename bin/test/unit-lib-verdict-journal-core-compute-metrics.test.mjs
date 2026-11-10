// Per-gate adjudication rates split into live, retrospective, canary and model-default cohorts (bin/lib/verdict-journal-core.mjs computeMetrics).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../lib/verdict-journal-core.mjs';

const T1 = '2026-05-01T00:00:00.000Z';
const empty = {
  adjudicated: 0, 'true-alarm': 0, 'false-alarm': 0, 'true-clean': 0, 'false-clean': 0,
  attributionScored: 0, attributionCorrect: 0, attributionPreEpoch: 0, attributionOnly: 0,
  catchRate: null, catchObservable: false, falseCleanRate: null, falseCleanN: 0,
  falseAlarmRate: null, falseAlarmN: 0, attributionAccuracy: null,
};
const cohort = (o = {}) => ({ ...empty, ...o });
const gateOut = (headline, o = {}) => ({
  ...headline, records: null, unadjudicated: null, live: headline, retrospective: cohort(), canary: cohort(),
  modelDefault: cohort(), combined: headline, dangling: null, ambiguous: 0, attributionEpoch: null, ...o,
});
const adj = (o) => ({ kind: 'adjudication', gate: 'g1', ...o });

test('a live judgement found in the journal counts in live and headline and clears the backlog', () => {
  const r = computeMetrics([adj({ recordAt: T1, truth: 'true-alarm' })], { g1: 1 }, { recordAtIndex: { g1: new Set([T1]) } });
  const live = cohort({ adjudicated: 1, 'true-alarm': 1, catchRate: 1, falseAlarmRate: 0, falseAlarmN: 1 });
  assert.deepEqual(r, { g1: gateOut(live, { records: 1, unadjudicated: 0, dangling: 0 }) });
});

test('a reference after the earliest journal entry is dangling while one just before it is retrospective', () => {
  const index = { g1: new Set(['2026-05-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z']) };
  const r = computeMetrics([
    adj({ recordAt: '2026-04-01T00:00:00.000Z', truth: 'false-alarm' }),
    adj({ recordAt: '2026-02-28T23:59:59.999Z', truth: 'true-clean' }),
  ], {}, { recordAtIndex: index });
  const retro = cohort({ adjudicated: 1, 'true-clean': 1, catchObservable: true, falseCleanRate: 0, falseCleanN: 1 });
  const combined = cohort({
    adjudicated: 2, 'false-alarm': 1, 'true-clean': 1, catchObservable: true,
    falseCleanRate: 0, falseCleanN: 1, falseAlarmRate: 1, falseAlarmN: 1,
  });
  assert.deepEqual(r, { g1: gateOut(retro, { live: cohort(), retrospective: retro, combined, dangling: 1 }) });
});

test('an empty journal index makes every unresolved reference retrospective', () => {
  const r = computeMetrics([adj({ recordAt: '2026-06-01T00:00:00.000Z', truth: 'false-clean' })], { g1: 0 }, { recordAtIndex: { g1: new Set() } });
  const retro = cohort({ adjudicated: 1, 'false-clean': 1, catchRate: 0, catchObservable: true, falseCleanRate: 1, falseCleanN: 1 });
  assert.deepEqual(r, { g1: gateOut(retro, { records: 0, unadjudicated: 0, live: cohort(), retrospective: retro, dangling: 0 }) });
});

test('without an index nothing is checked and a later judgement by the same rater replaces the earlier one', () => {
  const r = computeMetrics([
    adj({ recordAt: T1, truth: 'true-alarm', adjudicatedBy: 'alice' }),
    adj({ recordAt: T1, truth: 'false-alarm', adjudicatedBy: 'alice' }),
    adj({ recordAt: '2026-05-02T00:00:00.000Z', truth: 'true-alarm', adjudicatedBy: 'bob' }),
  ], { g1: 1 });
  const live = cohort({ adjudicated: 2, 'true-alarm': 1, 'false-alarm': 1, catchRate: 1, falseAlarmRate: 0.5, falseAlarmN: 2 });
  assert.deepEqual(r, { g1: gateOut(live, { records: 1, unadjudicated: 0 }) });
});

test('attribution on the epoch instant is scored and one millisecond earlier is tallied as pre-epoch', () => {
  const epoch = '2026-08-11T15:45:02.000Z';
  const r = computeMetrics([
    adj({ recordAt: epoch, truth: 'true-alarm', attributionCorrect: true }),
    adj({ recordAt: '2026-08-11T15:45:01.999Z', truth: 'true-alarm', attributionCorrect: false }),
    adj({ recordAt: '2026-08-12T00:00:00.000Z', attributionCorrect: false }),
  ], {}, { attributionEpochs: { g1: epoch } });
  const live = cohort({
    adjudicated: 2, 'true-alarm': 2, attributionScored: 2, attributionCorrect: 1, attributionPreEpoch: 1,
    attributionOnly: 1, catchRate: 1, falseAlarmRate: 0, falseAlarmN: 2, attributionAccuracy: 0.5,
  });
  assert.deepEqual(r, { g1: gateOut(live, { attributionEpoch: epoch }) });
});

test('with no epoch for the gate an attribution-only judgement is scored without touching adjudicated', () => {
  const r = computeMetrics([adj({ recordAt: '2020-01-01T00:00:00.000Z', attributionCorrect: true })], {}, { attributionEpochs: null });
  const live = cohort({ attributionOnly: 1, attributionScored: 1, attributionCorrect: 1, attributionAccuracy: 1 });
  assert.deepEqual(r, { g1: gateOut(live) });
});

test('model-default, canary, ambiguous and retracted judgements stay out of the headline', () => {
  const r = computeMetrics([
    null,
    { kind: 'note', gate: 'g1' },
    adj({ recordAt: T1, truth: 'false-alarm', sampling: 'model-default' }),
    adj({ recordAt: T1, truth: 'true-alarm', canary: 'c1' }),
    adj({ recordAt: '2026-05-02T00:00:00.000Z', truth: 'true-clean' }),
    adj({ recordAt: '2026-05-03T00:00:00.000Z', truth: 'false-clean' }),
    { kind: 'adjudication-retraction', gate: 'g1', recordAt: '2026-05-03T00:00:00.000Z', reason: 'wrong record' },
    adj({ recordAt: T1, truth: 'true-clean' }),
  ], { g1: 4 }, { recordAtIndex: { g1: new Set([T1]) }, ambiguousRecordAts: new Set(['g1@2026-05-02T00:00:00.000Z']) });
  const live = cohort({ adjudicated: 1, 'true-clean': 1, catchObservable: true, falseCleanRate: 0, falseCleanN: 1 });
  const canary = cohort({ adjudicated: 1, 'true-alarm': 1, catchRate: 1, falseAlarmRate: 0, falseAlarmN: 1 });
  const modelDefault = cohort({ adjudicated: 1, 'false-alarm': 1, falseAlarmRate: 1, falseAlarmN: 1 });
  const combined = cohort({
    adjudicated: 2, 'true-alarm': 1, 'true-clean': 1, catchRate: 1, catchObservable: true,
    falseCleanRate: 0, falseCleanN: 1, falseAlarmRate: 0, falseAlarmN: 1,
  });
  assert.deepEqual(r, { g1: gateOut(live, { records: 4, unadjudicated: 3, canary, modelDefault, combined, dangling: 0, ambiguous: 1 }) });
});

test('the default epochs mark gate-ratchet attribution before its epoch as pre-epoch', () => {
  const r = computeMetrics([adj({ gate: 'gate-ratchet', recordAt: '2026-08-01T00:00:00.000Z', truth: 'true-alarm', attributionCorrect: true })]);
  const live = cohort({ adjudicated: 1, 'true-alarm': 1, attributionPreEpoch: 1, catchRate: 1, falseAlarmRate: 0, falseAlarmN: 1 });
  assert.deepEqual(r, { 'gate-ratchet': gateOut(live, { attributionEpoch: '2026-08-11T15:45:02.000Z' }) });
});

test('records that judge nothing produce no gate entry', () => {
  assert.deepEqual(computeMetrics([null, { kind: 'note', gate: 'g1' }, adj({ recordAt: T1, truth: 'maybe' })]), {});
});
