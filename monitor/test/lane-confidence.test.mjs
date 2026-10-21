// node --test monitor/test/ — I1: three bars against a confidence weight becoming a severity.
//
// THE DEFECT. A per-lane confidence float on a finding row can be multiplied by that finding's
// severity, and the next measurement then samples the modified output. A control loop whose
// reported accuracy improves every quarter looks exactly like a project succeeding — which is why
// it scored detectability 10. Severity is already a word; confidence was going to be a number; and
// `sev * confidence` is the one-line mistake nobody flags in review.
//
// A: per-lane artifact keyed on detector · B: a word, never a number · C: schema refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, isBand, bandFor, assertNoRowConfidence, refuteBand, buildLaneConfidence } from '../lane-confidence.mjs';
import { ROW_SCHEMAS } from '../detail-schema.mjs';

// ---- BAR B: the vocabulary is closed and contains no numbers ------------------------------------

test('every band is a WORD — nothing in the vocabulary can be multiplied', () => {
  assert.equal(BANDS.length, 7);
  for (const b of BANDS) {
    assert.equal(typeof b.band, 'string');
    assert.ok(Number.isNaN(Number(b.band)), `'${b.band}' must not coerce to a number`);
  }
});

test('each rung names an EVIDENTIARY CONDITION, not a degree of feeling', () => {
  // slightly/moderately/very would be an opinion with seven gradations. These are checkable.
  for (const b of BANDS) {
    assert.ok(b.condition && b.condition.length > 10, `${b.band} needs a condition a third party can check`);
    assert.ok(!/slight|moderate|very|quite|fairly/i.test(b.condition), `${b.band}: condition reads as a feeling`);
  }
});

test('the vocabulary is closed — an invented band is not a band', () => {
  assert.equal(isBand('well-measured'), true);
  assert.equal(isBand('pretty-good'), false);
  assert.equal(isBand(0.87), false, 'a float is emphatically not a band');
});

// ---- the derivation, and the guard that matters most --------------------------------------------

test('OPPORTUNISTIC SAMPLING CANNOT BECOME A MEASUREMENT BY GROWING', () => {
  // The live store holds 136 opportunistically-adjudicated findings. Volume is not sampling, and a
  // lane must not climb the ladder because someone looked at a lot of things that looked wrong.
  const b = bandFor({ adjudicated: 10_000, sampling: 'opportunistic', intervalStated: true, interRater: true });
  assert.equal(b.band, 'anecdotal', 'capped, regardless of count or interval');
  assert.match(b.why, /selection cannot become a measurement by growing/);
});

test('a random sample climbs only as far as its evidence allows', () => {
  assert.equal(bandFor({ adjudicated: 0 }).band, 'unmeasured');
  assert.equal(bandFor({ adjudicated: 3, sampling: 'random' }).band, 'anecdotal');
  assert.equal(bandFor({ adjudicated: 50, sampling: 'random' }).band, 'indicative', 'a sample with no interval');
  assert.equal(bandFor({ adjudicated: 50, sampling: 'random', intervalStated: true, intervalWide: true }).band, 'provisional');
  assert.equal(bandFor({ adjudicated: 50, sampling: 'random', intervalStated: true, intervalWide: false }).band, 'measured');
  assert.equal(bandFor({ adjudicated: 50, sampling: 'random', intervalStated: true, interRater: true }).band, 'well-measured');
});

test('external evaluation is the only route to the top rung', () => {
  assert.equal(bandFor({ adjudicated: 9999, sampling: 'random', intervalStated: true, intervalWide: false, interRater: true }).band,
    'well-measured', 'everything we can do ourselves stops one rung short');
  assert.equal(bandFor({ externalEval: true }).band, 'externally-verified');
});

test('a lane cannot reach a high rung by satisfying a low one', () => {
  // interRater without a stated interval must not jump to well-measured.
  assert.equal(bandFor({ adjudicated: 50, sampling: 'random', interRater: true, intervalStated: false }).band, 'indicative');
});

// ---- BAR C: the schema refuses it on a finding row ------------------------------------------------

test('BAR C: no finding-row schema declares a confidence field, and this is the assertion that keeps it so', () => {
  assert.deepEqual(assertNoRowConfidence(ROW_SCHEMAS), [],
    'a confidence field on a finding row is one join away from being multiplied by a severity');
});

test('a confidence-NAMED field that is a STRING is inert and passes — no exemption needed', () => {
  // This is how the guard stopped needing an exemption list. supplyChainPosture.score is declared
  // `str` and is Scorecard's own per-check result about the REPOSITORY. The danger was never a
  // field called `score`; it is a field that can be multiplied by a severity, and a word cannot be.
  assert.deepEqual(assertNoRowConfidence({ x: { fields: [['score', 'str', 'Score']] } }), []);
  assert.equal(ROW_SCHEMAS.supplyChainPosture.fields.find(([f]) => f === 'score')[1], 'str',
    'if this ever becomes num, BAR C must fail until somebody decides which kind of score it is');
});

test('the SAME name with an arithmetic type fails — narrower guard, not a weaker one', () => {
  for (const t of ['num', 'int']) {
    assert.deepEqual(assertNoRowConfidence({ x: { fields: [['score', t, 'Score']] } }), ['x.score'],
      `score:${t} is multipliable and must fail`);
  }
});

test('BAR C is NOT VACUOUS — it catches the field it exists to catch', () => {
  // Without this, the assertion above would pass on a function that always returns [].
  const bad = assertNoRowConfidence({ secrets: { fields: [['rule', 'str', 'Rule'], ['confidence', 'num', 'Confidence']] } });
  assert.deepEqual(bad, ['secrets.confidence']);
  for (const f of ['band', 'weight', 'accuracy', 'score']) {
    assert.equal(assertNoRowConfidence({ x: { fields: [[f, 'num', f]] } }).length, 1, `${f} must also be caught`);
  }
});

// ---- BAR A: the artifact is keyed on detector and carries no finding ------------------------------

test('BAR A: the artifact holds no finding, no severity and no number that could be a weight', () => {
  const art = buildLaneConfidence([
    { detector: 'trufflehog/Lob', adjudicated: 0 },
    { detector: 'gitleaks/generic-api-key', adjudicated: 136, sampling: 'opportunistic' },
  ], { at: '2026-08-27' });
  const blob = JSON.stringify(art);
  assert.ok(!/"sev"|"severity"|"crit"|"high"/.test(blob), 'no severity may appear in the confidence artifact');
  assert.ok(!/"file"|"line"/.test(blob), 'no finding location — this is per-detector, not per-finding');
  for (const l of art.lanes) assert.equal(typeof l.band, 'string');
});

test('lanes are sorted, so the artifact is byte-stable across runs', () => {
  const a = buildLaneConfidence([{ detector: 'z/x' }, { detector: 'a/y' }]);
  assert.deepEqual(a.lanes.map((l) => l.detector), ['a/y', 'z/x']);
});

test('the artifact publishes its own vocabulary and a tally', () => {
  const art = buildLaneConfidence([{ detector: 'a/1' }, { detector: 'b/2' }]);
  assert.equal(art.vocabulary.length, 7);
  assert.equal(art.tally.unmeasured, 2);
});

// ---- refute-if-disagree ---------------------------------------------------------------------------

test('a band is a CLAIM and can be contested', () => {
  const r = refuteBand({ detector: 'trufflehog/Lob', band: 'measured', by: 'upstream maintainer', reason: 'our detector changed in 3.9', at: '2026-08-27' });
  assert.equal(r.detector, 'trufflehog/Lob');
  assert.match(r.reason, /changed in 3.9/);
});

test('a refutation must name a detector, a real band, and a reason', () => {
  assert.throws(() => refuteBand({ band: 'measured', reason: 'x' }), /must name the detector/);
  assert.throws(() => refuteBand({ detector: 'a/b', band: 'excellent', reason: 'x' }), /is not one of/);
  assert.throws(() => refuteBand({ detector: 'a/b', band: 'measured', reason: '  ' }), /disagreement, not a refutation/);
});

test('a contested band is published WITH its refutation — the band does not silently win', () => {
  const ref = refuteBand({ detector: 'a/1', band: 'measured', by: 'them', reason: 'disputed', at: 'now' });
  const art = buildLaneConfidence([{ detector: 'a/1', adjudicated: 0 }], { refutations: [ref] });
  assert.equal(art.lanes[0].refutations.length, 1);
  const clean = buildLaneConfidence([{ detector: 'b/2' }], { refutations: [ref] });
  assert.equal(clean.lanes[0].refutations, undefined, 'an uncontested lane carries no empty array to imply one');
});

// ---- positive controls: a zero is a measurement only if the lane was recently shown to fire ----

import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'node:test';
import { readPositiveControls, positiveControlState, sweepResultFor, POSITIVE_CONTROL_STATES } from '../lane-confidence.mjs';

afterEach(() => { delete process.env.CW_POSITIVE_CONTROLS; delete process.env.CW_POSITIVE_CONTROL_MAX_AGE_DAYS; delete process.env.CW_NOW; });

const scratch = () => mkdtempSync(join(tmpdir(), 'cw-posctl-'));
const NOW = '2026-10-11T00:00:00.000Z';
const controlsFile = (lanes) => { const p = join(scratch(), 'controls.json'); writeFileSync(p, JSON.stringify(lanes)); return p; };

test('the control state is a WORD from a closed vocabulary', () => {
  assert.deepEqual([...POSITIVE_CONTROL_STATES], ['absent', 'missed', 'stale', 'current']);
  assert.throws(() => bandFor({ adjudicated: 0, positiveControl: 0.9 }), /not a positive-control state/);
});

test('a CURRENT control leaves the band exactly where it was', () => {
  const inputs = [{ adjudicated: 0 }, { adjudicated: 50, sampling: 'random', intervalStated: true, intervalWide: false }, { externalEval: true }];
  for (const i of inputs) {
    const plain = bandFor(i);
    const withControl = bandFor({ ...i, positiveControl: 'current' });
    assert.equal(withControl.band, plain.band);
    assert.equal(withControl.why, plain.why);
    assert.equal(withControl.positiveControl, 'current', 'recorded in its own field');
  }
});

test('an ABSENT control: the lane says so, and its zero-finding sweep is UNMEASURED, not clean', () => {
  const art = buildLaneConfidence([
    { detector: 'nothing-planted-here/rule', adjudicated: 0, sweepFindings: 0 },
    { detector: 'nothing-planted-here/other', adjudicated: 0, sweepFindings: 3 },
  ], { positiveControls: null, now: NOW });
  const [other, zero] = art.lanes;
  assert.equal(zero.positiveControl, 'absent');
  assert.equal(zero.sweepResult, 'unmeasured');
  assert.match(zero.sweepResultWhy, /not been shown to fire/);
  assert.equal(zero.band, 'unmeasured', 'the band is unchanged by the control');
  assert.equal(other.sweepResult, 'findings', 'findings are findings whatever the control says');
  assert.equal(art.positiveControls.read, false);
  assert.deepEqual(art.positiveControls.tally, { absent: 2 });
});

test('a current, a stale and a missed control, from a CW_POSITIVE_CONTROLS record read at CALL time', () => {
  process.env.CW_POSITIVE_CONTROLS = controlsFile({
    fresh: { ranAt: '2026-10-01', outcome: 'detected' },
    old: { ranAt: '2026-08-01', outcome: 'detected' },
    blind: { ranAt: '2026-10-10', outcome: 'missed' },
    never: { ranAt: null, outcome: 'not-run' },
  });
  process.env.CW_NOW = NOW;
  const art = buildLaneConfidence([
    { detector: 'fresh/r', sweepFindings: 0 }, { detector: 'old/r', sweepFindings: 0 },
    { detector: 'blind/r', sweepFindings: 0 }, { detector: 'never/r', sweepFindings: 0 },
  ]);
  const by = Object.fromEntries(art.lanes.map((l) => [l.detector, l]));
  assert.equal(by['fresh/r'].positiveControl, 'current');
  assert.equal(by['fresh/r'].sweepResult, 'clean', 'the only zero that counts as clean');
  assert.equal(by['old/r'].positiveControl, 'stale');
  assert.equal(by['old/r'].sweepResult, 'unmeasured');
  assert.equal(by['blind/r'].positiveControl, 'missed');
  assert.equal(by['blind/r'].sweepResult, 'unmeasured');
  assert.equal(by['never/r'].positiveControl, 'absent');
  assert.equal(art.positiveControls.source, 'positive-controls');
  process.env.CW_POSITIVE_CONTROL_MAX_AGE_DAYS = '90';
  assert.equal(buildLaneConfidence([{ detector: 'old/r' }]).lanes[0].positiveControl, 'current', 'the window is read at call time');
});

test('an UNREADABLE control file is an error, never an empty record', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'broken.json'), '{not json');
  process.env.CW_POSITIVE_CONTROLS = join(dir, 'broken.json');
  assert.throws(() => readPositiveControls(), SyntaxError);
  assert.throws(() => buildLaneConfidence([{ detector: 'a/b' }]), SyntaxError, 'and the artifact refuses to build over it');
  mkdirSync(join(dir, 'isdir'));
  process.env.CW_POSITIVE_CONTROLS = join(dir, 'isdir');
  assert.throws(() => readPositiveControls(), /EISDIR/);
  process.env.CW_POSITIVE_CONTROLS = controlsFile({ x: { ranAt: '2026-10-01', outcome: 'probably' } });
  assert.throws(() => readPositiveControls(), /needs an outcome from/);
  process.env.CW_POSITIVE_CONTROLS = join(dir, 'absent.json');
  assert.deepEqual(readPositiveControls(), { source: 'positive-controls', path: join(dir, 'absent.json'), read: false, lanes: {} }, 'ENOENT alone is absence');
});

test('without a controls file the scan canary record is the input, mapped per lane', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify({ measured: { date: '2026-10-05', lanes: {
    secrets: { clean: 'exit 0, 0 findings', dirty: 'exit 1, 2 findings', verdict: 'BOTH DIRECTIONS DEMONSTRATED' },
    sast: { clean: 'exit 0, 1 finding', dirty: 'exit 0, 3 findings', verdict: 'CLEAN TREE FIRED' },
  } } }));
  const rec = readPositiveControls({ canaryDir: dir });
  assert.equal(rec.source, 'scan-canary');
  assert.deepEqual(rec.lanes.secrets, { ranAt: '2026-10-05', outcome: 'detected', verdict: 'BOTH DIRECTIONS DEMONSTRATED' });
  assert.equal(rec.lanes.sastSemgrep.outcome, 'missed', 'a verdict short of both directions does not demonstrate detection, and the verdict is kept');
  assert.equal(positiveControlState(rec.lanes.secrets, { now: NOW }), 'current');
  assert.equal(positiveControlState(rec.lanes.sastSemgrep, { now: NOW }), 'missed');
  writeFileSync(join(dir, 'EXPECTED.json'), '{not json');
  assert.throws(() => readPositiveControls({ canaryDir: dir }), SyntaxError);
});

test('sweepResultFor refuses a count that is not a count', () => {
  assert.equal(sweepResultFor({}), null, 'no count reported: no result claimed');
  assert.throws(() => sweepResultFor({ sweepFindings: -1 }), RangeError);
  assert.throws(() => sweepResultFor({ sweepFindings: 'none' }), RangeError);
});

// ---- defect signatures feed the band as a boolean, never a factor ---------------------------------

test('a defect signature shows on its lane as defectSignature: true, and only there', () => {
  const sigs = { signatures: [{ detector: 'secretsHistory/Lob', lane: 'secretsHistory', rate: 0.9977, population: 100, positives: 99, signature: true }] };
  const art = buildLaneConfidence([
    { detector: 'secretsHistory/Lob' }, { detector: 'secretsHistory/AWS' }, { detector: 'secretsHistory' }, { detector: 'secrets/x' },
  ], { positiveControls: null, defectSignatures: sigs });
  const by = Object.fromEntries(art.lanes.map((l) => [l.detector, l]));
  assert.equal(by['secretsHistory/Lob'].defectSignature, true);
  assert.deepEqual(by['secretsHistory/Lob'].defectSignatures, ['secretsHistory/Lob']);
  assert.equal(by['secretsHistory/AWS'].defectSignature, false);
  assert.equal(by['secretsHistory'].defectSignature, true, 'the bare lane carries its detector\'s signature');
  assert.equal(by['secrets/x'].defectSignature, false);
  const none = buildLaneConfidence([{ detector: 'secretsHistory/Lob' }], { positiveControls: null });
  assert.equal(none.lanes[0].defectSignature, undefined, 'no artifact supplied: nothing claimed either way');
  assert.ok(!/"sev"|"severity"|"crit"|"high"/.test(JSON.stringify(art)), 'BAR A still holds with the new fields');
});
