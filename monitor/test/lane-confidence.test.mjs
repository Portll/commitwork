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
