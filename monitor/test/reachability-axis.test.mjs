// The seam between a call-graph proof and defenceVector.reachability.
//
// govulncheck had been proving reachability into an artifact, a lane and a CRA document since long
// before this test existed, and the axis that decides the verdict stayed blank. These assertions
// pin the mapping, and one of them is the whole reason the module exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachabilityAxis, applyReachabilityAxis } from '../reachability-axis.mjs';
import { computeDefence } from '../defence-vector.mjs';

const callGraph = (detail, extra = {}) => ({
  evidence: [{ source: 'govulncheck', method: 'call_graph', confidence: 'high', detail }],
  ...extra,
});

// ─────────────────────── the rule this file exists to enforce ───────────────────────

test('UNPROVEN NEVER BLOCKS — absence of proof is not proof of absence', () => {
  const res = { reachability: 'reachability_unproven', ...callGraph('traced no call path') };
  const { axis } = reachabilityAxis(res);
  assert.notEqual(axis.state, 'blocks',
    'mapping unproven to blocks converts "we could not show a path" into "this is contained" — ' +
    'dep-scan\'s in_triage defect in mirror image, and this time it flatters us');
  assert.equal(axis.state, 'partial');
  assert.match(axis.rationale, /absence of proof is not proof of absence/);
});

test('...and D-PROBE would NOT have caught it, which is why the assertion above is direct', () => {
  // computeDefence downgrades reachability:blocks -> partial unless the ref cites a call graph.
  // Ours DOES cite one, so a wrong `blocks` would sail straight through the guard that looks like
  // it protects this boundary. Demonstrated rather than asserted in a comment.
  const forged = { defenceVector: { reachability: { state: 'blocks', evidence: 'x', ref: 'call-graph:govulncheck' } } };
  const d = computeDefence(forged);
  assert.equal(d.defenceVector.reachability.state, 'blocks', 'D-PROBE passes a call-graph ref through untouched');
});

// ─────────────────────── the mapping ───────────────────────

test('a traced call path is measured, and blocks nothing', () => {
  const { axis } = reachabilityAxis({ reachability: 'reachable', ...callGraph('traced a call path') });
  assert.equal(axis.state, 'open', 'a proven path is the ABSENCE of a defence on this axis');
  assert.ok(axis.evidence.trim(), 'but it IS a reading — evidence is what separates it from unmeasured');
  assert.match(axis.ref, /^call-graph:govulncheck/);
});

test('only a call_graph method may write this axis — dep-scan is refused', () => {
  const depScan = { reachability: 'reachability_unknown',
    evidence: [{ source: 'dep-scan', method: 'scanner_default', confidence: 'low', detail: 'x' }] };
  assert.equal(reachabilityAxis(depScan), null,
    'admitting a static slice here would launder it into the field a compiler proof writes');
});

test('no analyser row leaves the axis untouched, so the record stays undetermined', () => {
  assert.equal(reachabilityAxis({ reachability: 'reachability_unknown', evidence: [] }), null);
  assert.equal(reachabilityAxis(null), null);
  assert.equal(reachabilityAxis({}), null);
});

test('an ambiguous alias is refused with its reason, not silently dropped', () => {
  const res = { refused: 'ambiguous', claimedBy: ['GO-1', 'GO-2'], why: 'two Go advisories claim it' };
  const m = reachabilityAxis(res);
  assert.equal(m.axis, null, 'no reading');
  assert.equal(m.note.reachabilityRefused, 'ambiguous');
  assert.deepEqual(m.note.claimedBy, ['GO-1', 'GO-2'],
    'a refusal and an absence must stay distinguishable — otherwise grey collapses into grey');
});

test('alias provenance and fan-out ride along, because a proof from nowhere is not a proof', () => {
  const { axis, note } = reachabilityAxis({
    reachability: 'reachable', aliased: true, via: 'GO-2023-2102', fanOut: 3, ...callGraph('traced a call path'),
  });
  assert.match(axis.ref, /via GO-2023-2102/);
  assert.match(axis.evidence, /alias fan-out 3/);
  assert.equal(note.reachabilityVia, 'GO-2023-2102');
});

// ─────────────────────── applying it to a record ───────────────────────

test('applying the axis flips the verdict off undetermined, and reports which happened', () => {
  const rec = { repo: 'r', id: 'CVE-1', package: 'p' };
  assert.equal(applyReachabilityAxis(rec, { reachability: 'reachable', ...callGraph('traced a call path') }), 'set');
  const d = computeDefence(rec);
  assert.equal(d.unmeasured, false, 'the vector has been read now');
  assert.equal(d.residualVerdict, 'exploitable',
    'a proven path with no defences recorded IS exploitable — and now it is a finding, not a default');
});

test('a record with no reading keeps the honest verdict', () => {
  const rec = { repo: 'r', id: 'CVE-2023-44487', package: 'golang.org/x/net' };
  assert.equal(applyReachabilityAxis(rec, { reachability: 'reachability_unknown', evidence: [] }), 'skipped');
  assert.equal(computeDefence(rec).residualVerdict, 'undetermined',
    'CVE-2023-44487 carries no GO- alias, so no proof can be attributed to it — it must stay undetermined');
});

test('an authored judgement outranks the machine and is never overwritten', () => {
  const rec = { repo: 'r', id: 'CVE-1', package: 'p',
    defenceVector: { reachability: { state: 'blocks', evidence: 'human: the package is vendored out', ref: 'unused-dep' } } };
  assert.equal(applyReachabilityAxis(rec, { reachability: 'reachable', ...callGraph('traced a call path') }), 'skipped');
  assert.equal(rec.defenceVector.reachability.evidence, 'human: the package is vendored out',
    'overwriting a human reading would silently delete the only kind this module cannot make');
});

test('the three outcomes are exactly the counter keys, so the join rate cannot silently mis-tally', () => {
  const seen = new Set([
    applyReachabilityAxis({}, { reachability: 'reachable', ...callGraph('d') }),
    applyReachabilityAxis({}, { refused: 'ambiguous', claimedBy: [] }),
    applyReachabilityAxis({}, null),
  ]);
  assert.deepEqual([...seen].sort(), ['refused', 'set', 'skipped']);
});
