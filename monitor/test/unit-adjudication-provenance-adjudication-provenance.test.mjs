// Computes per-closure adjudication timing, act grouping, and provenance summary (monitor/adjudication-provenance.mjs adjudicationProvenance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicationProvenance } from '../adjudication-provenance.mjs';

test('returns empty summary for null document', () => {
  const r = adjudicationProvenance(null);
  assert.deepEqual(r, { rows: [], summary: { closureRows: 0, adjudicationActs: 0, rowsPerAct: null, distinctEvidenceStrings: 0, byTiming: { live: 0, retro: 0, undetermined: 0 }, corruptEvidence: 0, largestAct: null, defectBasisRecorded: 0, statement: "0 closures across 0 distinct adjudication acts. Those closures cite 0 distinct evidence strings, so the number of independent judgements lies between 0 and 0 \u2014 the record does not resolve which. Timing: 0 judged live, 0 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('returns empty summary for document with no events', () => {
  const r = adjudicationProvenance({ events: [], issues: {} });
  assert.deepEqual(r, { rows: [], summary: { closureRows: 0, adjudicationActs: 0, rowsPerAct: null, distinctEvidenceStrings: 0, byTiming: { live: 0, retro: 0, undetermined: 0 }, corruptEvidence: 0, largestAct: null, defectBasisRecorded: 0, statement: "0 closures across 0 distinct adjudication acts. Those closures cite 0 distinct evidence strings, so the number of independent judgements lies between 0 and 0 \u2014 the record does not resolve which. Timing: 0 judged live, 0 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('classifies a single live closure with evidence as one act', () => {
  const doc = {
    events: [{ type: 'issue-closed', issueId: 'i1', at: 't1', data: { closedAs: 'pass' } }],
    issues: { i1: { evidence: 'log line' } },
  };
  const r = adjudicationProvenance(doc);
  assert.deepEqual(r, { rows: [{ issueId: "i1", at: "t1", closedAs: "pass", timing: "live", why: "individually timed, human-closed, carrying its own evidence" }], summary: { closureRows: 1, adjudicationActs: 1, rowsPerAct: 1, distinctEvidenceStrings: 1, byTiming: { live: 1, retro: 0, undetermined: 0 }, corruptEvidence: 0, largestAct: { at: "t1", closedAs: "pass", size: 1 }, defectBasisRecorded: 0, statement: "1 closure across 1 distinct adjudication act. Those closures cite 1 distinct evidence string, so the number of independent judgements lies between 1 and 1 \u2014 the record does not resolve which. Timing: 1 judged live, 0 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('classifies a retro closure via auto flag', () => {
  const doc = {
    events: [{ type: 'issue-closed', issueId: 'i1', at: 't1', data: { closedAs: 'defect', auto: true } }],
    issues: { i1: { evidence: 'log line' } },
  };
  const r = adjudicationProvenance(doc);
  assert.deepEqual(r, { rows: [{ issueId: "i1", at: "t1", closedAs: "defect", timing: "retro", why: "closed by the auto-close gate from a later ledger state \u2014 an inference about the past, not a judgement made at the time" }], summary: { closureRows: 1, adjudicationActs: 1, rowsPerAct: 1, distinctEvidenceStrings: 1, byTiming: { live: 0, retro: 1, undetermined: 0 }, corruptEvidence: 0, largestAct: { at: "t1", closedAs: "defect", size: 1 }, defectBasisRecorded: 0, statement: "1 closure across 1 distinct adjudication act. Those closures cite 1 distinct evidence string, so the number of independent judgements lies between 1 and 1 \u2014 the record does not resolve which. Timing: 0 judged live, 1 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('classifies a retro closure via defectBasis commit', () => {
  const doc = {
    events: [{ type: 'issue-closed', issueId: 'i1', at: 't1', data: { closedAs: 'defect' } }],
    issues: { i1: { evidence: 'log line', defectBasis: 'commit' } },
  };
  const r = adjudicationProvenance(doc);
  assert.deepEqual(r, { rows: [{ issueId: "i1", at: "t1", closedAs: "defect", timing: "retro", why: "classified by derivation from a commit after the fact" }], summary: { closureRows: 1, adjudicationActs: 1, rowsPerAct: 1, distinctEvidenceStrings: 1, byTiming: { live: 0, retro: 1, undetermined: 0 }, corruptEvidence: 0, largestAct: { at: "t1", closedAs: "defect", size: 1 }, defectBasisRecorded: 1, statement: "1 closure across 1 distinct adjudication act. Those closures cite 1 distinct evidence string, so the number of independent judgements lies between 1 and 1 \u2014 the record does not resolve which. Timing: 0 judged live, 1 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. 1 closure carry a recorded defect basis. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('classifies a batch closure as undetermined', () => {
  const doc = {
    events: [
      { type: 'issue-closed', issueId: 'i1', at: 't1', data: { closedAs: 'pass' } },
      { type: 'issue-closed', issueId: 'i2', at: 't1', data: { closedAs: 'pass' } },
    ],
    issues: { i1: { evidence: 'a' }, i2: { evidence: 'b' } },
  };
  const r = adjudicationProvenance(doc);
  assert.deepEqual(r, { rows: [{ issueId: "i1", at: "t1", closedAs: "pass", timing: "undetermined", why: "closed in a batch of 2 at one instant \u2014 whether each finding was judged individually is not in the record" }, { issueId: "i2", at: "t1", closedAs: "pass", timing: "undetermined", why: "closed in a batch of 2 at one instant \u2014 whether each finding was judged individually is not in the record" }], summary: { closureRows: 2, adjudicationActs: 2, rowsPerAct: 1, distinctEvidenceStrings: 2, byTiming: { live: 0, retro: 0, undetermined: 2 }, corruptEvidence: 0, largestAct: { at: "t1", closedAs: "pass", size: 1 }, defectBasisRecorded: 0, statement: "2 closures across 2 distinct adjudication acts. Those closures cite 2 distinct evidence strings, so the number of independent judgements lies between 2 and 2 \u2014 the record does not resolve which. Timing: 0 judged live, 0 reconstructed after the fact, 2 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('classifies a closure with corrupt evidence as undetermined with corruptEvidence flag', () => {
  const doc = {
    events: [{ type: 'issue-closed', issueId: 'i1', at: 't1', data: { closedAs: 'pass' } }],
    issues: { i1: { evidence: '[object Object]' } },
  };
  const r = adjudicationProvenance(doc);
  assert.deepEqual(r, { rows: [{ issueId: "i1", at: "t1", closedAs: "pass", timing: "undetermined", why: "evidence field is corrupt (`[object Object]`) \u2014 an object reached String(); the judgement may have been sound and the record of it is gone", corruptEvidence: true }], summary: { closureRows: 1, adjudicationActs: 1, rowsPerAct: 1, distinctEvidenceStrings: 1, byTiming: { live: 0, retro: 0, undetermined: 1 }, corruptEvidence: 1, largestAct: { at: "t1", closedAs: "pass", size: 1 }, defectBasisRecorded: 0, statement: "1 closure across 1 distinct adjudication act. Those closures cite 1 distinct evidence string, so the number of independent judgements lies between 1 and 1 \u2014 the record does not resolve which. 1 closure carry a CORRUPT evidence field (an object reached String() and became `[object Object]`). The judgements behind them may have been sound; the record of them is gone, and they are counted as undetermined rather than as either a pass or a defect. Timing: 0 judged live, 0 reconstructed after the fact, 1 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('classifies a closure with no evidence as undetermined', () => {
  const doc = {
    events: [{ type: 'issue-closed', issueId: 'i1', at: 't1', data: { closedAs: 'pass' } }],
    issues: { i1: {} },
  };
  const r = adjudicationProvenance(doc);
  assert.deepEqual(r, { rows: [{ issueId: "i1", at: "t1", closedAs: "pass", timing: "undetermined", why: "individually timed, but carries no evidence \u2014 nothing establishes when or on what basis it was judged" }], summary: { closureRows: 1, adjudicationActs: 1, rowsPerAct: 1, distinctEvidenceStrings: 0, byTiming: { live: 0, retro: 0, undetermined: 1 }, corruptEvidence: 0, largestAct: { at: "t1", closedAs: "pass", size: 1 }, defectBasisRecorded: 0, statement: "1 closure across 1 distinct adjudication act. Those closures cite 0 distinct evidence strings, so the number of independent judgements lies between 0 and 1 \u2014 the record does not resolve which. Timing: 0 judged live, 0 reconstructed after the fact, 1 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('groups two closures at same instant with same evidence into one act', () => {
  const doc = {
    events: [
      { type: 'issue-closed', issueId: 'i1', at: 't1', data: { closedAs: 'pass' } },
      { type: 'issue-closed', issueId: 'i2', at: 't1', data: { closedAs: 'pass' } },
    ],
    issues: { i1: { evidence: 'same' }, i2: { evidence: 'same' } },
  };
  const r = adjudicationProvenance(doc);
  assert.deepEqual(r, { rows: [{ issueId: "i1", at: "t1", closedAs: "pass", timing: "undetermined", why: "closed in a batch of 2 at one instant \u2014 whether each finding was judged individually is not in the record" }, { issueId: "i2", at: "t1", closedAs: "pass", timing: "undetermined", why: "closed in a batch of 2 at one instant \u2014 whether each finding was judged individually is not in the record" }], summary: { closureRows: 2, adjudicationActs: 1, rowsPerAct: 2, distinctEvidenceStrings: 1, byTiming: { live: 0, retro: 0, undetermined: 2 }, corruptEvidence: 0, largestAct: { at: "t1", closedAs: "pass", size: 2 }, defectBasisRecorded: 0, statement: "2 closures across 1 distinct adjudication act \u2014 publishing the closure count would over-state the judgements by 2.00x, because records sharing one instant, verdict and evidence string are one reading. Those closures cite 1 distinct evidence string, so the number of independent judgements lies between 1 and 1 \u2014 the record does not resolve which. Timing: 0 judged live, 0 reconstructed after the fact, 2 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Largest single act closed 2 findings at t1. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});

test('keeps two closures at same instant with different evidence as two acts', () => {
  const doc = {
    events: [
      { type: 'issue-closed', issueId: 'i1', at: 't1', data: { closedAs: 'pass' } },
      { type: 'issue-closed', issueId: 'i2', at: 't1', data: { closedAs: 'pass' } },
    ],
    issues: { i1: { evidence: 'a' }, i2: { evidence: 'b' } },
  };
  const r = adjudicationProvenance(doc);
  assert.deepEqual(r, { rows: [{ issueId: "i1", at: "t1", closedAs: "pass", timing: "undetermined", why: "closed in a batch of 2 at one instant \u2014 whether each finding was judged individually is not in the record" }, { issueId: "i2", at: "t1", closedAs: "pass", timing: "undetermined", why: "closed in a batch of 2 at one instant \u2014 whether each finding was judged individually is not in the record" }], summary: { closureRows: 2, adjudicationActs: 2, rowsPerAct: 1, distinctEvidenceStrings: 2, byTiming: { live: 0, retro: 0, undetermined: 2 }, corruptEvidence: 0, largestAct: { at: "t1", closedAs: "pass", size: 1 }, defectBasisRecorded: 0, statement: "2 closures across 2 distinct adjudication acts. Those closures cite 2 distinct evidence strings, so the number of independent judgements lies between 2 and 2 \u2014 the record does not resolve which. Timing: 0 judged live, 0 reconstructed after the fact, 2 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it." } });
});
