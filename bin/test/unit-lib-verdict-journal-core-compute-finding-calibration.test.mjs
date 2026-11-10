// Per-check per-model false rates over finding-adjudication records, split into standing and delta cohorts (bin/lib/verdict-journal-core.mjs computeFindingCalibration).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFindingCalibration } from '../lib/verdict-journal-core.mjs';

test('returns empty checks object when records is null', () => {
  const r = computeFindingCalibration(null);
  assert.deepEqual(r.checks, {});
});

test('returns empty checks object when records is empty array', () => {
  const r = computeFindingCalibration([]);
  assert.deepEqual(r.checks, {});
});

test('skips records with wrong kind or missing category', () => {
  const records = [
    { kind: 'adjudication', category: 'c1', model: 'm1', bornSlice: 'x-20240101000000', truth: 'true-alarm' },
    { kind: 'finding-adjudication', model: 'm1', bornSlice: 'x-20240101000000', truth: 'true-alarm' },
    { kind: 'finding-adjudication', category: 'c1', model: 'm1', bornSlice: 'x-20240101000000', truth: 'true-alarm' },
  ];
  const r = computeFindingCalibration(records);
  assert.deepEqual(r.checks, { c1: { m1: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0, cohortUnknown: 0, cohorts: { standing: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } } } });
});

test('maps null and empty-string model to human label', () => {
  const records = [
    { kind: 'finding-adjudication', category: 'c1', model: null, bornSlice: 'x-20240101000000', truth: 'true-alarm' },
    { kind: 'finding-adjudication', category: 'c1', model: '', bornSlice: 'x-20240101000000', truth: 'false-alarm' },
    { kind: 'finding-adjudication', category: 'c1', model: 'gpt4', bornSlice: 'x-20240101000000', truth: 'true-clean' },
  ];
  const r = computeFindingCalibration(records);
  assert.deepEqual(r.checks, { c1: { human: { denominator: 2, adjudicated: 2, unadjudicated: 0, falseAlarmRate: 0.5, falseCleanRate: 0, cohortUnknown: 0, cohorts: { standing: { denominator: 2, adjudicated: 2, unadjudicated: 0, falseAlarmRate: 0.5, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } }, gpt4: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0, cohortUnknown: 0, cohorts: { standing: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } } } });
});

test('counts unparseable bornSlice as cohortUnknown in standing', () => {
  const records = [
    { kind: 'finding-adjudication', category: 'c1', model: 'm1', bornSlice: 'bad-stamp', truth: 'true-alarm' },
    { kind: 'finding-adjudication', category: 'c1', model: 'm1', bornSlice: null, truth: 'false-alarm' },
  ];
  const r = computeFindingCalibration(records);
  assert.deepEqual(r.checks, { c1: { m1: { denominator: 2, adjudicated: 2, unadjudicated: 0, falseAlarmRate: 0.5, falseCleanRate: 0, cohortUnknown: 2, cohorts: { standing: { denominator: 2, adjudicated: 2, unadjudicated: 0, falseAlarmRate: 0.5, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } } } });
});

test('classifies record as delta when bornSlice equals windowStart', () => {
  const records = [
    { kind: 'finding-adjudication', category: 'c1', model: 'm1', bornSlice: 'x-20240101000000', truth: 'true-alarm' },
  ];
  const r = computeFindingCalibration(records, { windowStart: '2024-01-01T00:00:00.000Z' });
  assert.deepEqual(r.checks, { c1: { m1: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0, cohortUnknown: 0, cohorts: { standing: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null }, delta: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0 } } } } });
});

test('classifies record as standing when bornSlice is before windowStart', () => {
  const records = [
    { kind: 'finding-adjudication', category: 'c1', model: 'm1', bornSlice: 'x-20231231235959', truth: 'true-alarm' },
  ];
  const r = computeFindingCalibration(records, { windowStart: '2024-01-01T00:00:00.000Z' });
  assert.deepEqual(r.checks, { c1: { m1: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0, cohortUnknown: 0, cohorts: { standing: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } } } });
});

test('classifies record as standing when windowStart is null', () => {
  const records = [
    { kind: 'finding-adjudication', category: 'c1', model: 'm1', bornSlice: 'x-20240101000000', truth: 'true-alarm' },
  ];
  const r = computeFindingCalibration(records, { windowStart: null });
  assert.deepEqual(r.checks, { c1: { m1: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0, cohortUnknown: 0, cohorts: { standing: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } } } });
});

test('aggregates multiple records across checks and models with mixed truths', () => {
  const records = Array.from({ length: 4 }, (_, i) => ({
    kind: 'finding-adjudication',
    category: i < 2 ? 'lint' : 'typecheck',
    model: i % 2 === 0 ? 'm1' : 'm2',
    bornSlice: `x-202401010000${i}`,
    truth: ['true-alarm', 'false-alarm', 'true-clean', 'false-clean'][i],
  }));
  const r = computeFindingCalibration(records, { windowStart: '2024-01-01T00:00:00.000Z' });
  assert.deepEqual(r.checks, { lint: { m1: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0, cohortUnknown: 1, cohorts: { standing: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } }, m2: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 1, falseCleanRate: 0, cohortUnknown: 1, cohorts: { standing: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 1, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } } }, typecheck: { m1: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0, cohortUnknown: 1, cohorts: { standing: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } }, m2: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 1, cohortUnknown: 1, cohorts: { standing: { denominator: 1, adjudicated: 1, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 1 }, delta: { denominator: 0, adjudicated: 0, unadjudicated: 0, falseAlarmRate: null, falseCleanRate: null } } } } });
});
