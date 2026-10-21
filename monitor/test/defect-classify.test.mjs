// node --test monitor/test/ — I5: derive a defectOwner before judging one, and count JUDGEMENTS
// rather than rows.
//
// THE MEASUREMENT THAT MOTIVATED THIS. 136 closures carry `refuted` and every one has an evidence
// string, so "136 findings adjudicated with evidence" is true of each record. It is false of the
// set: those 136 hold EIGHT distinct evidence strings — 124 share one, 6 are the literal text
// `[object Object]`, 6 are individually reasoned. Three bulk adjudication events, not 136
// judgements. A reader told "136" hears something the data does not support.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnusableEvidence, citedSha, groupByEvidence, deriveOwner, proposeClassifications } from '../defect-classify.mjs';

const c = (issueId, evidence) => ({ issueId, evidence });
const resolves = (set) => (sha) => set.has(sha);

// ---- rows are not judgements --------------------------------------------------------------------

test('THE HEADLINE: many rows sharing one evidence string are ONE adjudication', () => {
  const closures = Array.from({ length: 124 }, (_, i) => c(`ISS-${i}`, 'refuted: transient gate-tests worktree; fixed at 7e57a1d'));
  const { report } = proposeClassifications(closures, { shaResolves: resolves(new Set(['7e57a1d'])) });
  assert.equal(report.records, 124);
  assert.equal(report.judgements, 1, '124 records, ONE judgement — the gap is the thing a reader must be told');
  assert.match(report.headline, /124 closures arise from 1 distinct adjudication\b/);
});

test('groups are ordered largest first, so the bulk act is the first thing seen', () => {
  const g = groupByEvidence([c('a', 'X'), c('b', 'Y'), c('c', 'X'), c('d', 'X')]);
  assert.equal(g[0].issueIds.length, 3);
  assert.equal(g[0].evidence, 'X');
});

// ---- derive before judging ----------------------------------------------------------------------

test('a sha that RESOLVES in this repository derives instrument, by lookup not opinion', () => {
  const g = groupByEvidence([c('a', 'fixed at 7e57a1d')])[0];
  const d = deriveOwner(g, { shaResolves: resolves(new Set(['7e57a1d'])) });
  assert.equal(d.owner, 'instrument');
  assert.equal(d.basis, 'commit');
  assert.equal(d.derived, true);
  assert.match(d.why, /lookup, not a judgement/);
});

test('a sha that does NOT resolve here stays undetermined and says why', () => {
  // It may be an upstream commit — which is exactly the call a human or dual-model pass must make.
  const g = groupByEvidence([c('a', 'fixed upstream at deadbee')])[0];
  const d = deriveOwner(g, { shaResolves: resolves(new Set()) });
  assert.equal(d.owner, 'undetermined');
  assert.equal(d.basis, null, 'no basis, because nothing was established');
  assert.match(d.why, /does not resolve in this repository/);
});

test('evidence with NO sha is a judgement, never a derivation', () => {
  const g = groupByEvidence([c('a', 'Self-reference, not a finding. The detector matches its own literals.')])[0];
  const d = deriveOwner(g, { shaResolves: resolves(new Set()) });
  assert.equal(d.derived, false);
  assert.match(d.why, /no commit reference/);
});

test('DERIVATION IS DELIBERATELY NARROW — no keyword heuristics', () => {
  // Evidence that plainly describes commitwork's own defect but cites no sha must NOT derive.
  // Widening this would convert opinion into apparent derivation, which is the failure being avoided.
  const g = groupByEvidence([c('a', 'this is commitwork scanning its own monitor/ directory, obviously our bug')])[0];
  assert.equal(deriveOwner(g, { shaResolves: resolves(new Set()) }).derived, false);
});

// ---- the evidence defect, which must not hide inside "residue" ------------------------------------

test('`[object Object]` is a RECORD DEFECT, not a pending judgement', () => {
  const g = groupByEvidence([c('a', '[object Object]'), c('b', '[object Object]')])[0];
  const d = deriveOwner(g, { shaResolves: resolves(new Set()) });
  assert.equal(d.evidenceDefect, true, 'six live closures hold exactly this string');
  assert.equal(d.owner, 'undetermined');
  assert.match(d.why, /unrecoverable/);
});

test('unusable evidence covers blank, undefined and null as TEXT', () => {
  for (const bad of ['', '   ', '[object Object]', 'undefined', 'null', null, undefined]) {
    assert.equal(isUnusableEvidence(bad), true, `${JSON.stringify(bad)} carries no reasoning`);
  }
  assert.equal(isUnusableEvidence('a real reason'), false);
});

test('the report counts defect records APART from residue', () => {
  const { report } = proposeClassifications([
    c('a', 'fixed at cafe123'), c('b', '[object Object]'), c('c', 'a judgement with no sha'),
  ], { shaResolves: resolves(new Set(['cafe123'])) });
  assert.equal(report.derivedRecords, 1);
  assert.equal(report.evidenceDefectRecords, 1);
  assert.equal(report.residueRecords, 1);
  assert.equal(report.derivedRecords + report.evidenceDefectRecords + report.residueRecords, report.records,
    'the three buckets must account for every record — a rate over a lossy split is fabricated');
});

// ---- what a rate would rest on --------------------------------------------------------------------

test('derivedFraction is published BEFORE anyone computes a rate', () => {
  const closures = [...Array(9)].map((_, i) => c(`d${i}`, 'fixed at abc1234')).concat([c('j', 'judged')]);
  const { report } = proposeClassifications(closures, { shaResolves: resolves(new Set(['abc1234'])) });
  assert.equal(report.derivedFraction, 0.9, 'how much of the input is lookup rather than opinion');
});

test('citedSha is narrow: a whole hex word, not any hex-looking fragment', () => {
  assert.equal(citedSha('fixed at 7e57a1d'), '7e57a1d');
  assert.equal(citedSha('no sha here'), null);
  assert.equal(citedSha('deadbeefcafe1234567890abcdef1234567890ab'), 'deadbeefcafe1234567890abcdef1234567890ab');
  assert.equal(citedSha('abc'), null, 'three chars is not a sha');
});

// ---- refusals and non-vacuity ---------------------------------------------------------------------

test('nothing is written — the proposal is a proposal', () => {
  const closures = [c('a', 'fixed at abc1234')];
  const before = JSON.stringify(closures);
  proposeClassifications(closures, { shaResolves: resolves(new Set(['abc1234'])) });
  assert.equal(JSON.stringify(closures), before);
});

test('a missing shaResolves does not derive anything — it fails to residue, never to instrument', () => {
  const { report } = proposeClassifications([c('a', 'fixed at abc1234')], {});
  assert.equal(report.derivedRecords, 0, 'no lookup available means no derivation, not an assumed one');
  assert.equal(report.residueRecords, 1);
});

test('NOT VACUOUS: an empty input yields zero judgements, not one', () => {
  const { report } = proposeClassifications([], { shaResolves: resolves(new Set()) });
  assert.equal(report.records, 0);
  assert.equal(report.judgements, 0);
  assert.equal(report.largestGroup, null, 'an empty set has no largest group — not a group of size 0');
  assert.equal(report.derivedFraction, 0);
});

test('every proposal names an issue and carries the group size in its evidence', () => {
  const { proposals } = proposeClassifications([c('a', 'fixed at abc1234'), c('b', 'fixed at abc1234')],
    { shaResolves: resolves(new Set(['abc1234'])) });
  assert.equal(proposals.length, 2, 'one entry per ISSUE, so it can be applied');
  assert.match(proposals[0].evidence, /group of 2/, 'and each says how many records shared its reasoning');
});
