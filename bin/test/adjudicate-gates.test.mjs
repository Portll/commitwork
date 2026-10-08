// The adjudicator's judgement contract (overwatch-layer cw-adjudication-integrity-20260813 task 14):
// every judgement carries a structured `measurement` — the numbers the re-measurement produced,
// nothing it concluded — so what crosses to a rater is gated structurally, not by clean prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, adjudicationRecordFor, STRATA } from '../adjudicate-gates.mjs';

const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12';

// a steady reading refuted at the commit — the shape that leaked worst
test('a refuted steady reading carries the measurement, not only the narration', () => {
  const rec = {
    gate: 'gate-tests', verdict: 'steady', at: 't1', headSha: SHA,
    baseline: { fail: 1, pass: 1200 }, names: [],
  };
  const measured = { ok: true, fail: 3, pass: 1288, names: ['taxonomy render escapes'] };
  const v = judge(rec, measured, STRATA.ATTRIBUTION_ONLY, { corroborating: ['taxonomy render escapes'] });
  assert.equal(v.truth, 'false-clean');
  assert.deepEqual(v.measurement, {
    sha: SHA, floor: 1, fail: 3, pass: 1288,
    corroboratedTests: ['taxonomy render escapes'],
  }, 'the numbers must survive as FIELDS — prose is for humans, fields are for raters');
});

test('a verified committed alarm carries the measurement in both directions', () => {
  const rec = {
    gate: 'gate-tests', verdict: 'regression-committed', at: 't1', headSha: SHA,
    baseline: { fail: 0, pass: 100 }, committed: ['registry coverage'],
  };
  const alarm = judge(rec, { ok: true, fail: 2, pass: 99, names: ['registry coverage'] }, STRATA.VERIFIABLE);
  assert.equal(alarm.truth, 'true-alarm');
  assert.deepEqual(alarm.measurement, { sha: SHA, floor: 0, fail: 2, pass: 99, corroboratedTests: ['registry coverage'] });

  // the clean direction: a false alarm, said with an empty corroboration list rather than prose
  const clean = judge({ ...rec, committed: [] }, { ok: true, fail: 0, pass: 100, names: [] }, STRATA.VERIFIABLE);
  assert.equal(clean.truth, 'false-alarm');
  assert.deepEqual(clean.measurement, { sha: SHA, floor: 0, fail: 0, pass: 100, corroboratedTests: [] });
});

test('an attribution judgement carries the measurement including the recorded headFail', () => {
  const rec = {
    gate: 'gate-tests', verdict: 'regression-uncommitted', at: 't1', headSha: SHA,
    headFail: 0, baseline: { fail: 0, pass: 50 },
  };
  const v = judge(rec, { ok: true, fail: 0, pass: 50, names: [] }, STRATA.ATTRIBUTION_ONLY);
  assert.equal(v.attributionCorrect, true);
  assert.deepEqual(v.measurement, { sha: SHA, floor: 0, fail: 0, pass: 50, headFail: 0, corroboratedTests: [] });
});

test('a docs-doctor judgement carries the re-derived verdict as a field', () => {
  const rec = { gate: 'docs-doctor', verdict: 'green', at: 't1', headSha: SHA };
  const v = judge(rec, { ok: true, docs: { ok: true, verdict: 'green' } }, STRATA.VERIFIABLE);
  assert.equal(v.truth, 'true-clean');
  assert.deepEqual(v.measurement, { sha: SHA, docsVerdict: 'green' },
    'what the tree re-derived is a measurement; "the gate read the tree correctly" is a conclusion');
});

// The writer, not just the judgement: a measurement that judge() emits and the ledger drops would
// leave the rater exactly where it started. adjudicationRecordFor is the shape main() appends.
test('the ledger record carries the measurement the judgement produced', () => {
  const rec = {
    gate: 'gate-tests', verdict: 'steady', at: 't1', headSha: SHA, pid: 7, session: 's1',
    baseline: { fail: 1, pass: 1200 }, names: [],
  };
  const v = judge(rec, { ok: true, fail: 3, pass: 1288, names: ['x'] }, STRATA.ATTRIBUTION_ONLY, { corroborating: ['x'] });
  const out = adjudicationRecordFor(rec, v, SHA);
  assert.equal(out.kind, 'adjudication');
  assert.equal(out.truth, 'false-clean');
  assert.deepEqual(out.measurement, v.measurement, 'written as a field, never only inside the basis prose');
  assert.equal(out.recordPid, 7);
  assert.equal(out.recordSession, 's1');
  assert.ok(out.evidence, 'the prose survives for humans; it is simply no longer the preferred channel');
});
