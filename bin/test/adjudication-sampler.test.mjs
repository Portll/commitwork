// adjudication-sampler — a rate knows its own denominator, absence never renders as zero, and
// no verdict is ever defaulted into a stratum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  GATE_REGISTRY, STRATA, classifyRecord, stratumOfTruth, wilson, rate, renderRate,
  unobservedUpperBound, stratumCoverage, adjudicationQueue, informationGain, CENSUS_THRESHOLD,
  deliveryReport, validateAdjudication, auditTruthStratum, sourceResponsiveness,
  livenessDeadman, DEADMAN_MISSED_BEATS, composition, compositionOf,
} from '../adjudication-sampler.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLER = join(HERE, '..', 'adjudication-sampler.mjs');
const REAL_VERDICTS = join(HERE, '..', '..', '.claude', 'verdicts');

const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

function fixture(files) {
  const d = mkdtempSync(join(tmpdir(), 'cw-sampler-'));
  for (const [name, rows] of Object.entries(files)) writeFileSync(join(d, name), jsonl(rows));
  return d;
}

// ── THE RATE IS A TYPE ─────────────────────────────────────────────────────────────────────────
// null and 0 are both falsy, so a consumer written `if (rate)` collapses them.
test('a rate with no observable records is not a zero', () => {
  const r = rate(0, 0, '0 of 0 clean records adjudicated');
  assert.equal(r.value, null);
  assert.equal(r.observable, false);
  assert.equal(r.ci95, null);
});

test('a rate with an earned zero is observable and distinguishable from an undefined one', () => {
  const earned = rate(0, 5, '0 false-cleans in 5 clean adjudications');
  const undef = rate(0, 0, '0 of 0 clean records adjudicated');
  assert.equal(earned.observable, true);
  assert.equal(earned.value, 0);
  assert.notEqual(earned.observable, undef.observable);
  assert.ok(!earned.value && !undef.value, 'both values are falsy — observable must carry the distinction');
});

test('renderRate never prints a percentage for an unobservable rate', () => {
  const out = renderRate(rate(0, 0, '0 of 347 clean records adjudicated'), 'false-clean');
  assert.match(out, /undefined/);
  assert.doesNotMatch(out, /0\.0%/, 'an undefined rate must never render as 0.0% — that is the reassuring lie');
  assert.match(out, /347/, 'the denominator must travel with the refusal');
});

test('renderRate carries the denominator and interval on every observable rate', () => {
  const out = renderRate(rate(2, 8, '2 false-cleans in 8 clean adjudications'), 'false-clean');
  assert.match(out, /25\.0%/);
  assert.match(out, /\(2\/8\)/, 'no headline rate ships without its denominator beside it');
  assert.match(out, /\[/, 'an interval must accompany the point estimate');
});

test('a wide interval is labelled uninformative, never suppressed', () => {
  const r = rate(0, 1, '0 of 1');
  assert.equal(r.uninformative, true);
  assert.equal(r.value, 0, 'the estimate is kept — deleting evidence is its own defect');
  assert.match(renderRate(r, 'false-clean'), /uninformative/);
});

// ── WILSON, DETERMINISTIC AND INTEGER-ONLY ─────────────────────────────────────────────────────
test('wilson refuses non-integer or impossible counts rather than returning a plausible interval', () => {
  assert.equal(wilson(1.5, 10), null);
  assert.equal(wilson(0, 0), null);
  assert.equal(wilson(11, 10), null);
  assert.equal(wilson(-1, 10), null);
});

test('wilson is byte-identical across runs (no clock, no RNG)', () => {
  assert.deepEqual(wilson(0, 347), wilson(0, 347));
  const [lo, hi] = wilson(0, 347);
  assert.equal(lo, 0);
  assert.ok(hi > 0 && hi < 0.02, `expected a tight upper bound for 0/347, got ${hi}`);
});

test('rule of three bounds the unobserved rate when zero events were seen', () => {
  assert.equal(unobservedUpperBound(0, 0), 1);
  assert.ok(Math.abs(unobservedUpperBound(0, 12) - 0.25) < 1e-9);
  assert.equal(unobservedUpperBound(1, 12), null, 'the rule of three applies only to zero-event strata');
});

// ── STRATUM DERIVATION ─────────────────────────────────────────────────────────────────────────
test('the observable stratum is derivable from truth alone — no journal join required', () => {
  assert.equal(stratumOfTruth('false-clean'), 'clean');
  assert.equal(stratumOfTruth('true-clean'), 'clean');
  assert.equal(stratumOfTruth('false-alarm'), 'alarm');
  assert.equal(stratumOfTruth('true-alarm'), 'alarm');
  assert.equal(stratumOfTruth('nonsense'), null);
});

// gate-spine keyed on the boolean `block` until 2026-08-29, and this test pinned the identity
// comparison that kept `false` from being swallowed by truthiness. The boolean field is gone —
// clean:[false] put all four of assess()'s grey verdicts in `clean`, 110 records — so the vehicle
// changed. The PROPERTY has not: a falsy value must still be classified by identity, and must not
// match a stratum it is not in. Strata membership itself is covered in gate-spine-strata.test.mjs,
// which drives assess() rather than hardcoding names.
test('falsy verdicts are classified by identity, never by truthiness', () => {
  // No stratum lists these, so each must be unclassified — a truthiness test would take a different
  // branch for at least one of them.
  for (const v of [false, '', 0]) {
    assert.equal(classifyRecord('gate-spine', { verdict: v }).stratum, 'unclassified',
      `verdict ${JSON.stringify(v)} matched a stratum it is not a member of`);
  }
  assert.equal(classifyRecord('gate-spine', {}).stratum, 'unclassified', 'an absent verdict is not a stratum');
  // And the live vocabulary still classifies, so the assertions above are not vacuous.
  assert.equal(classifyRecord('gate-spine', { verdict: 'satisfied' }).stratum, 'clean');
  assert.equal(classifyRecord('gate-spine', { verdict: 'no-spine-record' }).stratum, 'alarm');
  assert.equal(classifyRecord('gate-spine', { verdict: 'sensor-absent' }).stratum, 'neither');
});

test('an unknown verdict is unclassified, never defaulted into a stratum', () => {
  assert.equal(classifyRecord('gate-tests', { verdict: 'something-new' }).stratum, 'unclassified');
  assert.equal(classifyRecord('no-such-gate', { verdict: 'steady' }).stratum, 'unclassified');
});

test('baseline-set is `neither` — the gate arming itself made no clean-or-alarm claim', () => {
  assert.equal(classifyRecord('gate-ratchet', { verdict: 'baseline-set' }).stratum, 'neither');
});

// ── THE DRIFT GUARD ────────────────────────────────────────────────────────────────────────────
// Reads the REAL journals, so a gate emitting a new verdict fails here before it corrupts a denominator.
test('every verdict present in the live journals is classified by GATE_REGISTRY', () => {
  let checked = 0;
  const unknown = [];
  for (const gate of Object.keys(GATE_REGISTRY)) {
    let raw;
    try { raw = readFileSync(join(REAL_VERDICTS, `${gate}.jsonl`), 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      checked++;
      const { stratum, verdict } = classifyRecord(gate, rec);
      if (stratum === 'unclassified') unknown.push(`${gate}/${String(verdict)}`);
    }
  }
  if (!checked) return;   // no live journals in this checkout; the fixture tests still hold
  assert.deepEqual([...new Set(unknown)], [],
    'a verdict seen in a journal but absent from GATE_REGISTRY cannot be put in a denominator — '
    + 'classify it deliberately in GATE_REGISTRY rather than letting it default into a stratum');
});

// ── COVERAGE OVER A DECLARED POPULATION ────────────────────────────────────────────────────────
test('the partition closes: clean + alarm + neither + unclassified === total', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'worse' },
      { at: '2026-08-01T00:00:01.000Z', verdict: 'baseline-set' },
      { at: '2026-08-01T00:00:02.000Z', verdict: 'steady' },
      { at: '2026-08-01T00:00:03.000Z', verdict: 'steady' },
    ],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-ratchet', recordAt: '2026-08-01T00:00:00.000Z', truth: 'true-alarm' },
    ],
  });
  try {
    const c = stratumCoverage({ dir: d });
    const g = c.gates['gate-ratchet'];
    assert.equal(g.arithmeticCloses, true);
    assert.equal(g.strata.clean.population, 2);
    assert.equal(g.strata.alarm.population, 1);
    assert.equal(g.strata.neither.population, 1);
    assert.equal(g.strata.alarm.adjudicated, 1);
    assert.equal(g.strata.clean.adjudicated, 0);
    assert.equal(g.strata.clean.coverage.observable, true, '2 clean records exist, so coverage OF them is measurable');
    assert.equal(g.strata.clean.coverage.value, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a record examined but left without a truth is NOT counted as adjudicated', () => {
  const d = fixture({
    'gate-tests.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'regression-committed' },
      { at: '2026-08-01T00:00:01.000Z', verdict: 'regression-committed' },
    ],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-01T00:00:00.000Z', truth: 'true-alarm' },
      // examined, attribution scored, truth deliberately not assignable
      { kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-01T00:00:01.000Z', attributionCorrect: true, basis: 'the working tree is gone' },
    ],
  });
  try {
    const c = stratumCoverage({ dir: d });
    const alarm = c.gates['gate-tests'].strata.alarm;
    assert.equal(alarm.adjudicated, 1, 'only the record with a real truth counts toward coverage');
    assert.equal(alarm.judgedUndecidable, 1, 'and the unjudgeable one is counted separately, never dropped');
    assert.equal(alarm.coverage.value, 1 / 2);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the undecidable count is reported, not silently discarded — deleting evidence is its own defect', () => {
  const d = fixture({
    'gate-tests.jsonl': [{ at: '2026-08-01T00:00:00.000Z', verdict: 'regression-committed' }],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-01T00:00:00.000Z', attributionCorrect: true },
    ],
  });
  try {
    const r = spawnSync(process.execPath, [SAMPLER], { encoding: 'utf8', env: { ...process.env, CW_VERDICT_DIR: d } });
    assert.match(r.stdout, /UNDECIDABLE/, 'the gap between "looked at" and "known" must stay visible');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// `at` is NOT unique — these gates run as Stop hooks across concurrent sessions, and the live
// journals hold collisions.
test('an adjudication naming an AMBIGUOUS instant is attributed to no stratum, never guessed', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'worse' },     // same instant...
      { at: '2026-08-01T00:00:00.000Z', verdict: 'steady' },    // ...different stratum
      { at: '2026-08-01T00:00:01.000Z', verdict: 'steady' },
    ],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-ratchet', recordAt: '2026-08-01T00:00:00.000Z', truth: 'true-alarm' },
    ],
  });
  try {
    const s = stratumCoverage({ dir: d }).gates['gate-ratchet'].strata;
    assert.equal(s.clean.adjudicated, 0,
      'a true-alarm judgement must NEVER land in the clean stratum — that is the denominator this module exists to fix');
    assert.equal(s.alarm.adjudicated, 0, 'and it must not be guessed into the alarm stratum either');
    assert.equal(s.unclassified.ambiguousRef, 1, 'the ambiguity is counted and reported, not discarded');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('several adjudications of ONE record count once — coverage cannot exceed 100%', () => {
  const d = fixture({
    'gate-tests.jsonl': [{ at: '2026-08-02T00:00:00.000Z', verdict: 'steady' }],
    'adjudications.jsonl': Array.from({ length: 5 }, () => ({
      kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-02T00:00:00.000Z', truth: 'true-clean',
    })),
  });
  try {
    const c = stratumCoverage({ dir: d }).gates['gate-tests'].strata.clean;
    assert.equal(c.adjudicated, 1, 'one record judged five times is one record judged');
    assert.equal(c.coverage.value, 1);
    assert.equal(c.unexamined, 0, 'and the unexamined remainder can never go negative');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// kind:'adjudication-retraction' withdraws a judgement, scoped by `method`.
test('a retracted judgement is not evidence', () => {
  const d = fixture({
    'gate-tests.jsonl': [{ at: '2026-08-02T00:00:00.000Z', verdict: 'steady' }],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-02T00:00:00.000Z', truth: 'true-clean', method: 're-measurement' },
      { kind: 'adjudication-retraction', gate: 'gate-tests', recordAt: '2026-08-02T00:00:00.000Z', method: 're-measurement', reason: 'did not reproduce' },
    ],
  });
  try {
    const c = stratumCoverage({ dir: d }).gates['gate-tests'].strata;
    assert.equal(c.clean.adjudicated, 0, 'a withdrawn claim is not a claim');
    assert.equal(c.unclassified.retractedIgnored, 1, 'and the withdrawal is reported, not silently dropped');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// retractionKey is gate@recordAt@method.
test('a method-scoped retraction leaves an independent judgement of the same record standing', () => {
  const d = fixture({
    'gate-tests.jsonl': [{ at: '2026-08-02T00:00:00.000Z', verdict: 'steady' }],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-02T00:00:00.000Z', truth: 'true-clean', method: 'human' },
      { kind: 'adjudication-retraction', gate: 'gate-tests', recordAt: '2026-08-02T00:00:00.000Z', method: 're-measurement', reason: 'tool defect' },
    ],
  });
  try {
    const c = stratumCoverage({ dir: d }).gates['gate-tests'].strata.clean;
    assert.equal(c.adjudicated, 1, "withdrawing one method's output must not touch another's");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// rate() is the sanctioned constructor — the one place an unrepresentable count can be refused.
test('rate() refuses counts that cannot describe a rate, rather than computing k/n anyway', () => {
  for (const [k, n] of [[1.5, 10], [5, 1], [-1, 10]]) {
    const r = rate(k, n, 'attack');
    assert.equal(r.value, null, `rate(${k},${n}) must not produce a value`);
    assert.equal(r.observable, false);
    assert.equal(r.impossible, true, 'and must say the counts are impossible, not merely absent');
    assert.match(renderRate(r, 'false-clean'), /REFUSED/);
    assert.doesNotMatch(renderRate(r, 'false-clean'), /%/, 'no percentage may be rendered from impossible counts');
  }
});

test('`uninformative` is explicitly false on the unobservable branch, never undefined', () => {
  const r = rate(0, 0, 'nothing to measure');
  assert.equal(r.uninformative, false,
    '`!r.uninformative` on an absent field reads as "informative" — absence rendering as a property');
  assert.equal(r.impossible, false, 'an empty stratum is not a data-integrity fault');
});

test('the delivery report states what it is blind to', () => {
  const d = fixture({
    'gate-tests.jsonl': [
      { at: 'a', verdict: 'steady', fail: 0, pass: 1 },
      { at: 'b', verdict: 'steady', fail: 0, pass: 1, suppressed: true },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const dv = deliveryReport({ dir: d })['gate-tests'];
    assert.match(dv.blindTo, /stuck measurement/);
    assert.match(dv.blindTo, /identical suppression profiles/,
      'a clean delivery report must never be read as evidence a gate is alive');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── S3: A RATE MUST NOT BE A BARE NUMBER ───────────────────────────────────────────────────────
test('every rate-shaped export returns a record with `observable`, never a number', async () => {
  const mod = await import('../adjudication-sampler.mjs');
  // render* excluded BY NAME: a renderer takes a rate record and returns display text
  const rateLike = Object.entries(mod)
    .filter(([k, v]) => typeof v === 'function' && /[Rr]ate$/.test(k) && !/^render/.test(k));
  assert.ok(rateLike.length, 'expected at least one rate-shaped export to check');
  for (const [name, fn] of rateLike) {
    const out = fn(0, 0, 'probe');
    assert.equal(typeof out, 'object', `${name} must return a record, not a ${typeof out}`);
    assert.ok('observable' in out,
      `${name} must carry \`observable\`: null and 0 are both falsy, so a consumer reading the value alone `
      + 'cannot tell "no estimate exists" from "measured zero" — the defect this module exists to close');
    assert.ok('n' in out, `${name} must carry its own denominator — no headline rate ships without one`);
  }
});

// ── SOURCE RESPONSIVENESS: A FILTER, NOT A VERDICT ─────────────────────────────────────────────
test('a source that MOVED while the reading held still is responsive, not suspect', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [
      { at: 'a', verdict: 'steady', headSha: '1'.repeat(40), measured: { source: 's', digest: 'sha256:aaa' } },
      { at: 'b', verdict: 'steady', headSha: '2'.repeat(40), measured: { source: 's', digest: 'sha256:bbb' } },
      { at: 'c', verdict: 'steady', headSha: '3'.repeat(40), measured: { source: 's', digest: 'sha256:ccc' } },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const r = sourceResponsiveness({ dir: d })['gate-ratchet'];
    assert.equal(r.state, 'responsive', 'this is the HEALTHY-STATIC case E3 could not tell from a corpse');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('one digest across several commits is SUSPECT, and the row says it is not a verdict', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [
      { at: 'a', verdict: 'steady', headSha: '1'.repeat(40), measured: { source: 's', digest: 'sha256:same' } },
      { at: 'b', verdict: 'steady', headSha: '2'.repeat(40), measured: { source: 's', digest: 'sha256:same' } },
      { at: 'c', verdict: 'steady', headSha: '3'.repeat(40), measured: { source: 's', digest: 'sha256:same' } },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const r = sourceResponsiveness({ dir: d })['gate-ratchet'];
    assert.equal(r.state, 'suspect');
    assert.match(r.reason, /CANDIDATE for re-derivation, not a verdict/,
      'shipping this as a verdict would install UCA4 permanently');
    assert.match(r.reason, /benign/, 'the innocent explanation must travel with the accusation');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('below the declared window it says it could not look, not that nothing is wrong', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [
      { at: 'a', verdict: 'steady', headSha: '1'.repeat(40), measured: { source: 's', digest: 'sha256:same' } },
      { at: 'b', verdict: 'steady', headSha: '2'.repeat(40), measured: { source: 's', digest: 'sha256:same' } },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const r = sourceResponsiveness({ dir: d })['gate-ratchet'];
    assert.equal(r.state, 'window-too-small');
    assert.notEqual(r.state, 'responsive');
    assert.match(r.reason, /could not look/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a gate recording no provenance is UNRECORDED — unknown, never unchanged', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [{ at: 'a', verdict: 'steady', headSha: '1'.repeat(40) }],
    'adjudications.jsonl': [],
  });
  try {
    const r = sourceResponsiveness({ dir: d })['gate-ratchet'];
    assert.equal(r.state, 'unrecorded');
    assert.match(r.reason, /UNKNOWN — not unchanged/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── TRUTH MUST AGREE WITH THE VERDICT IT JUDGES ────────────────────────────────────────────────
// `truth` implies a stratum; a contradicting truth lands in the wrong denominator silently.
test('a truth that contradicts the record it judges is REFUSED', () => {
  const rec = { at: 'x', verdict: 'worse' };                       // gate-ratchet ALARMED
  const a = { kind: 'adjudication', gate: 'gate-ratchet', recordAt: 'x', truth: 'false-clean' };
  const v = validateAdjudication(a, rec);
  assert.equal(v.ok, false);
  assert.match(v.reason, /CLEAN/);
  assert.match(v.reason, /ALARM/);
  assert.match(v.reason, /correcting either silently/,
    'the refusal must say why it is not auto-corrected — an adjudication is somebody\'s judgement');
});

test('a truth that agrees is accepted', () => {
  assert.equal(validateAdjudication(
    { kind: 'adjudication', gate: 'gate-ratchet', recordAt: 'x', truth: 'true-alarm' },
    { at: 'x', verdict: 'worse' },
  ).ok, true);
  assert.equal(validateAdjudication(
    { kind: 'adjudication', gate: 'gate-ratchet', recordAt: 'x', truth: 'false-clean' },
    { at: 'x', verdict: 'steady' },
  ).ok, true);
});

// Canaries and retrospectives name no live record by design.
test('an adjudication with no live record is not a contradiction', () => {
  const v = validateAdjudication({ kind: 'adjudication', gate: 'gate-ratchet', truth: 'true-alarm', canary: 'R-DRIFT' }, null);
  assert.equal(v.ok, true);
  assert.match(v.reason, /canary, retrospective or unresolvable/);
});

// adjudicate-gates writes attribution-only records (no `truth`) on purpose.
test('an adjudication asserting no truth contradicts nothing', () => {
  assert.equal(validateAdjudication(
    { kind: 'adjudication', gate: 'gate-tests', recordAt: 'x', attributionCorrect: true },
    { at: 'x', verdict: 'steady' },
  ).ok, true);
});

test('a `neither` record cannot support any truth — the gate made no clean-or-alarm claim', () => {
  const v = validateAdjudication(
    { kind: 'adjudication', gate: 'gate-ratchet', recordAt: 'x', truth: 'true-clean' },
    { at: 'x', verdict: 'baseline-set' },
  );
  assert.equal(v.ok, false);
  assert.match(v.reason, /NO clean-or-alarm claim/);
});

test('an unclassified verdict is UNVERIFIABLE, never counted as agreement', () => {
  const v = validateAdjudication(
    { kind: 'adjudication', gate: 'gate-tests', recordAt: 'x', truth: 'true-clean' },
    { at: 'x', verdict: 'a-verdict-nobody-declared' },
  );
  assert.equal(v.ok, true);
  assert.equal(v.unverifiable, true, 'cannot-check must be its own state, not folded into agreed');
  assert.match(v.reason, /UNVERIFIED, not agreed/);
});

test('the corpus audit separates agreed, unverifiable and not-comparable', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'worse' },
      { at: '2026-08-01T00:00:01.000Z', verdict: 'steady' },
    ],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-ratchet', recordAt: '2026-08-01T00:00:00.000Z', truth: 'true-alarm' },
      { kind: 'adjudication', gate: 'gate-ratchet', recordAt: '2026-08-01T00:00:01.000Z', truth: 'true-alarm' },
      { kind: 'adjudication', gate: 'gate-ratchet', recordAt: 'nowhere', truth: 'true-alarm', canary: 'X' },
    ],
  });
  try {
    const r = auditTruthStratum({ dir: d });
    assert.equal(r.checked, 2);
    assert.equal(r.agreed, 1);
    assert.equal(r.contradictions.length, 1, 'a true-alarm against a steady record is a contradiction');
    assert.equal(r.notComparable, 1, 'the canary naming no live record is not comparable, not wrong');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── DELIVERY ───────────────────────────────────────────────────────────────────────────────────
// `suppressed` ≠ undelivered: hook-once silences a repeat of a message already spoken once.
test('a suppressed record whose facts did NOT move is not a delivery failure', () => {
  const d = fixture({
    'gate-tests.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'steady', fail: 0, pass: 100 },
      { at: '2026-08-01T00:00:01.000Z', verdict: 'steady', fail: 0, pass: 100, suppressed: true },
      { at: '2026-08-01T00:00:02.000Z', verdict: 'steady', fail: 0, pass: 100, suppressed: true },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const dv = deliveryReport({ dir: d })['gate-tests'];
    assert.equal(dv.suppressed, 2);
    assert.equal(dv.silencedNewState, 0, 'an identical message correctly not repeated is the design working, not a miss');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a suppressed record whose FACTS MOVED is a miss, and its direction is reported', () => {
  const d = fixture({
    'gate-tests.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'coverage-transient', fail: 0, pass: 1920 },
      // facts moved (alarm -> clean, pass changed) but the message was identical, so it was silenced
      { at: '2026-08-01T00:00:01.000Z', verdict: 'steady', fail: 0, pass: 1927, suppressed: true },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const dv = deliveryReport({ dir: d })['gate-tests'];
    assert.equal(dv.silencedNewState, 1);
    // a silenced recovery and a silenced alarm are different severities — never collapsed
    assert.equal(dv.silencedRecoveries, 1);
    assert.equal(dv.silencedAlarms, 0);
    assert.equal(dv.examples[0].direction, 'silenced-recovery');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a silenced ALARM is counted separately from a silenced recovery', () => {
  const d = fixture({
    'gate-tests.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'steady', fail: 0, pass: 100 },
      { at: '2026-08-01T00:00:01.000Z', verdict: 'regression-committed', fail: 3, pass: 97, suppressed: true },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const dv = deliveryReport({ dir: d })['gate-tests'];
    assert.equal(dv.silencedAlarms, 1, 'an alarm silenced because its sentence matched an earlier one is the severe case');
    assert.equal(dv.silencedRecoveries, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a gate that records no delivery is UNRECORDED, never zero-missed', () => {
  const d = fixture({
    'docs-doctor.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'orange' },
      { at: '2026-08-01T00:00:01.000Z', verdict: 'orange' },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const dv = deliveryReport({ dir: d })['docs-doctor'];
    assert.equal(dv.state, 'unrecorded');
    assert.equal(dv.silencedNewState, undefined, 'no count may be published for a gate that records nothing');
    assert.match(dv.reason, /UNKNOWN — not delivered/);
    assert.equal(dv.alarms, 2, 'the population is still reported, so the size of the unknown is visible');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── ROTATION IS NOT DELETION ───────────────────────────────────────────────────────────────────
// Journals rotate at 2MB to `<name>.jsonl.1`; the reader must follow.
test('a ROTATED adjudications file still counts — rotation must never zero the coverage record', () => {
  const d = fixture({
    'gate-tests.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'steady' },
      { at: '2026-08-01T00:00:01.000Z', verdict: 'steady' },
    ],
    // the live file holds only a canary, exactly as the real one did after rotating
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-tests', recordAt: 'scratch-run', truth: 'true-alarm', canary: 'T-REG' },
    ],
  });
  try {
    // the judgement that matters is in the ROTATED file
    writeFileSync(join(d, 'adjudications.jsonl.1'), jsonl([
      { kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-01T00:00:00.000Z', truth: 'true-clean' },
    ]));
    const c = stratumCoverage({ dir: d }).gates['gate-tests'].strata.clean;
    assert.equal(c.adjudicated, 1, 'the rotated judgement must still count — rotation moved it, it did not delete it');
    assert.equal(c.coverage.value, 1 / 2);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a ROTATED gate journal still counts toward the population', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [{ at: '2026-08-02T00:00:00.000Z', verdict: 'steady' }],
    'adjudications.jsonl': [],
  });
  try {
    writeFileSync(join(d, 'gate-ratchet.jsonl.1'), jsonl([
      { at: '2026-08-01T00:00:00.000Z', verdict: 'steady' },
      { at: '2026-08-01T00:00:01.000Z', verdict: 'worse' },
    ]));
    const g = stratumCoverage({ dir: d }).gates['gate-ratchet'];
    assert.equal(g.records, 3, 'a rotation must not shrink the denominator — that would flatter every rate computed over it');
    assert.equal(g.strata.clean.population, 2);
    assert.equal(g.strata.alarm.population, 1);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The registry is the population — a gate that never wrote must still appear.
test('a registered gate with no journal is absent-not-measured, never 0% and never omitted', () => {
  const d = fixture({ 'gate-tests.jsonl': [{ at: '2026-08-01T00:00:00.000Z', verdict: 'steady' }] });
  try {
    const c = stratumCoverage({ dir: d });
    for (const gate of Object.keys(GATE_REGISTRY)) {
      assert.ok(gate in c.gates, `${gate} must appear even with no journal — absence of evidence is its own state`);
    }
    assert.match(c.gates['gate-ratchet'].state, /^absent-/);
    assert.equal(c.gates['gate-ratchet'].strata, null, 'an absent journal has no strata, not empty ones');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an unreadable journal fails closed rather than reporting an empty population', () => {
  const d = fixture({ 'gate-tests.jsonl': [{ at: '2026-08-01T00:00:00.000Z', verdict: 'steady' }] });
  try {
    writeFileSync(join(d, 'gate-ratchet.jsonl'), '');
    statSync(join(d, 'gate-ratchet.jsonl'));
    // a zero-byte journal is legitimately empty — only ENOENT is absent
    const c = stratumCoverage({ dir: d });
    assert.equal(c.gates['gate-ratchet'].state, 'measured');
    assert.equal(c.gates['gate-ratchet'].records, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('--since reports the population as it stood, so closing a blind spot does not read as a regression', () => {
  const d = fixture({
    'gate-tests.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'steady' },
      { at: '2026-08-09T00:00:00.000Z', verdict: 'steady' },
      { at: '2026-08-10T00:00:00.000Z', verdict: 'steady' },
    ],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-01T00:00:00.000Z', truth: 'true-clean' },
    ],
  });
  try {
    const all = stratumCoverage({ dir: d });
    const since = stratumCoverage({ dir: d, since: '2026-08-09T00:00:00.000Z' });
    assert.equal(all.gates['gate-tests'].strata.clean.population, 3);
    assert.equal(since.gates['gate-tests'].strata.clean.population, 2);
    assert.equal(since.since, '2026-08-09T00:00:00.000Z');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── THE QUEUE ─────────────────────────────────────────────────────────────────────────────────
test('information gain is largest at zero adjudications and decreases monotonically', () => {
  const pop = 300;
  const gains = [0, 1, 2, 5, 12, 20].map((n) => informationGain(n, pop));
  for (let i = 1; i < gains.length; i++) {
    assert.ok(gains[i] < gains[i - 1], `gain must fall as n rises: n=${i} gave ${gains[i]} >= ${gains[i - 1]}`);
  }
  assert.ok(gains[0] > 0, 'an unexamined stratum must have positive gain');
});

test('information gain is zero when there is nothing left to judge', () => {
  assert.equal(informationGain(10, 10), 0);
  assert.equal(informationGain(0, 0), 0);
});

test('the queue ranks an unexamined clean stratum above a well-covered alarm one', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [
      ...Array.from({ length: 300 }, (_, i) => ({ at: `2026-08-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`, verdict: 'steady' })),
      ...Array.from({ length: 30 }, (_, i) => ({ at: `2026-08-02T00:00:${String(i % 60).padStart(2, '0')}.000Z`, verdict: 'worse' })),
    ],
    'adjudications.jsonl': Array.from({ length: 10 }, (_, i) => ({
      kind: 'adjudication', gate: 'gate-ratchet', recordAt: `2026-08-02T00:00:${String(i).padStart(2, '0')}.000Z`, truth: 'true-alarm',
    })),
  });
  try {
    const q = adjudicationQueue({ dir: d });
    const ranked = q.rows.filter((r) => r.gate === 'gate-ratchet' && r.stratum);
    const clean = ranked.findIndex((r) => r.stratum === 'clean');
    const alarm = ranked.findIndex((r) => r.stratum === 'alarm');
    assert.ok(clean < alarm,
      'the unexamined clean stratum must outrank the covered alarm one — oldest-first is the lazy sort, '
      + 'and the alarm stratum is where all the attention has already gone');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a stratum at or below the census threshold is adjudicated in full, not sampled', () => {
  const d = fixture({
    'gate-ratchet.jsonl': [
      { at: '2026-08-01T00:00:00.000Z', verdict: 'baseline-set' },
      ...Array.from({ length: 50 }, (_, i) => ({ at: `2026-08-01T00:01:${String(i % 60).padStart(2, '0')}.000Z`, verdict: 'steady' })),
    ],
  });
  try {
    const q = adjudicationQueue({ dir: d });
    const neither = q.rows.find((r) => r.gate === 'gate-ratchet' && r.stratum === 'neither');
    assert.equal(neither.kind, 'census');
    assert.equal(neither.priority, Infinity);
    assert.ok(neither.population <= CENSUS_THRESHOLD);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the queue is deterministic — identical journals give byte-identical output', () => {
  const rows = { 'gate-tests.jsonl': [{ at: '2026-08-01T00:00:00.000Z', verdict: 'steady' }] };
  const a = fixture(rows);
  const b = fixture(rows);
  try {
    assert.equal(JSON.stringify(adjudicationQueue({ dir: a })), JSON.stringify(adjudicationQueue({ dir: b })));
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

// ── PROPOSALS ONLY ────────────────────────────────────────────────────────────────────────────
test('running the sampler mutates nothing on disk', () => {
  const d = fixture({
    'gate-tests.jsonl': [{ at: '2026-08-01T00:00:00.000Z', verdict: 'steady' }],
    'adjudications.jsonl': [{ kind: 'adjudication', gate: 'gate-tests', recordAt: '2026-08-01T00:00:00.000Z', truth: 'true-clean' }],
  });
  const snap = () => readdirSync(d).sort().map((f) => `${f}:${readFileSync(join(d, f), 'utf8')}`).join('\0');
  try {
    const before = snap();
    for (const args of [[], ['--json']]) {
      const r = spawnSync(process.execPath, [SAMPLER, ...args], {
        encoding: 'utf8', env: { ...process.env, CW_VERDICT_DIR: d },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.length > 0);
    }
    assert.equal(snap(), before, 'the sampler proposes; it must never write');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('CW_VERDICT_DIR is read at call time, not at module load', () => {
  const d = fixture({ 'gate-tests.jsonl': [{ at: '2026-08-01T00:00:00.000Z', verdict: 'steady' }] });
  const before = process.env.CW_VERDICT_DIR;
  try {
    process.env.CW_VERDICT_DIR = d;
    const c = stratumCoverage();
    assert.equal(c.gates['gate-tests'].records, 1,
      'the seam must be read when stratumCoverage runs — a const at import defeats every override '
      + 'set afterwards, and the test passes while proving nothing');
  } finally {
    if (before === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = before;
    rmSync(d, { recursive: true, force: true });
  }
});

test('STRATA covers exactly the classifications classifyRecord can return', () => {
  assert.deepEqual([...STRATA].sort(), ['alarm', 'clean', 'neither', 'unclassified']);
});

// ── THE DEADMAN'S OWN PULSE ────────────────────────────────────────────────────────────────────
// explicit uncertainty (no schedule ≠ healthy), only ENOENT is absence, the reader follows rotation.

const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const PLIST_WITH = (interval) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>t</string>\n  <key>StartInterval</key><integer>${interval}</integer>\n</dict>\n</plist>\n`;

function plistFixture(text) {
  const d = mkdtempSync(join(tmpdir(), 'cw-deadman-'));
  const p = join(d, 'liveness.plist');
  writeFileSync(p, text);
  return p;
}

test('deadman: a pulse within the threshold beats', () => {
  const dir = fixture({ 'liveness.jsonl': [{ gate: 'liveness', at: '2026-08-20T11:30:00.000Z', verdict: 'fresh' }] });
  const plistPath = plistFixture(PLIST_WITH(3600));
  const dm = livenessDeadman({ dir, plistPath, now: NOW });
  assert.equal(dm.state, 'beating');
  assert.equal(dm.ageSeconds, 1800);
  assert.equal(dm.intervalSeconds, 3600);
});

test('deadman: age exactly at the threshold still beats — flatline requires MORE than N beats', () => {
  const dir = fixture({ 'liveness.jsonl': [{ gate: 'liveness', at: '2026-08-20T10:00:00.000Z', verdict: 'fresh' }] });
  const dm = livenessDeadman({ dir, plistPath: plistFixture(PLIST_WITH(3600)), now: NOW });
  assert.equal(dm.ageSeconds, DEADMAN_MISSED_BEATS * 3600);
  assert.equal(dm.state, 'beating');
});

test('deadman: a pulse older than N beats flatlines, and the reason carries the numbers', () => {
  const dir = fixture({ 'liveness.jsonl': [{ gate: 'liveness', at: '2026-08-20T08:00:00.000Z', verdict: 'fresh' }] });
  const dm = livenessDeadman({ dir, plistPath: plistFixture(PLIST_WITH(3600)), now: NOW });
  assert.equal(dm.state, 'flatlined');
  assert.equal(dm.ageSeconds, 14400);
  assert.match(dm.reason, /14400s/);
  assert.match(dm.reason, /3600s/);
});

test('deadman: missing plist is cadence-unknown, never beating — no schedule means "late" is undefinable', () => {
  const dir = fixture({ 'liveness.jsonl': [{ gate: 'liveness', at: '2026-08-20T11:59:00.000Z', verdict: 'fresh' }] });
  const dm = livenessDeadman({ dir, plistPath: join(tmpdir(), 'cw-deadman-nope', 'absent.plist'), now: NOW });
  assert.equal(dm.state, 'cadence-unknown');
  assert.notEqual(dm.state, 'beating');
  assert.equal(dm.newestAt, '2026-08-20T11:59:00.000Z');   // the age is still reported; only the verdict is withheld
});

test('deadman: a plist without a positive StartInterval is cadence-unreadable, distinct from absent', () => {
  const dir = fixture({ 'liveness.jsonl': [{ gate: 'liveness', at: '2026-08-20T11:59:00.000Z', verdict: 'fresh' }] });
  const dm = livenessDeadman({ dir, plistPath: plistFixture('<plist version="1.0"><dict><key>Label</key><string>t</string></dict></plist>'), now: NOW });
  assert.equal(dm.state, 'cadence-unreadable');
});

test('deadman: no journal at all is its own state — unknown, not healthy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-deadman-empty-'));
  const dm = livenessDeadman({ dir, plistPath: plistFixture(PLIST_WITH(3600)), now: NOW });
  assert.equal(dm.state, 'no-journal');
});

test('deadman: records with no parseable `at` are unmeasurable, never fresh', () => {
  const dir = fixture({ 'liveness.jsonl': [{ gate: 'liveness', verdict: 'fresh' }, { gate: 'liveness', at: 'not-a-time', verdict: 'fresh' }] });
  const dm = livenessDeadman({ dir, plistPath: plistFixture(PLIST_WITH(3600)), now: NOW });
  assert.equal(dm.state, 'no-usable-timestamp');
});

test('deadman: the reader follows rotation — a pulse only in .jsonl.1 is still a pulse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-deadman-rot-'));
  writeFileSync(join(dir, 'liveness.jsonl.1'), `${JSON.stringify({ gate: 'liveness', at: '2026-08-20T11:30:00.000Z', verdict: 'fresh' })}\n`);
  const dm = livenessDeadman({ dir, plistPath: plistFixture(PLIST_WITH(3600)), now: NOW });
  assert.equal(dm.state, 'beating');
  assert.equal(dm.newestAt, '2026-08-20T11:30:00.000Z');
});

// Pins pre-publish's verdict→stratum mapping in GATE_REGISTRY.
test('pre-publish: every verdict verdictFor() can emit lands in a declared stratum', () => {
  const expected = {
    clean: 'clean',
    'clean-reviewed': 'clean',            // the gate PERMITTED publication on reviewed rows
    'clean-with-unscanned': 'clean',      // older records only
    'blocked-secret': 'alarm',
    'blocked-context': 'alarm',
    'cannot-check': 'neither',            // declined to judge, fail-closed — not a verdict
    'unreviewed-unscanned': 'neither',    // a blob nobody read or reviewed — incomplete, not a finding
  };
  for (const [verdict, stratum] of Object.entries(expected)) {
    assert.equal(classifyRecord('pre-publish', { verdict }).stratum, stratum, verdict);
  }
  assert.equal(classifyRecord('pre-publish', { verdict: 'published' }).stratum, 'unclassified',
    'an unknown verdict is never defaulted into a stratum');
});

test('deadman: CW_LIVENESS_PLIST is read at call time, not module load', () => {
  const dir = fixture({ 'liveness.jsonl': [{ gate: 'liveness', at: '2026-08-20T11:30:00.000Z', verdict: 'fresh' }] });
  const p = plistFixture(PLIST_WITH(1800));
  process.env.CW_LIVENESS_PLIST = p;
  try {
    const dm = livenessDeadman({ dir, now: NOW });
    assert.equal(dm.intervalSeconds, 1800);
  } finally {
    delete process.env.CW_LIVENESS_PLIST;
  }
});

// ── P5/E5: THE DEGRADED JOURNAL BUYS THE TIGHTER INTERVAL ──────────────────────────────────────
// Composition is REPORTED beside every interval, never a weighting — weighting would make the
// interval a function of distribution shape, the axis a degraded gate distorts.

const secondsAt = (i) => new Date(Date.parse('2026-08-01T00:00:00.000Z') + i * 1000).toISOString();

// liveness `degraded` fires by construction, so it swamps the alarm stratum.
const degradedFiles = () => ({
  'liveness.jsonl': [
    ...Array.from({ length: 4 }, (_, i) => ({ at: secondsAt(i), verdict: 'fresh' })),
    ...Array.from({ length: 196 }, (_, i) => ({ at: secondsAt(100 + i), verdict: 'degraded' })),
  ],
  'adjudications.jsonl': Array.from({ length: 3 }, (_, i) => ({
    kind: 'adjudication', gate: 'liveness', recordAt: secondsAt(100 + i), truth: 'false-alarm',
  })),
});
const degradedFixture = () => fixture(degradedFiles());

// Pinned literals captured BEFORE composition landed — a recomputation would move with the code
// under watch.
const PRE_CHANGE_CI95 = {
  alarm_3_of_196: [0.005218785274458761, 0.04402821835241372],
  clean_0_of_4: [0, 0.48990002040399916],
  clean_2_of_10: [0.056680947980693314, 0.5098431532792765],
};

test('the interval is byte-identical to its pre-composition value — no weighting crept in', () => {
  const d = degradedFixture();
  try {
    const s = stratumCoverage({ dir: d }).gates.liveness.strata;
    assert.deepEqual(s.alarm.coverage.ci95, PRE_CHANGE_CI95.alarm_3_of_196);
    assert.deepEqual(s.clean.coverage.ci95, PRE_CHANGE_CI95.clean_0_of_4);
    // And it is still exactly what wilson says about (k, n) alone, with nothing else mixed in.
    assert.deepEqual(s.alarm.coverage.ci95, wilson(s.alarm.coverage.k, s.alarm.coverage.n));
    assert.deepEqual(s.clean.coverage.ci95, wilson(s.clean.coverage.k, s.clean.coverage.n));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The interval must not move when only the population's shape moves.
test('the same (k,n) under opposite compositions gives the identical interval', () => {
  const build = (alarms) => fixture({
    'gate-ratchet.jsonl': [
      ...Array.from({ length: 10 }, (_, i) => ({ at: secondsAt(i), verdict: 'steady' })),
      ...Array.from({ length: alarms }, (_, i) => ({ at: secondsAt(1000 + i), verdict: 'worse' })),
    ],
    'adjudications.jsonl': [
      { kind: 'adjudication', gate: 'gate-ratchet', recordAt: secondsAt(0), truth: 'true-clean' },
      { kind: 'adjudication', gate: 'gate-ratchet', recordAt: secondsAt(1), truth: 'true-clean' },
    ],
  });
  const balanced = build(10);
  const lopsided = build(490);
  try {
    const b = stratumCoverage({ dir: balanced }).gates['gate-ratchet'].strata.clean.coverage;
    const l = stratumCoverage({ dir: lopsided }).gates['gate-ratchet'].strata.clean.coverage;
    assert.equal(b.n, l.n, 'the clean stratum is the same size in both — only the rest of the population differs');
    assert.deepEqual(b.ci95, l.ci95,
      'the interval must be a function of (k, n) and nothing else — weighting it on stratum balance '
      + 'makes it a function of distribution shape, the exact axis a dead gate distorts');
    assert.deepEqual(b.ci95, PRE_CHANGE_CI95.clean_2_of_10);
    // What DOES differ is the composition, which is the entire point: the reader can now see it.
    assert.notDeepEqual(b.composition.counts, l.composition.counts);
    assert.equal(b.composition.dominant.stratum, 'clean');
    assert.equal(l.composition.dominant.stratum, 'alarm');
  } finally {
    rmSync(balanced, { recursive: true, force: true });
    rmSync(lopsided, { recursive: true, force: true });
  }
});

test('the degraded journal wears its lopsidedness in the composition beside the tight interval', () => {
  const d = degradedFixture();
  try {
    const g = stratumCoverage({ dir: d }).gates.liveness;
    const alarm = g.strata.alarm.coverage;
    const clean = g.strata.clean.coverage;
    // The trap, reproduced: the stratum that swallowed the population has the TIGHTER interval.
    const width = (r) => r.ci95[1] - r.ci95[0];
    assert.ok(width(alarm) < width(clean) / 10,
      'the degraded stratum must be the tight one — if this stops holding the fixture no longer '
      + 'reproduces the defect and the rest of this test proves nothing');
    // And the tightness is explained on the payload rather than left to be inferred.
    assert.equal(alarm.composition.total, 200);
    assert.equal(alarm.composition.counts.alarm, 196);
    assert.equal(alarm.composition.counts.clean, 4);
    assert.equal(alarm.composition.dominant.stratum, 'alarm');
    assert.ok(alarm.composition.dominant.share > 0.97, 'the dominant share is the lopsidedness, stated as a number');
    assert.match(alarm.composition.label, /clean 4\/200, alarm 196\/200/);
    assert.equal(g.composition.total, 200, 'and the gate summary states it too, for a reader who never opens a stratum');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// Structural: anything in the payload carrying a ci95 must carry the composition it came from.
test('every interval in the JSON payload carries the composition it was drawn from', () => {
  // Two gates, five strata between them, so the sweep has more than one shape to walk.
  const d = fixture({
    ...degradedFiles(),
    'gate-ratchet.jsonl': [
      ...Array.from({ length: 20 }, (_, i) => ({ at: secondsAt(2000 + i), verdict: 'steady' })),
      ...Array.from({ length: 6 }, (_, i) => ({ at: secondsAt(3000 + i), verdict: 'worse' })),
      { at: secondsAt(4000), verdict: 'baseline-set' },
    ],
  });
  try {
    const r = spawnSync(process.execPath, [SAMPLER, '--json'], {
      encoding: 'utf8', env: { ...process.env, CW_VERDICT_DIR: d },
    });
    assert.equal(r.status, 0, r.stderr);
    const found = [];
    (function walk(node, path) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
      if (Array.isArray(node.ci95) && node.ci95.length === 2) found.push([path, node]);
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }(JSON.parse(r.stdout), '$'));
    assert.ok(found.length >= 3, `expected several intervals in the payload, found ${found.length}`);
    for (const [path, node] of found) {
      assert.ok(node.composition, `${path} publishes an interval with no composition beside it`);
      assert.ok(node.composition.total > 0, `${path} publishes an interval over an empty composition`);
      assert.equal(typeof node.composition.label, 'string');
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('every printed interval carries its composition on the same line', () => {
  const d = degradedFixture();
  try {
    const r = spawnSync(process.execPath, [SAMPLER], { encoding: 'utf8', env: { ...process.env, CW_VERDICT_DIR: d } });
    assert.equal(r.status, 0, r.stderr);
    const withInterval = r.stdout.split('\n').filter((l) => /\[\d+\.\d%, \d+\.\d%\]/.test(l));
    assert.ok(withInterval.length >= 2, `expected printed intervals, found ${withInterval.length}`);
    for (const line of withInterval) {
      assert.match(line, /\[\d+\.\d%, \d+\.\d%\] · population: /,
        `a printed interval with no composition beside it: ${line}`);
    }
    assert.ok(withInterval.some((l) => /population: clean 4\/200, alarm 196\/200/.test(l)),
      'the lopsided population must be legible to a human reading the report, not only to a JSON consumer');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an interval with no composition supplied says so, rather than reading as balanced', () => {
  const out = renderRate(rate(3, 196, '3 of 196 suppressed records had facts that moved'), 'coverage');
  assert.match(out, /NOT SUPPLIED/);
  assert.doesNotMatch(out, /population: clean/);
  const withComp = renderRate(rate(3, 196, '3 of 196', composition({ clean: 4, alarm: 196 })), 'coverage');
  assert.match(withComp, /population: clean 4\/200, alarm 196\/200/);
  assert.doesNotMatch(withComp, /NOT SUPPLIED/);
});

test('composition counts every stratum, and an empty population has null shares rather than zero ones', () => {
  const c = composition({ clean: 4, alarm: 196 });
  assert.deepEqual(c.counts, { clean: 4, alarm: 196, neither: 0, unclassified: 0 });
  assert.equal(c.shares.neither, 0, 'a measured zero is a zero');
  const empty = composition({});
  assert.equal(empty.total, 0);
  assert.equal(empty.shares.clean, null, 'a share of a population that does not exist is not a share of zero');
  assert.equal(empty.dominant, null);
  assert.equal(empty.label, 'no records');
});

test('compositionOf classifies through GATE_REGISTRY, so an unknown verdict is visible as unclassified', () => {
  const c = compositionOf('gate-ratchet', [
    { verdict: 'steady' }, { verdict: 'worse' }, { verdict: 'baseline-set' }, { verdict: 'a-verdict-nobody-declared' },
  ]);
  assert.deepEqual(c.counts, { clean: 1, alarm: 1, neither: 1, unclassified: 1 });
  assert.match(c.label, /unclassified 1\/4/);
});

// The delivery rate draws from the same distorted journal, so it carries composition too.
test('the delivery rate publishes composition beside its interval', () => {
  const d = fixture({
    'gate-tests.jsonl': [
      { at: secondsAt(0), verdict: 'steady', fail: 0, pass: 100 },
      { at: secondsAt(1), verdict: 'steady', fail: 0, pass: 100, suppressed: true },
      { at: secondsAt(2), verdict: 'regression-committed', fail: 3, pass: 97, suppressed: true },
    ],
    'adjudications.jsonl': [],
  });
  try {
    const dv = deliveryReport({ dir: d })['gate-tests'];
    assert.ok(dv.rate.ci95, 'this surface publishes an interval');
    assert.equal(dv.rate.composition.total, 3);
    assert.deepEqual(dv.rate.composition.counts, { clean: 2, alarm: 1, neither: 0, unclassified: 0 });
    assert.deepEqual(dv.rate.ci95, wilson(dv.rate.k, dv.rate.n), 'and its interval is (k, n) alone');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The identity comparison at classifyRecord's core exists so a FALSY verdict is matched rather than
// swallowed. gate-spine was its only live exercise until its boolean `block` field was replaced by
// string verdicts (2026-08-29); after that, replacing `x === v` with a truthy guard passed all 76
// tests. This is the witness that property no longer has anywhere else.
test('a falsy verdict that IS a stratum member classifies — identity, not truthiness', () => {
  const registry = {
    'fixture-gate': { verdictField: 'v', clean: [false, 0], alarm: [true], neither: [''] },
  };
  assert.equal(classifyRecord('fixture-gate', { v: false }, { registry }).stratum, 'clean');
  assert.equal(classifyRecord('fixture-gate', { v: 0 }, { registry }).stratum, 'clean');
  assert.equal(classifyRecord('fixture-gate', { v: '' }, { registry }).stratum, 'neither');
  assert.equal(classifyRecord('fixture-gate', { v: true }, { registry }).stratum, 'alarm');
  // and a non-member is still unclassified, so the above is not passing by blanket acceptance
  assert.equal(classifyRecord('fixture-gate', { v: 'nope' }, { registry }).stratum, 'unclassified');
  // null/undefined remain absent, never a stratum
  assert.equal(classifyRecord('fixture-gate', { v: null }, { registry }).stratum, 'unclassified');
  assert.equal(classifyRecord('fixture-gate', {}, { registry }).stratum, 'unclassified');
});
