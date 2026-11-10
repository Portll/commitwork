// Computes the adjudication timing (live, retro, or undetermined) for a closed finding (monitor/adjudication-provenance.mjs adjudicationTiming).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicationTiming } from '../adjudication-provenance.mjs';

test('returns retro when close data auto is true', () => {
  const r = adjudicationTiming({ data: { auto: true } }, {}, 1);
  assert.deepEqual(r, { timing: "retro", why: "closed by the auto-close gate from a later ledger state \u2014 an inference about the past, not a judgement made at the time" });
});

test('returns retro when defect basis is commit', () => {
  const r = adjudicationTiming({ data: {} }, { defectBasis: 'commit' }, 1);
  assert.deepEqual(r, { timing: "retro", why: "classified by derivation from a commit after the fact" });
});

test('returns undetermined when batch size is two', () => {
  const r = adjudicationTiming({ data: {} }, {}, 2);
  assert.deepEqual(r, { timing: "undetermined", why: "closed in a batch of 2 at one instant \u2014 whether each finding was judged individually is not in the record" });
});

test('returns undetermined when batch size is one', () => {
  const r = adjudicationTiming({ data: {} }, {}, 1);
  assert.deepEqual(r, { timing: "undetermined", why: "individually timed, but carries no evidence \u2014 nothing establishes when or on what basis it was judged" });
});

test('returns undetermined with corrupt evidence flag when evidence is object string', () => {
  const r = adjudicationTiming({ data: {} }, { evidence: '[object Object]' }, 1);
  assert.deepEqual(r, { timing: "undetermined", why: "evidence field is corrupt (`[object Object]`) \u2014 an object reached String(); the judgement may have been sound and the record of it is gone", corruptEvidence: true });
});

test('returns undetermined when evidence is null', () => {
  const r = adjudicationTiming({ data: {} }, { evidence: null }, 1);
  assert.deepEqual(r, { timing: "undetermined", why: "individually timed, but carries no evidence \u2014 nothing establishes when or on what basis it was judged" });
});

test('returns live when evidence is present and non-degenerate', () => {
  const r = adjudicationTiming({ data: {} }, { evidence: 'some evidence' }, 1);
  assert.deepEqual(r, { timing: "live", why: "individually timed, human-closed, carrying its own evidence" });
});

test('returns live when close is null and evidence is present', () => {
  const r = adjudicationTiming(null, { evidence: 'some evidence' }, 1);
  assert.deepEqual(r, { timing: "live", why: "individually timed, human-closed, carrying its own evidence" });
});

test('returns undetermined when batch size is three', () => {
  const r = adjudicationTiming({ data: {} }, {}, 3);
  assert.deepEqual(r, { timing: "undetermined", why: "closed in a batch of 3 at one instant \u2014 whether each finding was judged individually is not in the record" });
});

test('returns retro when auto is false and defect basis is commit', () => {
  const r = adjudicationTiming({ data: { auto: false } }, { defectBasis: 'commit' }, 1);
  assert.deepEqual(r, { timing: "retro", why: "classified by derivation from a commit after the fact" });
});
