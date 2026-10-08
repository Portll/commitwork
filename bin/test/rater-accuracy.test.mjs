import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { score, normalise, subjectKey, readLedger } from '../rater-accuracy.mjs';
import { readAdjudications, appendRecord, adjudicationsPath } from '../lib/verdict-journal-core.mjs';

// The read boundary. An earlier cut of this tool read `.verified` off a shape that has no such key,
// got undefined, and reported 0 raters over 14,898 records — while every test below passed, because
// they all called score() directly and none of them crossed this line.
//
// Crossed here on a ledger the journal writer produces, in the shapes the canary harness and an LLM
// rater write, so the boundary is tested in every checkout — the live ledger is private.
test('THE READ BOUNDARY: a written ledger yields records, and a wrong field name is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rater-ledger-'));
  try {
    for (const rec of [
      { v: 1, kind: 'adjudication', at: '2026-09-01T00:00:00.000Z', gate: 'gate-tests', recordAt: 't1', truth: 'false-clean', adjudicatedBy: 'canary-harness', canary: 'C-1' },
      { v: 1, kind: 'adjudication', at: '2026-09-01T00:00:01.000Z', gate: 'gate-tests', recordAt: 't1', truth: 'false-clean', adjudicatedBy: 'rater', method: 'rater' },
    ]) assert.equal(appendRecord(adjudicationsPath(dir), rec).ok, true);
    const led = readLedger(readAdjudications(dir));
    assert.equal(led.fatal, undefined, led.fatal);
    assert.equal(led.records.length, 2, 'a ledger on disk must yield records — zero here is unreadable, not empty');
    assert.deepEqual(led.warnings, [], 'a ledger its own writer produced reads whole');
    const r = score(led.records);
    assert.equal(r.anchors, 1);
    assert.equal(r.raters.find((x) => x.rater === 'rater').accuracy, 1, 'the records that crossed are the ones score() joins');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  assert.match(readLedger({ verified: [] }).fatal, /shape unrecognised/,
    'the exact defect that shipped: a plausible-looking object with no records[] must be FATAL, not empty');
  assert.match(readLedger({ absent: true }).fatal, /never ran is not zero/);
  assert.match(readLedger(null).fatal, /returned nothing/);
});

test('the live ledger yields records through the same boundary', (t) => {
  const read = readAdjudications();   // only ENOENT is absent; anything else throws and fails here
  if (read.absent) {
    t.skip(`no adjudication ledger at ${adjudicationsPath()} (ENOENT) — the live ledger is private and absent from a clean checkout`);
    return;
  }
  const led = readLedger(read);
  assert.equal(led.fatal, undefined, led.fatal);
  assert.ok(led.records.length > 0, 'a ledger on disk must yield records — zero here is unreadable, not empty');
});

test('a partial read is surfaced, never silently reduced', () => {
  const led = readLedger({ records: [], torn: 3, chain: { broken: 2, raced: 1 } });
  assert.equal(led.fatal, undefined);
  assert.equal(led.warnings.length, 3);
  assert.ok(led.warnings.some((w) => /PARTIALLY/.test(w)));
});


const anchor = (gate, recordAt, verdict) => ({
  kind: 'adjudication', gate, recordAt, truth: 'by-construction', verdict,
});
const judged = (gate, recordAt, truth, method) => ({
  kind: 'adjudication', gate, recordAt, truth, method,
});

test('`truth` means the verdict in one writer and the provenance in the other — normalise reads both', () => {
  const a = normalise(anchor('g', '2026-01-01', 'false-clean'));
  const j = normalise(judged('g', '2026-01-01', 'false-clean', 'rater-x'));
  assert.equal(a.anchored, true);
  assert.equal(a.verdict, 'false-clean', 'anchor verdict comes from `verdict`, not `truth`');
  assert.equal(j.anchored, false);
  assert.equal(j.verdict, 'false-clean', 'rater verdict comes from `truth`');
  assert.equal(a.rater, null);
  assert.equal(j.rater, 'rater-x');
});

test('a plant is an anchor whatever the writer spelled it — key on the plant id, not the spelling', () => {
  // canary-harness: canary:<id> with the answer in `truth`. Keying on truth==='by-construction'
  // filed 9,198 live anchors as a tenth rater.
  const h = normalise({ kind: 'adjudication', gate: 'g', recordAt: 't', truth: 'false-clean', canary: 'C-7', adjudicatedBy: 'canary-harness' });
  assert.equal(h.anchored, true, 'a record carrying a plant id is truth by construction');
  assert.equal(h.verdict, 'false-clean');
  assert.equal(h.rater, null, 'an anchor is not a rater, or it scores itself');

  // rate-llm: no canary, truth IS the verdict.
  const j = normalise({ kind: 'adjudication', gate: 'g', recordAt: 't', truth: 'false-clean', method: 'm' });
  assert.equal(j.anchored, false);
});

test('an anchored plant and a rater on the SAME subject do join and produce accuracy', () => {
  const r = score([
    { kind: 'adjudication', gate: 'gate-tests', recordAt: 't1', truth: 'false-clean', canary: 'C-1' },
    { kind: 'adjudication', gate: 'gate-tests', recordAt: 't1', truth: 'false-clean', method: 'rater' },
  ]);
  assert.equal(r.anchors, 1);
  const s = r.raters.find((x) => x.rater === 'rater');
  assert.equal(s.anchorable, 1);
  assert.equal(s.accuracy, 1);
});

test('a record whose verdict is not in the shared vocabulary is dropped, never coerced', () => {
  assert.equal(normalise({ kind: 'adjudication', gate: 'g', recordAt: 't', truth: 'by-construction', verdict: 'probably' }), null);
  assert.equal(normalise({ kind: 'adjudication-abstention', gate: 'g', recordAt: 't' }), null,
    'an abstention is not a judgement and must stay out of the denominator');
});

test('accuracy is computed only over anchored subjects, and `judged` keeps the full denominator', () => {
  const r = score([
    anchor('g', 't1', 'true-alarm'),
    anchor('g', 't2', 'false-clean'),
    judged('g', 't1', 'true-alarm', 'good'),
    judged('g', 't2', 'false-clean', 'good'),
    judged('g', 't9', 'true-clean', 'good'),      // no anchor for t9
  ]);
  const good = r.raters.find((x) => x.rater === 'good');
  assert.equal(r.anchors, 2);
  assert.equal(good.judged, 3, 'every judgement counts toward judged');
  assert.equal(good.anchorable, 2, 'only anchored subjects count toward accuracy');
  assert.equal(good.accuracy, 1);
  assert.equal(good.belowFloor, false);
});

test('NEGATIVE CONTROL: a rater that is wrong scores below the floor and its misses are directional', () => {
  const r = score([
    anchor('g', 't1', 'false-clean'),
    anchor('g', 't2', 'false-clean'),
    anchor('g', 't3', 'true-alarm'),
    judged('g', 't1', 'true-clean', 'lenient'),   // missed a false-clean
    judged('g', 't2', 'true-clean', 'lenient'),   // missed another
    judged('g', 't3', 'true-alarm', 'lenient'),
  ], { floor: 0.7 });
  const bad = r.raters.find((x) => x.rater === 'lenient');
  assert.equal(bad.anchorable, 3);
  assert.equal(bad.correct, 1);
  assert.ok(bad.accuracy < 0.7);
  assert.equal(bad.belowFloor, true, 'the floor must be able to REFUSE, or it is decoration');
  assert.equal(bad.falseCleanMisses, 2, 'the costly direction is counted on its own');
  assert.equal(bad.confusion['false-clean->true-clean'], 2);
});

test('GREY: a rater with no anchored overlap has accuracy null, never 1.0', () => {
  const r = score([
    anchor('g', 't1', 'true-alarm'),
    judged('g', 't5', 'true-alarm', 'unanchored'),
  ]);
  const s = r.raters.find((x) => x.rater === 'unanchored');
  assert.equal(s.judged, 1);
  assert.equal(s.anchorable, 0);
  assert.equal(s.accuracy, null, 'no overlap is UNKNOWN — a perfect score here would be fabricated');
  assert.equal(s.belowFloor, false, 'and it is not a failure either: explicit uncertainty');
});

test('two raters agreeing with each other and wrong together both score below floor', () => {
  const r = score([
    anchor('g', 't1', 'false-clean'),
    anchor('g', 't2', 'false-clean'),
    judged('g', 't1', 'true-clean', 'a'), judged('g', 't2', 'true-clean', 'a'),
    judged('g', 't1', 'true-clean', 'b'), judged('g', 't2', 'true-clean', 'b'),
  ], { floor: 0.7 });
  const [a, b] = ['a', 'b'].map((n) => r.raters.find((x) => x.rater === n));
  assert.equal(a.accuracy, 0);
  assert.equal(b.accuracy, 0);
  assert.ok(a.belowFloor && b.belowFloor,
    'perfect agreement between two raters is not evidence either is right — the whole reason this exists');
});

test('the subject key is stated once, so a disagreement between writers is visible', () => {
  assert.equal(subjectKey({ gate: 'g', recordAt: 't' }), 'g@t');
  assert.equal(subjectKey({ canary: 'S-MIXED' }), 'canary:S-MIXED');
  assert.equal(subjectKey({}), null, 'a record with no subject cannot be joined and must not be guessed');
});
