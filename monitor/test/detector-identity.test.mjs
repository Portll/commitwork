// node --test monitor/test/ — I4/I12: the address an upstream fix would be sent to.
//
// Four lanes published `(unnamed)` as their only rule — 1,571 rows with no identity between them.
// The finding INVERTED on measurement: all four carry an identity the extractor never read. These
// tests use the EXACT shapes observed in live artifacts on 2026-08-26, so a tool changing its
// output breaks a test rather than silently re-anonymising a lane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectorFor, byDetector, DETECTOR_SOURCES } from '../detector-identity.mjs';

// ---- the four that were anonymous, with their real shapes --------------------------------------

test('trufflehog: DetectorName is the address, DetectorType is not', () => {
  const r = detectorFor('trufflehog', { DetectorName: 'MongoDB', DetectorType: 895, Verified: true });
  assert.equal(r.id, 'MongoDB');
  assert.equal(r.address, 'trufflehog/MongoDB');
  assert.ok(!String(r.address).includes('895'), 'a number is not an address a maintainer can act on');
});

test('scorecard: the check name', () => {
  assert.equal(detectorFor('scorecard', { name: 'Branch-Protection', score: 0 }).address, 'scorecard/Branch-Protection');
});

test('prowler: the clean analytic uid, NOT the composite that also encodes repo coordinates', () => {
  const row = {
    finding_info: { analytic: { uid: 'githubactions_workflow_security_scan' }, uid: 'prowler-github-githubactions_workflow_security_scan-mgechev-mgechev-revive' },
    metadata: { event_code: 'githubactions_workflow_security_scan' },
  };
  const r = detectorFor('prowler', row);
  assert.equal(r.id, 'githubactions_workflow_security_scan');
  assert.ok(!r.id.includes('mgechev'),
    'slicing the composite uid would break on the first repo whose name contains a hyphen');
});

test('prowler falls back to metadata.event_code when analytic is absent', () => {
  assert.equal(detectorFor('prowler', { metadata: { event_code: 'repository_default_branch_protection' } }).id,
    'repository_default_branch_protection');
});

test('a11y: the WCAG success criterion', () => {
  assert.equal(detectorFor('a11y', { id: '1.4.4', level: 'AA', name: 'Resize Text' }).address, 'a11y/1.4.4');
});

// ---- the two kinds of null, kept apart ---------------------------------------------------------

test('an UNDECLARED tool says so — it does not read as "this row has no detector"', () => {
  const r = detectorFor('some-new-scanner', { ruleId: 'x' });
  assert.equal(r.id, null);
  assert.match(r.why, /no extractor declared/);
});

test('a DECLARED tool whose row carries nothing says which field was missing', () => {
  const r = detectorFor('trufflehog', { Verified: true });
  assert.equal(r.id, null);
  assert.match(r.why, /DetectorName/,
    'naming the field is what turns a null into something someone can fix');
});

test('the two nulls are distinguishable — that is the whole point of `why`', () => {
  const undeclared = detectorFor('nope', { id: 'x' });
  const empty = detectorFor('a11y', {});
  assert.notEqual(undeclared.why, empty.why);
});

test('a blank or whitespace id is absent, not an address', () => {
  assert.equal(detectorFor('scorecard', { name: '   ' }).id, null);
  assert.equal(detectorFor('scorecard', { name: '' }).id, null);
});

// ---- the address property: one fix closes a bucket ----------------------------------------------

test('THE LEVERAGE ARITHMETIC: findings sharing a detector form one bucket', () => {
  const rows = [
    { tool: 'trufflehog', DetectorName: 'Lob' }, { tool: 'trufflehog', DetectorName: 'Lob' },
    { tool: 'trufflehog', DetectorName: 'Lob' }, { tool: 'trufflehog', DetectorName: 'MongoDB' },
    { tool: 'scorecard', name: 'Branch-Protection' },
  ];
  const { buckets, report } = byDetector(rows);
  assert.equal(report.detectors, 3);
  assert.equal(buckets.get('trufflehog/Lob').length, 3);
  assert.deepEqual(report.largestBucket, { address: 'trufflehog/Lob', n: 3 },
    'the biggest bucket is what one upstream fix would close — the number the leverage claim rests on');
});

test('two lanes running the same tool land on ONE address', () => {
  // sastCodeql and sastCodeqlRuby are different lanes and the same upstream project. If they split
  // into two addresses, one fix would be counted as two and the leverage figure inflates.
  const { buckets } = byDetector([
    { tool: 'codeql', ruleId: 'js/request-forgery' },
    { tool: 'codeql', ruleId: 'js/request-forgery' },
  ]);
  assert.equal(buckets.size, 1);
  assert.equal(buckets.get('codeql/js/request-forgery').length, 2);
});

test('unaddressed rows are COUNTED with reasons, never dropped', () => {
  // A leverage figure over a silently reduced denominator is the flattering-rate defect.
  const { report, unaddressed } = byDetector([
    { tool: 'trufflehog', DetectorName: 'Lob' },
    { tool: 'trufflehog' },
    { tool: 'mystery', x: 1 },
  ]);
  assert.equal(report.rows, 3);
  assert.equal(report.addressed, 1);
  assert.equal(report.unaddressed, 2);
  assert.equal(unaddressed.length, 2);
  assert.equal(Object.keys(report.reasons).length, 2, 'the two kinds of null are counted apart');
});

test('NOT VACUOUS: an empty input yields zero detectors, not a fabricated bucket', () => {
  const { report } = byDetector([]);
  assert.equal(report.detectors, 0);
  assert.equal(report.largestBucket.address, null);
  assert.equal(report.largestBucket.n, 0, 'a largest-bucket of 0 must not read as 1');
});

// ---- the declaration is the contract ------------------------------------------------------------

test('every declared tool carries a worked example, so the table is checkable', () => {
  for (const [tool, spec] of Object.entries(DETECTOR_SOURCES)) {
    assert.ok(Array.isArray(spec.path) && spec.path.length, `${tool}: path must be declared`);
    assert.ok(typeof spec.example === 'string' && spec.example, `${tool}: needs a worked example`);
  }
});

test('the four formerly-anonymous lanes are all declared', () => {
  for (const t of ['trufflehog', 'scorecard', 'prowler', 'a11y']) {
    assert.ok(DETECTOR_SOURCES[t], `${t} must be declared — it is one of the four that published (unnamed)`);
  }
});
