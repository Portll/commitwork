// Classifies closure evidence into owner proposals with derived, residue, and defect counts (monitor/defect-classify.mjs proposeClassifications).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeClassifications } from '../defect-classify.mjs';

test('returns empty proposals and zero counts for no closures', () => {
  const r = proposeClassifications([]);
  assert.deepEqual(r, { proposals: [], groups: [], report: { records: 0, judgements: 0, headline: "0 closures arise from 0 distinct adjudications", largestGroup: null, derivedRecords: 0, residueRecords: 0, evidenceDefectRecords: 0, derivedFraction: 0 } });
});

test('marks unusable evidence as defect with undetermined owner', () => {
  const r = proposeClassifications([{ issueId: 'i1', evidence: '   ' }]);
  assert.deepEqual(r, { proposals: [{ issueId: "i1", owner: "undetermined", basis: null, derived: false, evidence: "evidence is unrecoverable \u2014 the closure recorded no readable reason, so nothing can be derived and nothing should be judged from it [group of 1; source evidence: ]" }], groups: [{ evidence: "", issueIds: ["i1"], unusable: true, sha: null }], report: { records: 1, judgements: 1, headline: "1 closures arise from 1 distinct adjudication", largestGroup: { size: 1, evidence: "" }, derivedRecords: 0, residueRecords: 0, evidenceDefectRecords: 1, derivedFraction: 0 } });
});

test('derives instrument owner when sha resolves', () => {
  const r = proposeClassifications(
    [{ issueId: 'i1', evidence: 'fixed in abc1234' }],
    { shaResolves: () => true }
  );
  assert.deepEqual(r, { proposals: [{ issueId: "i1", owner: "instrument", basis: "commit", derived: true, evidence: "commitwork shipped the fix at abc1234 \u2014 the classification is a lookup, not a judgement [group of 1; source evidence: fixed in abc1234]" }], groups: [{ evidence: "fixed in abc1234", issueIds: ["i1"], unusable: false, sha: "abc1234" }], report: { records: 1, judgements: 1, headline: "1 closures arise from 1 distinct adjudication", largestGroup: { size: 1, evidence: "fixed in abc1234" }, derivedRecords: 1, residueRecords: 0, evidenceDefectRecords: 0, derivedFraction: 1 } });
});

test('leaves undetermined when sha does not resolve', () => {
  const r = proposeClassifications(
    [{ issueId: 'i1', evidence: 'see abc1234' }],
    { shaResolves: () => false }
  );
  assert.deepEqual(r, { proposals: [{ issueId: "i1", owner: "undetermined", basis: null, derived: false, evidence: "evidence cites abc1234, which does not resolve in this repository \u2014 it may be an upstream commit, which is exactly what a human or a dual-model pass must decide [group of 1; source evidence: see abc1234]" }], groups: [{ evidence: "see abc1234", issueIds: ["i1"], unusable: false, sha: "abc1234" }], report: { records: 1, judgements: 1, headline: "1 closures arise from 1 distinct adjudication", largestGroup: { size: 1, evidence: "see abc1234" }, derivedRecords: 0, residueRecords: 1, evidenceDefectRecords: 0, derivedFraction: 0 } });
});

test('leaves undetermined when evidence has no sha', () => {
  const r = proposeClassifications(
    [{ issueId: 'i1', evidence: 'no reference here' }],
    { shaResolves: () => true }
  );
  assert.deepEqual(r, { proposals: [{ issueId: "i1", owner: "undetermined", basis: null, derived: false, evidence: "evidence carries no commit reference, so the owner is a judgement rather than a lookup [group of 1; source evidence: no reference here]" }], groups: [{ evidence: "no reference here", issueIds: ["i1"], unusable: false, sha: null }], report: { records: 1, judgements: 1, headline: "1 closures arise from 1 distinct adjudication", largestGroup: { size: 1, evidence: "no reference here" }, derivedRecords: 0, residueRecords: 1, evidenceDefectRecords: 0, derivedFraction: 0 } });
});

test('groups multiple closures by identical evidence', () => {
  const r = proposeClassifications(
    [
      { issueId: 'a', evidence: 'same text' },
      { issueId: 'b', evidence: 'same text' },
      { issueId: 'c', evidence: 'other text' },
    ],
    { shaResolves: () => false }
  );
  assert.deepEqual(r, { proposals: [{ issueId: "a", owner: "undetermined", basis: null, derived: false, evidence: "evidence carries no commit reference, so the owner is a judgement rather than a lookup [group of 2; source evidence: same text]" }, { issueId: "b", owner: "undetermined", basis: null, derived: false, evidence: "evidence carries no commit reference, so the owner is a judgement rather than a lookup [group of 2; source evidence: same text]" }, { issueId: "c", owner: "undetermined", basis: null, derived: false, evidence: "evidence carries no commit reference, so the owner is a judgement rather than a lookup [group of 1; source evidence: other text]" }], groups: [{ evidence: "same text", issueIds: ["a", "b"], unusable: false, sha: null }, { evidence: "other text", issueIds: ["c"], unusable: false, sha: null }], report: { records: 3, judgements: 2, headline: "3 closures arise from 2 distinct adjudications", largestGroup: { size: 2, evidence: "same text" }, derivedRecords: 0, residueRecords: 3, evidenceDefectRecords: 0, derivedFraction: 0 } });
});

test('computes derivedFraction with three decimal places', () => {
  const r = proposeClassifications(
    [
      { issueId: 'a', evidence: 'sha 1111111' },
      { issueId: 'b', evidence: 'sha 2222222' },
      { issueId: 'c', evidence: 'no sha' },
    ],
    { shaResolves: () => true }
  );
  assert.deepEqual(r, { proposals: [{ issueId: "a", owner: "instrument", basis: "commit", derived: true, evidence: "commitwork shipped the fix at 1111111 \u2014 the classification is a lookup, not a judgement [group of 1; source evidence: sha 1111111]" }, { issueId: "b", owner: "instrument", basis: "commit", derived: true, evidence: "commitwork shipped the fix at 2222222 \u2014 the classification is a lookup, not a judgement [group of 1; source evidence: sha 2222222]" }, { issueId: "c", owner: "undetermined", basis: null, derived: false, evidence: "evidence carries no commit reference, so the owner is a judgement rather than a lookup [group of 1; source evidence: no sha]" }], groups: [{ evidence: "sha 1111111", issueIds: ["a"], unusable: false, sha: "1111111" }, { evidence: "sha 2222222", issueIds: ["b"], unusable: false, sha: "2222222" }, { evidence: "no sha", issueIds: ["c"], unusable: false, sha: null }], report: { records: 3, judgements: 3, headline: "3 closures arise from 3 distinct adjudications", largestGroup: { size: 1, evidence: "sha 1111111" }, derivedRecords: 2, residueRecords: 1, evidenceDefectRecords: 0, derivedFraction: 0.667 } });
});

test('pluralizes adjudications when more than one group exists', () => {
  const r = proposeClassifications(
    [
      { issueId: 'a', evidence: 'one' },
      { issueId: 'b', evidence: 'two' },
    ],
    { shaResolves: () => false }
  );
  assert.deepEqual(r, { proposals: [{ issueId: "a", owner: "undetermined", basis: null, derived: false, evidence: "evidence carries no commit reference, so the owner is a judgement rather than a lookup [group of 1; source evidence: one]" }, { issueId: "b", owner: "undetermined", basis: null, derived: false, evidence: "evidence carries no commit reference, so the owner is a judgement rather than a lookup [group of 1; source evidence: two]" }], groups: [{ evidence: "one", issueIds: ["a"], unusable: false, sha: null }, { evidence: "two", issueIds: ["b"], unusable: false, sha: null }], report: { records: 2, judgements: 2, headline: "2 closures arise from 2 distinct adjudications", largestGroup: { size: 1, evidence: "one" }, derivedRecords: 0, residueRecords: 2, evidenceDefectRecords: 0, derivedFraction: 0 } });
});
