// node --test monitor/test/ — I10: the provenance a published rate must carry.
//
// The module's own first version certified 135 closures as `live` because their evidence field was
// non-empty. Every one of those fields was `[object Object]`. Several tests below exist only because
// of that: a corrupt field is not evidence, and a non-empty check cannot tell the difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicationTiming, adjudicationProvenance, isDegenerateEvidence, statementFor } from '../adjudication-provenance.mjs';

const close = (issueId, at, data = {}) => ({ type: 'issue-closed', issueId, at, data });
const store = (events, issues) => ({ events, issues });

// ---- the corruption that defeated the first version ------------------------------------------------

test('`[object Object]` is degenerate evidence, however non-empty it looks', () => {
  assert.equal(isDegenerateEvidence('[object Object]'), true);
  assert.equal(isDegenerateEvidence('[object Object],[object Object]'), true);
  assert.equal(isDegenerateEvidence(''), true);
  assert.equal(isDegenerateEvidence(null), true);
  assert.equal(isDegenerateEvidence('closed: upstream fixed in 7e57a1d'), false);
});

test('a closure with CORRUPT evidence is undetermined, and says the record is gone', () => {
  const t = adjudicationTiming(close('i1', 'T1'), { evidence: '[object Object]' }, 1);
  assert.equal(t.timing, 'undetermined');
  assert.equal(t.corruptEvidence, true);
  assert.match(t.why, /corrupt/);
  // NOT counted as a defect either — the judgement may have been sound.
  assert.match(t.why, /may have been sound/);
});

test('corrupt evidence is NOT reported as a live judgement', () => {
  // The regression that produced the module's own wrong first answer.
  const p = adjudicationProvenance(store(
    [close('i1', 'T1', { closedAs: 'refuted' }), close('i2', 'T2', { closedAs: 'refuted' })],
    { i1: { evidence: '[object Object]' }, i2: { evidence: '[object Object]' } },
  ));
  assert.equal(p.summary.byTiming.live, 0);
  assert.equal(p.summary.corruptEvidence, 2);
});

// ---- both poles need positive evidence -----------------------------------------------------------

test('an auto-gate close is RETRO — an inference about the past', () => {
  const t = adjudicationTiming(close('i1', 'T1', { auto: true }), { evidence: 'ledger' }, 1);
  assert.equal(t.timing, 'retro');
});

test('a commit-derived classification is RETRO', () => {
  const t = adjudicationTiming(close('i1', 'T1'), { evidence: 'real', defectBasis: 'commit' }, 1);
  assert.equal(t.timing, 'retro');
});

test('a batched close is UNDETERMINED, never retro — batching is not proof of a shared judgement', () => {
  const t = adjudicationTiming(close('i1', 'T1'), { evidence: 'real evidence here' }, 16);
  assert.equal(t.timing, 'undetermined');
  assert.match(t.why, /batch of 16/);
});

test('an individually timed, evidenced human close is LIVE', () => {
  const t = adjudicationTiming(close('i1', 'T1', { closedAs: 'refuted' }), { evidence: 'checked by hand: rule fires on a comment' }, 1);
  assert.equal(t.timing, 'live');
});

// ---- rows are not judgements ---------------------------------------------------------------------

test('closures sharing instant, verdict and evidence collapse to ONE act', () => {
  const p = adjudicationProvenance(store(
    ['a', 'b', 'c'].map((i) => close(i, 'T1', { closedAs: 'fixed' })),
    { a: { evidence: 'E' }, b: { evidence: 'E' }, c: { evidence: 'E' } },
  ));
  assert.equal(p.summary.closureRows, 3);
  assert.equal(p.summary.adjudicationActs, 1);
  assert.equal(p.summary.rowsPerAct, 3);
  assert.match(p.summary.statement, /over-state the judgements by 3.00x/);
});

test('BOTH bounds are published — one reading over several sittings is not one act', () => {
  // Acts key on instant AND evidence, so the same reading at three instants is three acts; the
  // evidence-only collapse is one. Neither is the truth, and picking one would resolve an
  // uncertainty the record does not.
  const p = adjudicationProvenance(store(
    [close('a', 'T1'), close('b', 'T2'), close('c', 'T3')],
    { a: { evidence: 'E' }, b: { evidence: 'E' }, c: { evidence: 'E' } },
  ));
  assert.equal(p.summary.adjudicationActs, 3);
  assert.equal(p.summary.distinctEvidenceStrings, 1);
  assert.match(p.summary.statement, /lies between 1 and 3/);
});

// ---- unknown is unknown ----------------------------------------------------------------------------

test('NO defectBasis anywhere reads UNKNOWN, never 0% derived', () => {
  const p = adjudicationProvenance(store([close('a', 'T1')], { a: { evidence: 'E' } }));
  assert.equal(p.summary.defectBasisRecorded, 0);
  assert.match(p.summary.statement, /Derived-vs-judged split: UNKNOWN/);
  assert.doesNotMatch(p.summary.statement, /0%/);
});

test('the statement names the internal adjudicator rather than implying independence', () => {
  const p = adjudicationProvenance(store([close('a', 'T1')], { a: { evidence: 'E' } }));
  assert.match(p.summary.statement, /internal/);
  assert.match(p.summary.statement, /does not remove the conflict/);
});

test('the statement is GENERATED from the counts, so it cannot drift from them', () => {
  const s = statementFor({ rowCount: 9, actCount: 3, readingCount: 2, byTiming: { live: 1, retro: 2, undetermined: 6 }, largest: null, withBasis: 0 });
  assert.match(s, /9 closures across 3 distinct adjudication acts/);
  assert.match(s, /1 judged live, 2 reconstructed after the fact, 6 undetermined/);
});

// ---- non-vacuity -------------------------------------------------------------------------------------

test('NOT VACUOUS: live, retro and undetermined are all reachable from one store', () => {
  const p = adjudicationProvenance(store(
    [close('a', 'T1'), close('b', 'T2', { auto: true }), close('c', 'T3'), close('d', 'T3')],
    { a: { evidence: 'hand-checked' }, b: { evidence: 'ledger' }, c: { evidence: 'X' }, d: { evidence: 'Y' } },
  ));
  assert.deepEqual(p.summary.byTiming, { live: 1, retro: 1, undetermined: 2 });
});

test('an empty store produces no acts and no fabricated statement', () => {
  const p = adjudicationProvenance(store([], {}));
  assert.equal(p.summary.closureRows, 0);
  assert.equal(p.summary.adjudicationActs, 0);
  assert.equal(p.summary.rowsPerAct, null);
});
