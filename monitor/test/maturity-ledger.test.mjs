// node --test monitor/test/ — I8 + I6: the beta burn-down, per CHECK, with the adjudicated
// fraction as a first-class number rather than a footnote.
//
// PER CHECK, NOT PER LANE (I6). The manifest declares 57 checks and only 47 map to a lane, so TEN
// cannot produce a finding at all. A lane-granular ledger cannot see them — a check with no lane
// has no lane row to appear in — and it would report 47 of 47 while being wrong by omission.
//
// The adjudicated fraction sits BESIDE the wiring numbers (I8) because they are independent: a
// fully wired fleet over an unadjudicated corpus cannot support a frozen baseline, and the wiring
// number alone would suggest it can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageFor, buildMaturityLedger, NON_PUBLISHING, STAGES } from '../maturity-ledger.mjs';

const chk = (id, lane) => ({ id, lane });

// ---- the stages are ordered, and a later one cannot be reached without the earlier ----------------

test('a check with no lane is `declared` — it cannot carry a finding anywhere', () => {
  const s = stageFor({ declared: true, lane: null });
  assert.equal(s.stage, 'declared');
  assert.match(s.why, /reaches no lane/);
});

test('a lane that emits rows WITHOUT detector identity is `producing`, never `gradeable`', () => {
  // This is the state the four (unnamed) lanes were in: rows exist, and a finding among them cannot
  // be attributed to anything a maintainer could fix.
  const s = stageFor({ declared: true, lane: 'cspm', producedRows: true, hasDetectorIdentity: false });
  assert.equal(s.stage, 'producing');
  assert.match(s.why, /cannot be attributed to anything fixable/);
});

test('rows plus a detector identity is `gradeable`', () => {
  assert.equal(stageFor({ declared: true, lane: 'secrets', producedRows: true, hasDetectorIdentity: true }).stage, 'gradeable');
});

test('an undeclared check has NO stage — it does not exist rather than sitting at the floor', () => {
  assert.equal(stageFor({ declared: false }).stage, null);
});

// ---- non-publishing by design is not a gap ---------------------------------------------------------

test('a DECLARED non-publishing check is terminal `wired` — its emptiness is a design decision', () => {
  const s = stageFor({ declared: true, lane: null, nonPublishing: NON_PUBLISHING.sbom });
  assert.equal(s.stage, 'wired');
  assert.equal(s.terminal, true);
  assert.match(s.why, /non-publishing/);
});

test('terminal checks are EXCLUDED from the gradeable denominator', () => {
  // Including them would manufacture a permanent shortfall: an SBOM will never be gradeable, and a
  // fraction that can never reach 1 is a number nobody can act on.
  const led = buildMaturityLedger({
    checks: [chk('sbom', null), chk('secrets', 'secrets')],
    produced: new Set(['secrets']), addressed: new Set(['secrets']),
  });
  assert.equal(led.summary.eligibleForFindings, 1);
  assert.equal(led.summary.gradeableFraction, 1, 'one eligible check, gradeable — not 0.5');
  assert.equal(led.summary.nonPublishingByDesign, 1);
});

test('every declared non-publishing check carries a REASON, not just a marker', () => {
  for (const [id, why] of Object.entries(NON_PUBLISHING)) {
    assert.ok(why && why.length > 15, `${id}: needs a reason a reader can evaluate`);
  }
});

// ---- I6: the ten checks a per-lane ledger cannot see -------------------------------------------------

test('a check with no lane still gets a ROW — this is why the ledger is per-check', () => {
  const led = buildMaturityLedger({ checks: [chk('orphan-check', null), chk('secrets', 'secrets')] });
  assert.equal(led.rows.length, 2);
  assert.ok(led.rows.find((r) => r.check === 'orphan-check'), 'a lane-granular ledger would omit this entirely');
});

test('rows are sorted, so the ledger is byte-stable across runs', () => {
  const led = buildMaturityLedger({ checks: [chk('z', null), chk('a', null)] });
  assert.deepEqual(led.rows.map((r) => r.check), ['a', 'z']);
});

// ---- I8: the adjudicated fraction, and the sentence that must not be conditional ---------------------

test('the readiness sentence ALWAYS states both numbers', () => {
  // An earlier version branched on adjudicated/total < 0.05 and fell to a vague sentence at 0.0771
  // — a magic threshold deciding whether a reader is told the actual figures.
  const led = buildMaturityLedger({
    checks: [chk('secrets', 'secrets')], produced: new Set(['secrets']), addressed: new Set(['secrets']),
    adjudication: { adjudicated: 137, total: 1777 },
  });
  assert.equal(led.summary.adjudicatedFraction, 0.0771);
  assert.match(led.summary.readiness, /137 of 1777/);
  assert.match(led.summary.readiness, /1 of 1 checks gradeable/);
  assert.match(led.summary.readiness, /independent/);
});

test('a HIGH adjudicated fraction still states the numbers — no threshold silences them', () => {
  const led = buildMaturityLedger({
    checks: [chk('secrets', 'secrets')], adjudication: { adjudicated: 900, total: 1000 },
  });
  assert.match(led.summary.readiness, /900 of 1000/, 'the numbers are the message at every fraction');
});

test('NO ISSUE STORE means adjudication is UNKNOWN, never zero', () => {
  const led = buildMaturityLedger({ checks: [chk('secrets', 'secrets')] });
  assert.equal(led.summary.adjudicatedFraction, null, 'null, not 0 — "not supplied" is not "none adjudicated"');
  assert.match(led.summary.readiness, /adjudication unknown/);
});

// ---- non-vacuity --------------------------------------------------------------------------------------

test('NOT VACUOUS: the four stages are all reachable', () => {
  // Without this, a stageFor() that always returned 'wired' would satisfy several tests above.
  const led = buildMaturityLedger({
    checks: [chk('a', null), chk('sbom', null), chk('b', 'laneB'), chk('c', 'laneC')],
    produced: new Set(['laneB', 'laneC']), addressed: new Set(['laneC']),
  });
  const stages = led.rows.map((r) => r.stage);
  assert.ok(stages.includes('declared'), 'a laneless check');
  assert.ok(stages.includes('wired'), 'a non-publishing check');
  assert.ok(stages.includes('producing'), 'rows without identity');
  assert.ok(stages.includes('gradeable'), 'rows with identity');
  assert.deepEqual([...STAGES].sort(), [...new Set(stages)].sort());
});

test('an empty ledger reports zeroes, not a fabricated readiness', () => {
  const led = buildMaturityLedger({ checks: [] });
  assert.equal(led.summary.checksDeclared, 0);
  assert.equal(led.summary.gradeableFraction, 0);
});
