// verdict-journal — journal, rotate, fail open on write, fail closed on read, redact for the
// tunnel. Every path runs on fixtures via the CW_* seams, read at call time.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  appendRecord, journal, readJournal, readJournalFile, journalHealth, redactGateRecord, computeMetrics, dedupeJudgements, readAdjudications, raterReliability, abstentionsByRater, cohortId, GATE_ROSTER,
  anchorJournals, verifyAnchors, adjudicationsPath, buildFindingKey, findingKeyForScanner,
  findingKeyForDependency, redactLedgerFields, appendFindingAdjudication, FORBIDDEN_IDENTITY_COMPONENTS,
  bornSliceAt, computeFindingCalibration, bankedRatesFrom, compareCalibrationToBaseline,
  calibrateBaselinePath, readCalibrateBaseline, writeCalibrateBaseline, UNMODELED_LABEL,
  anchorDataStore, retireDataAnchor, verifyDataAnchors, dataAnchorsPath, fatigueReport, verifyJudgementArchive,
} from '../lib/verdict-journal-core.mjs';

const IMPORT_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'adjudication-import.mjs');

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vj-'));
  process.env.CW_VERDICT_DIR = join(dir, 'verdicts');
  process.env.CW_VERDICT_ANCHORS = join(dir, 'off-tree', 'anchors.jsonl');
  process.env.CW_DATA_ANCHORS = join(dir, 'off-tree', 'data-anchors.jsonl');
  process.env.CW_CALIBRATE_BASELINE = join(dir, 'off-tree', 'calibrate-baseline.json');
  process.env.CW_NOW = '2026-08-10T00:00:00.000Z';
  delete process.env.CW_VERDICT_MAX_BYTES;
});
afterEach(() => {
  delete process.env.CW_VERDICT_DIR;
  delete process.env.CW_VERDICT_ANCHORS;
  delete process.env.CW_DATA_ANCHORS;
  delete process.env.CW_CALIBRATE_BASELINE;
  delete process.env.CW_NOW;
  delete process.env.CW_VERDICT_MAX_BYTES;
  rmSync(dir, { recursive: true, force: true });
});

test('journal writes the envelope, honours CW_NOW and CW_VERDICT_DIR set AFTER import', () => {
  const r = journal('gate-tests', { verdict: 'steady', exit: 0, fail: 1 });
  assert.equal(r.ok, true);
  const lines = readFileSync(join(dir, 'verdicts', 'gate-tests.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.v, 1);
  assert.equal(rec.gate, 'gate-tests');
  assert.equal(rec.at, '2026-08-10T00:00:00.000Z'); // CW_NOW, not wall clock
  assert.equal(rec.pid, process.pid);
  assert.equal(rec.session, null); // caller-supplied, honestly null when absent
  assert.equal(rec.verdict, 'steady');
});

test('session is caller-supplied and carried', () => {
  journal('gate-tests', { verdict: 'armed' }, { session: 'abcd1234' });
  const { records } = readJournal('gate-tests');
  assert.equal(records[0].session, 'abcd1234');
});

test('appendRecord rotates at maxBytes to .1 (touch-ledger idiom), then keeps appending', () => {
  const p = join(dir, 'out', 'sweep-journal.jsonl');
  const fat = { v: 1, pad: 'x'.repeat(200) };
  appendRecord(p, fat, { maxBytes: 100 });         // first write: file empty, no rotation
  appendRecord(p, { v: 1, n: 2 }, { maxBytes: 100 }); // over threshold now → rotates first
  assert.ok(existsSync(`${p}.1`), 'oversized journal rotated to .1');
  const kept = readJournalFile(p);
  assert.equal(kept.records.length, 1);
  assert.equal(kept.records[0].n, 2);
  const archived = readJournalFile(`${p}.1`);
  assert.equal(archived.records[0].pad.length, 200);
});

test('CW_VERDICT_MAX_BYTES is read at call time', () => {
  journal('g', { pad: 'x'.repeat(120) });
  process.env.CW_VERDICT_MAX_BYTES = '50'; // set AFTER the first write
  journal('g', { n: 2 });
  assert.ok(existsSync(join(dir, 'verdicts', 'g.jsonl.1')));
});

test('appendRecord never throws — unwritable path returns ok:false with the code', () => {
  const block = join(dir, 'blocker');
  writeFileSync(block, 'a file where a directory must go');
  const r = appendRecord(join(block, 'x', 'j.jsonl'), { v: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.error, 'error code carried for the caller to surface');
});

test('readJournal: ENOENT is absent (its own state), torn lines are COUNTED never dropped', () => {
  // Shape pinned, not loosened: readJournal now returns the strong verifier's fields too. `absent`
  // with examined:0 is the point — a store nobody read must not be shaped like a clean one.
  assert.deepEqual(readJournal('never-written'), {
    absent: true, records: [], torn: 0, rotations: 0, state: 'absent',
    chain: { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 0 },
    breaks: [], renumberings: [], gaps: [],
  });
  const p = join(dir, 'verdicts', 'torn.jsonl');
  mkdirSync(join(dir, 'verdicts'), { recursive: true });
  writeFileSync(p, `${JSON.stringify({ v: 1, ok: 1 })}\n{half a rec\n${JSON.stringify({ v: 1, ok: 2 })}\n`);
  const j = readJournal('torn');
  assert.equal(j.records.length, 2);
  assert.equal(j.torn, 1);
});

test('readJournal: a non-ENOENT read error THROWS — unreadable never reads as empty', () => {
  const p = join(dir, 'verdicts', 'locked.jsonl');
  mkdirSync(join(dir, 'verdicts'), { recursive: true });
  writeFileSync(p, '{}\n');
  const _deny = denyRead(p);

  assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
  try {
    assert.throws(() => readJournal('locked'));
  } finally {
    _deny.restore();
  }
});

test('journalHealth: ok / absent-not-running / stale-baseline-moved / bootstrap safety', () => {
  const baseline = join(dir, 'gate-baseline.json');
  const roster = [{ gate: 'g1', baseline }];

  // bootstrap: baseline exists from the pre-journal era, journal absent → NOT an alarm (C18)
  writeFileSync(baseline, JSON.stringify({ fail: 1, at: '2026-08-09T00:00:00Z' }));
  let [h] = journalHealth({ roster });
  assert.equal(h.state, 'absent-not-running');

  // gate journals once → ok
  journal('g1', { verdict: 'steady' }); // at = CW_NOW = 2026-08-10T00:00:00.000Z
  [h] = journalHealth({ roster });
  assert.equal(h.state, 'ok');
  assert.equal(h.lastVerdict, 'steady');

  // baseline moves AFTER the last record → the J3 window, detected
  writeFileSync(baseline, JSON.stringify({ fail: 2, at: '2026-08-10T01:00:00Z' }));
  [h] = journalHealth({ roster });
  assert.equal(h.state, 'stale-baseline-moved');
  assert.equal(h.baselineAt, '2026-08-10T01:00:00Z');
});

test('journalHealth: unreadable journal is an alarm state, not an absence', () => {
  const p = join(dir, 'verdicts', 'g2.jsonl');
  mkdirSync(join(dir, 'verdicts'), { recursive: true });
  writeFileSync(p, '{}\n');
  const _deny = denyRead(p);

  assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
  try {
    const [h] = journalHealth({ roster: [{ gate: 'g2', baseline: null }] });
    assert.equal(h.state, 'unreadable');
  } finally {
    _deny.restore();
  }
});

test('redactGateRecord: allowlist only — no headlines, names, files or session labels survive', () => {
  const full = {
    v: 1, gate: 'gate-tests', at: 't', pid: 123, session: 'abcd1234',
    verdict: 'regression-uncommitted', exit: 2, fail: 3, pass: 1400,
    baseline: { fail: 1, pass: 1401, at: 'b' },
    headline: 'commitwork tests: 3 failing — waiting on Sonnet (fixing auth)',
    names: ['admin test one', 'bin test two'],
    committed: ['x'], uncommitted: ['y'],
    attribution: { mine: ['a.mjs'], theirs: ['b.mjs', 'c.mjs'], unknown: [], others: ['9f3a2b1c'] },
    suppressed: true, silenced: 4,
  };
  const red = redactGateRecord(full);
  assert.equal(red.verdict, 'regression-uncommitted');
  assert.deepEqual(red.attribution, { mine: 1, theirs: 2, unknown: 0 }); // counts, never names
  assert.deepEqual(red.baseline, { fail: 1, pass: 1401, at: 'b' });
  for (const leaky of ['headline', 'names', 'committed', 'uncommitted', 'pid']) {
    assert.equal(red[leaky], undefined, `${leaky} must not survive redaction`);
  }
  assert.equal(red.session, undefined, 'session labels stay off the tunnel');
  assert.equal(JSON.stringify(red).includes('.mjs'), false, 'no filename leaks through any field');
});

test('disjoint keys, deterministic bytes — two writers, two files, byte-exact independence', () => {
  journal('alpha', { verdict: 'steady', exit: 0 });
  journal('beta', { verdict: 'worse', exit: 2 });
  journal('alpha', { verdict: 'worse', exit: 2 });
  const a = readFileSync(join(dir, 'verdicts', 'alpha.jsonl'), 'utf8');
  const b = readFileSync(join(dir, 'verdicts', 'beta.jsonl'), 'utf8');
  const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
  const mk = (gate, record, prev) => `${JSON.stringify({ v: 1, gate, at: '2026-08-10T00:00:00.000Z', pid: process.pid, session: null, ...record, prev })}\n`;
  const a1 = mk('alpha', { verdict: 'steady', exit: 0 }, 'genesis');
  const a2 = mk('alpha', { verdict: 'worse', exit: 2 }, hash(a1.trimEnd()));
  assert.equal(a, a1 + a2, 'the chain links each record to the exact previous line');
  assert.equal(b, mk('beta', { verdict: 'worse', exit: 2 }, 'genesis'));
});

test('tamper evidence: an edited interior line breaks the chain; overlap reads as raced, not broken', () => {
  journal('t', { verdict: 'a' });
  journal('t', { verdict: 'b' });
  journal('t', { verdict: 'c' });
  const p = join(dir, 'verdicts', 't.jsonl');
  assert.deepEqual(readJournal('t').chain, {
    verified: 3, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 3,
  });

  // adversary edits the middle record in place — every subsequent link snaps
  const lines = readFileSync(p, 'utf8').trim().split('\n');
  const doctored = JSON.parse(lines[1]);
  doctored.verdict = 'steady'; // the classic: rewrite a bad verdict to a clean one
  writeFileSync(p, [lines[0], JSON.stringify(doctored), lines[2]].join('\n') + '\n');
  const after = readJournal('t');
  assert.ok(after.chain.broken >= 1, 'the edit is visible in the chain');

  // a same-key overlap: two writers computed prev from the same snapshot — earlier-seen, not unknown
  journal('r', { verdict: 'a' });
  const rp = join(dir, 'verdicts', 'r.jsonl');
  const first = readFileSync(rp, 'utf8').trim();
  journal('r', { verdict: 'b' });
  const overlap = { v: 1, gate: 'r', at: 'x', pid: 1, session: null, verdict: 'c', prev: createHash('sha256').update(first).digest('hex').slice(0, 32) };
  writeFileSync(rp, readFileSync(rp, 'utf8') + JSON.stringify(overlap) + '\n');
  const r = readJournal('r');
  assert.equal(r.chain.raced, 1, 'a prev matching an EARLIER line is an overlap, not an edit');
  assert.equal(r.chain.broken, 0);
});

test('a mid-file genesis is truncate-and-restart — broken, never a fresh start', () => {
  journal('g', { verdict: 'a' });
  const p = join(dir, 'verdicts', 'g.jsonl');
  const restart = { v: 1, gate: 'g', at: 'x', pid: 1, session: null, verdict: 'clean', prev: 'genesis' };
  writeFileSync(p, readFileSync(p, 'utf8') + JSON.stringify(restart) + '\n');
  assert.equal(readJournal('g').chain.broken, 1);
});

test('CW_VERDICT_PIN=1 pins retention — no rotation however large the file grows', () => {
  process.env.CW_VERDICT_PIN = '1';
  try {
    journal('pin', { pad: 'x'.repeat(200) });
    process.env.CW_VERDICT_MAX_BYTES = '50';
    journal('pin', { n: 2 });
    assert.equal(existsSync(join(dir, 'verdicts', 'pin.jsonl.1')), false, 'pinned: the eval window cannot shrink');
    assert.equal(readJournal('pin').records.length, 2);
  } finally {
    delete process.env.CW_VERDICT_PIN;
  }
});

test('computeMetrics: deterministic, and the unadjudicated are counted, never laundered into a rate', () => {
  const adj = [
    { kind: 'adjudication', gate: 'gate-tests', truth: 'true-alarm', attributionCorrect: true },
    { kind: 'adjudication', gate: 'gate-tests', truth: 'true-alarm', attributionCorrect: false },
    { kind: 'adjudication', gate: 'gate-tests', truth: 'false-clean' },
    { kind: 'adjudication', gate: 'gate-tests', truth: 'true-clean' },
    { kind: 'adjudication', gate: 'gate-tests', truth: 'false-alarm', attributionCorrect: true },
    { kind: 'adjudication', gate: 'gate-tests', truth: 'not-a-truth' },  // invalid — ignored, not guessed
    { kind: 'something-else', gate: 'gate-tests', truth: 'true-alarm' }, // wrong kind — ignored
  ];
  const m = computeMetrics(adj, { 'gate-tests': 20 });
  const g = m['gate-tests'];
  assert.equal(g.adjudicated, 5);
  assert.equal(g.catchRate, 2 / 3, 'catch = true-alarm / (true-alarm + false-clean)');
  // each false-rate divides by the records that COULD have exhibited it
  assert.equal(g.falseCleanRate, 1 / 2, 'false-clean is observable only where the gate said clean: 1 of 2');
  assert.equal(g.falseCleanN, 2);
  assert.equal(g.falseAlarmRate, 1 / 3, 'false-alarm is observable only where the gate alarmed: 1 of 3');
  assert.equal(g.falseAlarmN, 3);
  assert.equal(g.catchObservable, true, 'the clean stratum has adjudications, so catch is not structurally 1.0');
  assert.equal(g.attributionAccuracy, 2 / 3);
  assert.equal(g.unadjudicated, 15, 'the denominator gap is a printed fact, not an omission');
});

test('a cohort of only alarm adjudications has NO false-clean rate — it does not have a rate of zero', () => {
  const adj = Array.from({ length: 14 }, (_, i) => ({
    kind: 'adjudication', gate: 'gate-ratchet', truth: i === 0 ? 'false-alarm' : 'true-alarm',
  }));
  const m = computeMetrics(adj, { 'gate-ratchet': 384 });
  const g = m['gate-ratchet'];
  assert.equal(g.falseCleanRate, null, 'no clean-verdict adjudication exists, so no false-clean rate exists');
  assert.equal(g.falseCleanN, 0, 'the denominator is zero and says so');
  assert.equal(g.catchObservable, false,
    'catch is structurally 1.0 here — a false-clean can only be found in the stratum nobody examined');
  assert.equal(g.catchRate, 1, 'and it duly reads 100%, which is why catchObservable has to travel with it');
  assert.equal(g.falseAlarmRate, 1 / 14, 'the alarm stratum IS observable, and keeps a real rate');
  assert.equal(g.falseAlarmN, 14);
});

// ── COHORTS: WHO SUPPLIED THE TRUTH ─────────────────────────────────────────────────────────────
// Canary truth is constructed by the harness — pooled with human judgements, a rate's own author
// writes its answers in.
test('computeMetrics: canary adjudications are split out of the headline and published beside it', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', attributionCorrect: false, recordAt: 't2' },
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', attributionCorrect: true, recordAt: 't9', canary: 'R-CLAIM-MINE' },
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', attributionCorrect: true, recordAt: 't9', canary: 'R-CLAIM-THEIRS' },
  ];
  const index = { g: new Set(['t1', 't2', 't3']) };
  const m = computeMetrics(adj, { g: 10 }, { recordAtIndex: index });
  assert.equal(m.g.attributionAccuracy, 0, 'headline is the gate, not the harness');
  assert.equal(m.g.attributionScored, 1);
  assert.equal(m.g.canary.attributionAccuracy, 1, 'constructed truth is published, not discarded');
  assert.equal(m.g.canary.adjudicated, 2);
  assert.equal(m.g.combined.adjudicated, 3, 'nothing is deleted — combined still holds everything');
  assert.equal(m.g.unadjudicated, 9, 'a canary judged no journal record, so it counts nothing down');
});

// Retrospective pre-journal incidents carry a synthetic recordAt because no journal existed then.
test('computeMetrics: a retrospective pre-journal incident stays IN the headline', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', recordAt: '2026-08-20' },   // journalled
    { kind: 'adjudication', gate: 'g', truth: 'false-clean', recordAt: '2026-08-03' },  // predates the journal
  ];
  const index = { g: new Set(['2026-08-20', '2026-08-21']) };
  const m = computeMetrics(adj, { g: 5 }, { recordAtIndex: index });
  assert.equal(m.g.adjudicated, 2, 'both are in the headline');
  assert.equal(m.g.falseCleanRate, 1, 'the pre-journal false-clean still moves the rate');
  assert.equal(m.g.falseCleanN, 1, 'only the clean-verdict adjudication is in the denominator');
  assert.equal(m.g.retrospective.adjudicated, 1);
  assert.equal(m.g.live.adjudicated, 1);
  assert.equal(m.g.dangling, 0, 'pre-journal is not dangling');
  assert.equal(m.g.unadjudicated, 4, 'only the journalled one counts against the journal backlog');
});

test('computeMetrics: a recordAt at/after the journal start that matches nothing IS dangling, and is excluded', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', recordAt: '2026-08-20' },
    { kind: 'adjudication', gate: 'g', truth: 'false-clean', recordAt: '2026-08-25' },  // should exist, does not
  ];
  const index = { g: new Set(['2026-08-20', '2026-08-21']) };
  const m = computeMetrics(adj, { g: 5 }, { recordAtIndex: index });
  assert.equal(m.g.dangling, 1);
  assert.equal(m.g.adjudicated, 1);
  assert.equal(m.g.falseCleanRate, null, 'a reference to a decision that should exist and does not judges nothing');
  assert.equal(m.g.falseCleanN, 0, 'no clean-verdict adjudication survives, so there is no denominator');
  assert.equal(m.g.catchObservable, false, 'catch is structurally 1.0 with no clean stratum examined');
});

test('computeMetrics: a gate with NO journal at all is all-retrospective, never all-dangling', () => {
  const m = computeMetrics([{ kind: 'adjudication', gate: 'liveness', truth: 'false-clean', recordAt: '2026-08-01' }],
    {}, { recordAtIndex: { liveness: new Set() } });
  assert.equal(m.liveness.falseCleanRate, 1);
  assert.equal(m.liveness.retrospective.adjudicated, 1);
  assert.equal(m.liveness.dangling, 0);
});

test('computeMetrics: without an index, resolvability is UNCHECKED (null) and no record is dropped', () => {
  const m = computeMetrics([{ kind: 'adjudication', gate: 'g', truth: 'false-clean', recordAt: 'whenever' }], { g: 3 });
  assert.equal(m.g.dangling, null, 'not-checked is not none-found');
  assert.equal(m.g.adjudicated, 1, 'an unchecked corpus is still counted — grey is not empty');
  assert.equal(m.g.falseCleanRate, 1);
});

// ── INSTRUMENT EPOCH ────────────────────────────────────────────────────────────────────────────
// Pre-epoch attribution scores judge a replaced instrument — "wrong every time" and "unmeasured
// since fixed" call for opposite repairs, so they must not print the same number.
const EPOCH = { g: '2026-08-11T15:45:02.000Z' };

test('epoch: pre-epoch scores judge a replaced instrument — counted, shown, and out of the rate', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', attributionCorrect: false, recordAt: '2026-08-09T00:00:00.000Z' },
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', attributionCorrect: false, recordAt: '2026-08-10T00:00:00.000Z' },
  ];
  const m = computeMetrics(adj, { g: 5 }, { attributionEpochs: EPOCH });
  assert.equal(m.g.attributionAccuracy, null, 'UNMEASURED, never 0% — 0% would point at the wrong repair');
  assert.equal(m.g.attributionScored, 0);
  assert.equal(m.g.attributionPreEpoch, 2, 'the evidence is kept and shown, not dropped');
  assert.equal(m.g.attributionEpoch, EPOCH.g);
  // and the epoch touches ATTRIBUTION only — none of those commits changed detection
  assert.equal(m.g.adjudicated, 2);
  assert.equal(m.g.catchRate, 1, 'detection still spans the whole corpus');
});

test('epoch: post-epoch scores are the rate; the two cohorts do not mix', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', attributionCorrect: false, recordAt: '2026-08-09T00:00:00.000Z' },
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', attributionCorrect: true, recordAt: '2026-08-12T00:00:00.000Z' },
  ];
  const m = computeMetrics(adj, { g: 5 }, { attributionEpochs: EPOCH });
  assert.equal(m.g.attributionAccuracy, 1, 'one post-epoch score, correct');
  assert.equal(m.g.attributionScored, 1);
  assert.equal(m.g.attributionPreEpoch, 1);
});

test('epoch: a gate with no declared epoch scores every record — the split is opt-in per gate', () => {
  const adj = [{ kind: 'adjudication', gate: 'other', truth: 'true-alarm', attributionCorrect: false, recordAt: '2026-08-09T00:00:00.000Z' }];
  const m = computeMetrics(adj, { other: 5 }, { attributionEpochs: EPOCH });
  assert.equal(m.other.attributionAccuracy, 0);
  assert.equal(m.other.attributionPreEpoch, 0);
  assert.equal(m.other.attributionEpoch, null);
});

test('epoch: declaring one can never improve a DETECTION rate — it is not a way to erase history', () => {
  // The guard against the obvious abuse: move the epoch forward, watch the bad numbers go away.
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'false-clean', attributionCorrect: false, recordAt: '2026-08-01T00:00:00.000Z' },
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', attributionCorrect: true, recordAt: '2026-08-12T00:00:00.000Z' },
  ];
  const withEpoch = computeMetrics(adj, { g: 9 }, { attributionEpochs: { g: '2026-09-01T00:00:00.000Z' } });
  const without = computeMetrics(adj, { g: 9 }, { attributionEpochs: {} });
  for (const k of ['adjudicated', 'catchRate', 'falseCleanRate', 'falseAlarmRate', 'unadjudicated']) {
    assert.deepEqual(withEpoch.g[k], without.g[k], `epoch moved '${k}' — an epoch may only ever scope ATTRIBUTION`);
  }
  assert.equal(withEpoch.g.falseCleanRate, 1, 'the false-clean is still in the rate');
});

test('computeMetrics: no denominator yields null, never zero — a rate over nothing is not 0%', () => {
  const m = computeMetrics([{ kind: 'adjudication', gate: 'g', truth: 'true-clean' }], {});
  assert.equal(m.g.catchRate, null);
  assert.equal(m.g.attributionAccuracy, null);
  assert.equal(m.g.records, null);
});

test('anchors: growth is normal, tail truncation and rewrites alarm, deletion alarms', () => {
  journal('a', { verdict: 'one' });
  journal('a', { verdict: 'two' });
  const { anchored } = anchorJournals();
  assert.deepEqual(anchored.map((x) => ({ file: x.file, records: x.records, ok: x.ok })), [{ file: 'a.jsonl', records: 2, ok: true }]);

  // intact, then intact-extended after a legitimate append — the gates keep firing, that is normal
  assert.equal(verifyAnchors().results[0].state, 'intact');
  journal('a', { verdict: 'three' });
  assert.equal(verifyAnchors().results[0].state, 'intact-extended');

  // tail truncation below the anchor point — the chain cannot see this; the anchor can
  const p = join(dir, 'verdicts', 'a.jsonl');
  const lines = readFileSync(p, 'utf8').trim().split('\n');
  writeFileSync(p, lines.slice(0, 1).join('\n') + '\n');
  let v = verifyAnchors();
  assert.equal(v.state, 'ALARM');
  assert.equal(v.results[0].state, 'TRUNCATED');

  // rewrite of the anchored line — count restored, content changed
  writeFileSync(p, [lines[0], '{"v":1,"forged":true}', lines[2]].join('\n') + '\n');
  v = verifyAnchors();
  assert.equal(v.results[0].state, 'REWRITTEN');

  // the journal deleted outright
  rmSync(p);
  v = verifyAnchors();
  assert.equal(v.results[0].state, 'JOURNAL-GONE');
  assert.equal(v.state, 'ALARM');
});

test('the anchor store never rotates, whatever the journal rotation threshold', () => {
  // verifyAnchors reads only the live store; a rotated store would drop every older anchor from
  // verification without saying so. 2026-09-18: the real store was 24.8 KB short of rotating.
  const before = process.env.CW_VERDICT_MAX_BYTES;
  process.env.CW_VERDICT_MAX_BYTES = '300';
  try {
    for (let i = 0; i < 6; i++) { journal('pin', { verdict: `v${i}` }); anchorJournals(); }
    assert.equal(existsSync(`${process.env.CW_VERDICT_ANCHORS}.1`), false, 'the anchor store must not have rotated');
    const aj = readJournalFile(process.env.CW_VERDICT_ANCHORS);
    assert.ok(aj.records.filter((r) => r.file === 'pin.jsonl').length >= 6, 'every anchor stays in the live store');
    assert.equal(existsSync(join(dir, 'verdicts', 'pin.jsonl.1')), true, 'journals themselves still rotate');
  } finally {
    if (before === undefined) delete process.env.CW_VERDICT_MAX_BYTES; else process.env.CW_VERDICT_MAX_BYTES = before;
  }
});

test('an append chains onto the tail even when the last line is longer than the tail window', () => {
  // appendLocked reads only the tail; readTailLine must widen when the last line starts before
  // its window, or the next record would chain to a fragment.
  journal('wide', { verdict: 'x'.repeat(20_000) });
  journal('wide', { verdict: 'after' });
  const lines = readFileSync(join(dir, 'verdicts', 'wide.jsonl'), 'utf8').trim().split('\n');
  assert.equal(JSON.parse(lines[1]).prev, createHash('sha256').update(lines[0]).digest('hex').slice(0, 32));
  assert.equal(readJournalFile(join(dir, 'verdicts', 'wide.jsonl')).chain.broken, 0);
});

test('anchors: absence of anchors is its own state, never a pass', () => {
  journal('b', { verdict: 'x' });
  assert.equal(verifyAnchors().state, 'no-anchors');
});

test('the anchor store lives OUTSIDE the verdict dir and is itself chained', () => {
  journal('c', { verdict: 'x' });
  anchorJournals();
  anchorJournals(); // second snapshot chains onto the first
  const aj = readJournalFile(process.env.CW_VERDICT_ANCHORS);
  assert.equal(aj.records.length, 2);
  assert.deepEqual(aj.chain, { verified: 2, broken: 0, raced: 0, unchained: 0 });
  assert.ok(!process.env.CW_VERDICT_ANCHORS.includes('verdicts'), 'fixture mirrors the real layout: not inside the journal dir');
});

// ── C-1: finding-adjudication ───────────────────────────────────────────────────────────────────

test('finding-adjudication: append/read/chain-intact for the new kind, alongside kind:adjudication in the same file', () => {
  const r1 = appendFindingAdjudication({
    findingKey: findingKeyForScanner('secrets', 'clientD', { rule: 'curl-auth-header', file: 'docs/a.md' }),
    category: 'secrets', repo: 'clientD', humanVerdict: 'false-positive', truth: 'false-alarm',
  });
  assert.equal(r1.ok, true);
  const r2 = appendFindingAdjudication({
    findingKey: findingKeyForScanner('secrets', 'clientD', { rule: 'curl-auth-header', file: 'docs/b.md' }),
    category: 'secrets', repo: 'clientD', humanVerdict: 'accept',
  });
  assert.equal(r2.ok, true);
  const j = readJournalFile(adjudicationsPath());
  assert.equal(j.records.length, 2);
  assert.deepEqual(j.chain, { verified: 2, broken: 0, raced: 0, unchained: 0 }, 'the chain covers finding-adjudication records the same way as any other kind');
  assert.equal(j.records[0].kind, 'finding-adjudication');
  assert.equal(j.records[0].v, 1);
  assert.equal(j.records[0].at, '2026-08-10T00:00:00.000Z'); // CW_NOW
  assert.equal(j.records[0].category, 'secrets');
  assert.equal(j.records[0].repo, 'clientD');
  assert.equal(j.records[0].findingKey, 'secrets|clientD|curl-auth-header|docs/a.md');
});

test('appendFindingAdjudication rejects a record missing findingKey/category/repo without writing', () => {
  const before = existsSync(adjudicationsPath());
  const r = appendFindingAdjudication({ category: 'secrets', repo: 'clientD' }); // no findingKey
  assert.equal(r.ok, false);
  assert.equal(r.error, 'missing findingKey');
  assert.equal(existsSync(adjudicationsPath()), before, 'a rejected record never touches disk');
});

test('buildFindingKey rejects forbidden identity components BY NAME — never by scanning for digits (undici|5.28.4 must pass)', () => {
  assert.throws(() => buildFindingKey([['rule', 'x'], ['line', 12]]), /forbidden identity component 'line'/);
  assert.throws(() => buildFindingKey([['rule', 'x'], ['startLine', 12]]), /'startLine'/);
  assert.throws(() => buildFindingKey([['rule', 'x'], ['endLine', 3]]), /'endLine'/);
  assert.ok(FORBIDDEN_IDENTITY_COMPONENTS.has('line') && FORBIDDEN_IDENTITY_COMPONENTS.has('startLine'));

  // a version-shaped component is legitimate — the validator rejects by NAME, not by scanning for digits
  const key = buildFindingKey([['package', 'undici'], ['version', '5.28.4']]);
  assert.equal(key, 'undici|5.28.4');
});

test('findingKeyForScanner assembles category+repo+identity tuple from detail-schema.mjs; unknown category throws', () => {
  const key = findingKeyForScanner('secrets', 'clientD', { rule: 'curl-auth-header', file: 'docs/x.md', line: 204 });
  assert.equal(key, 'secrets|clientD|curl-auth-header|docs/x.md', 'line is part of the row but NOT part of the identity tuple, so it never enters the key');
  assert.throws(() => findingKeyForScanner('not-a-real-category', 'clientD', {}), /unknown category/);
});

test('findingKeyForDependency builds repo|id|package, the shape annotations.json CVE records already use', () => {
  assert.equal(findingKeyForDependency('svc-admin-console', 'CVE-2026-33671', 'picomatch'), 'svc-admin-console|CVE-2026-33671|picomatch');
});

test('redactLedgerFields: secret-shaped evidence/basis in -> place+artifact+sha256 out, raw content absent from the written record', () => {
  const secretEvidence = 'AKIAABCDEFGHIJKLMNOPQRST (aws-shaped) plus a literal matched string XYZ-TOKEN-123';
  const secretBasis = 'human explanation quoting the SAME secret AKIAABCDEFGHIJKLMNOPQRST inline';
  const r = appendFindingAdjudication(
    { findingKey: 'secrets|clientD|rule|file.md', category: 'secrets', repo: 'clientD', evidence: secretEvidence, basis: secretBasis },
    { place: 'secrets:file.md', artifact: 'monitor/annotations.json#scannerAnnotations' },
  );
  assert.equal(r.ok, true);

  const raw = readFileSync(adjudicationsPath(), 'utf8');
  assert.equal(raw.includes('AKIAABCDEFGHIJKLMNOPQRST'), false, 'raw secret text must never reach disk');
  assert.equal(raw.includes('XYZ-TOKEN-123'), false);

  const rec = readJournalFile(adjudicationsPath()).records[0];
  assert.equal(typeof rec.evidence, 'object');
  assert.equal(rec.evidence.place, 'secrets:file.md');
  assert.equal(rec.evidence.artifact, 'monitor/annotations.json#scannerAnnotations');
  assert.equal(rec.evidence.sha256, createHash('sha256').update(secretEvidence).digest('hex'));
  assert.equal(rec.basis.sha256, createHash('sha256').update(secretBasis).digest('hex'));
  assert.equal(JSON.stringify(rec).includes('AKIAABCDEFGHIJKLMNOPQRST'), false, 'no field of the stored record carries the raw text');
});

test('redactLedgerFields is a no-op for kinds with no declared free-text fields, and tolerates non-string/absent fields', () => {
  assert.deepEqual(redactLedgerFields({ kind: 'adjudication', basis: 'plain text kept as-is for the gate kind' }),
    { kind: 'adjudication', basis: 'plain text kept as-is for the gate kind' });
  assert.equal(redactLedgerFields(null), null);
  const r = redactLedgerFields({ kind: 'finding-adjudication', evidence: undefined, basis: 42 });
  assert.equal(r.evidence, undefined);
  assert.equal(r.basis, 42, 'a non-string basis is left alone, not coerced or crashed on');
});

test('appendFindingAdjudication error paths never leak evidence/basis content into the error string', () => {
  const secret = 'super-secret-value-should-never-appear-anywhere';
  const r = appendFindingAdjudication({ category: 'secrets', repo: 'clientD', evidence: secret, basis: secret }); // missing findingKey
  assert.equal(r.ok, false);
  assert.equal(r.error.includes(secret), false);
  assert.equal(r.error, 'missing findingKey');
});

test('unknown record kinds (including finding-adjudication) are counted in records, never dropped, never counted as unadjudicated, and never make a gate render absent-not-running', () => {
  appendRecord(adjudicationsPath(), { v: 1, kind: 'adjudication', gate: 'gate-tests', recordAt: 'r1', truth: 'true-alarm', basis: 'b', adjudicatedBy: 'human' });
  appendFindingAdjudication({ findingKey: 'k1', category: 'secrets', repo: 'clientD', humanVerdict: 'accept' });
  appendRecord(adjudicationsPath(), { v: 1, kind: 'some-future-kind', whatever: true });

  const j = readJournalFile(adjudicationsPath());
  assert.equal(j.records.length, 3, 'every valid JSON line is counted regardless of kind — nothing is dropped');
  assert.equal(j.torn, 0);

  const m = computeMetrics(j.records, { 'gate-tests': 10 });
  assert.equal(m['gate-tests'].adjudicated, 1, 'only kind:adjudication feeds gate metrics');
  assert.equal(m['gate-tests'].unadjudicated, 9, 'finding-adjudication and unknown-kind rows are never laundered into the unadjudicated count');

  // adjudications.jsonl is a different file from any GATE_ROSTER journal
  const [h] = journalHealth({ roster: [{ gate: 'gate-tests', baseline: null }] });
  assert.equal(h.state, 'absent-not-running', 'no gate-tests.jsonl was written in this test — a genuine absence, unaffected by the adjudications file');
});

// ── C-1: bin/adjudication-import.mjs ────────────────────────────────────────────────────────────

function writeAnnotationsFixture(path, doc) {
  writeFileSync(path, JSON.stringify(doc));
}

test('adjudication-import: derives scanner + dependency-cve records, skips unpinnable wildcard CVEs, and is idempotent across two --write runs', () => {
  const fixture = join(dir, 'annotations-fixture.json');
  writeAnnotationsFixture(fixture, {
    scannerAnnotations: [
      { category: 'secrets', repo: 'clientD', rule: 'curl-auth-header', file: 'docs/a.md', action: 'false-positive', reason: 'placeholder token', who: 'tester', at: '2026-08-01T00:00:00.000Z' },
      { category: 'secrets', repo: 'clientD', rule: 'curl-auth-header', file: 'docs/b.md', action: 'accept', reason: 'accepted risk', who: 'tester', at: '2026-08-01T00:00:00.000Z' },
    ],
    annotations: [
      { id: 'CVE-2099-00001', package: 'left-pad', repo: 'clientD', action: 'accept', reason: 'accepted', who: 'tester', at: '2026-08-01T00:00:00.000Z' },
      { id: 'CVE-2099-00002', package: 'left-pad', action: 'accept', reason: 'fleet-wide, no repo', who: 'tester', at: '2026-08-01T00:00:00.000Z' }, // wildcard: unpinnable
    ],
  });
  const env = { ...process.env, CW_ANNOTATIONS: fixture, CW_VERDICT_DIR: join(dir, 'verdicts'), CW_NOW: '2026-08-10T00:00:00.000Z' };

  const first = spawnSync(process.execPath, [IMPORT_SCRIPT, '--write'], { env, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /new: 3\b/);
  assert.match(first.stdout, /unimportable: 1\b/);
  assert.match(first.stdout, /wrote 3 new/);

  const j1 = readJournalFile(adjudicationsPath());
  assert.equal(j1.records.length, 3);
  assert.ok(j1.records.every((r) => r.kind === 'finding-adjudication'));

  const second = spawnSync(process.execPath, [IMPORT_SCRIPT, '--write'], { env, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already imported: 3\b/);
  assert.match(second.stdout, /new: 0\b/);
  assert.match(second.stdout, /wrote 0 new/);

  const j2 = readJournalFile(adjudicationsPath());
  assert.equal(j2.records.length, 3, 'run twice with the same source -> identical count, no duplicates appended');
});

test('adjudication-import: dry-run (default) writes nothing', () => {
  const fixture = join(dir, 'annotations-fixture-dry.json');
  writeAnnotationsFixture(fixture, {
    scannerAnnotations: [{ category: 'secrets', repo: 'clientD', rule: 'r', file: 'f.md', action: 'false-positive', reason: 'x', who: 't', at: '2026-08-01T00:00:00.000Z' }],
    annotations: [],
  });
  const env = { ...process.env, CW_ANNOTATIONS: fixture, CW_VERDICT_DIR: join(dir, 'verdicts'), CW_NOW: '2026-08-10T00:00:00.000Z' };
  const res = spawnSync(process.execPath, [IMPORT_SCRIPT], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /dry run/);
  assert.equal(existsSync(adjudicationsPath()), false, 'a dry run never creates the journal file');
});

test('adjudication-import never touches or re-derives the native kind:adjudication records', () => {
  mkdirSync(join(dir, 'verdicts'), { recursive: true });
  writeFileSync(adjudicationsPath(), `${JSON.stringify({
    v: 1, kind: 'adjudication', gate: 'gate-tests', at: '2026-08-01T00:00:00.000Z', recordAt: 'x',
    truth: 'true-clean', basis: 'b', adjudicatedBy: 'human', prev: 'genesis',
  })}\n`);
  const fixture = join(dir, 'annotations-fixture-native.json');
  writeAnnotationsFixture(fixture, {
    scannerAnnotations: [{ category: 'secrets', repo: 'clientD', rule: 'r', file: 'f.md', action: 'false-positive', reason: 'x', who: 't', at: '2026-08-01T00:00:00.000Z' }],
    annotations: [],
  });
  const env = { ...process.env, CW_ANNOTATIONS: fixture, CW_VERDICT_DIR: join(dir, 'verdicts'), CW_NOW: '2026-08-10T00:00:00.000Z' };
  const res = spawnSync(process.execPath, [IMPORT_SCRIPT, '--write'], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);

  const j = readJournalFile(adjudicationsPath());
  const kinds = j.records.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['adjudication', 'finding-adjudication']);
  assert.equal(kinds.filter((k) => k === 'adjudication').length, 1, 'the pre-existing native record is neither duplicated nor reinterpreted as an import candidate');
});

test('rotation rename losing to a racer is first-writer-won, not an error (C15)', () => {
  // ENOENT from stat/rename during rotation is benign — driven via an absent-file stand-in
  const p = join(dir, 'race.jsonl');
  const r = appendRecord(p, { v: 1, first: true }, { maxBytes: 10 });
  assert.equal(r.ok, true); // stat ENOENT on first write is the same tolerated path
  appendFileSync(p, 'x'.repeat(50));
  const r2 = appendRecord(p, { v: 1, second: true }, { maxBytes: 10 });
  assert.equal(r2.ok, true);
  assert.ok(existsSync(`${p}.1`));
});

// ── C-2: --calibrate ─────────────────────────────────────────────────────────────────────────────

test('computeFindingCalibration: denominator is always present, and is null-at-zero (a rate over nothing is not 0%)', () => {
  // one unadjudicated import-style record (truth:null) — no truth-bearing record for this check
  const records = [
    { kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: null, truth: null, bornSlice: null },
  ];
  const calib = computeFindingCalibration(records, { windowStart: null });
  const m = calib.checks.secrets[UNMODELED_LABEL];
  assert.equal(m.denominator, 0);
  assert.equal(m.adjudicated, 0);
  assert.equal(m.unadjudicated, 1, 'the unadjudicated record is counted, never dropped');
  assert.equal(m.falseAlarmRate, null);
  assert.equal(m.falseCleanRate, null);
  assert.equal(m.cohorts.standing.falseAlarmRate, null);
  assert.equal(m.cohorts.delta.denominator, 0);
  assert.equal(m.cohorts.delta.falseAlarmRate, null);

  // now with a real denominator: rates are present and non-null
  records.push({ kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: null, truth: 'false-alarm', bornSlice: null });
  const calib2 = computeFindingCalibration(records, { windowStart: null });
  const m2 = calib2.checks.secrets[UNMODELED_LABEL];
  assert.equal(m2.denominator, 1);
  assert.equal(m2.falseAlarmRate, 1);
  assert.equal(m2.falseCleanRate, 0, 'zero false-cleans out of a NON-zero denominator is a real 0%, not null');
});

test('computeFindingCalibration: unknown/absent bornSlice defaults to standing, counted as cohort-unknown, never inflates delta', () => {
  const windowStart = '2026-08-05T00:00:00.000Z';
  const records = [
    { kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: null, truth: 'false-alarm', bornSlice: null },
    { kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: null, truth: 'true-clean', bornSlice: 'not-a-parseable-slice' },
  ];
  const calib = computeFindingCalibration(records, { windowStart });
  const m = calib.checks.secrets[UNMODELED_LABEL];
  assert.equal(m.cohortUnknown, 2, 'both absent AND unparseable bornSlice count as cohort-unknown');
  assert.equal(m.cohorts.delta.denominator, 0, 'absent provenance must never inflate the alarming cohort');
  assert.equal(m.cohorts.standing.denominator, 2, 'unknown-provenance records land in standing, the non-alarming cohort');
});

test('computeFindingCalibration: bornSlice before/within the window sorts into standing/delta correctly, including a millis-format boundary', () => {
  const windowStart = '2026-08-10T00:00:00.000Z'; // banked baseline `at` — HAS millis
  const records = [
    { kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: 'human', truth: 'true-clean', bornSlice: 'sweep-20260801000000' }, // well before
    { kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: 'human', truth: 'true-clean', bornSlice: 'sweep-20260811000000' }, // well after
    { kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: 'human', truth: 'true-clean', bornSlice: 'sweep-20260810000000' }, // EXACT same instant, no millis
  ];
  const calib = computeFindingCalibration(records, { windowStart });
  const m = calib.checks.secrets.human;
  assert.equal(m.cohorts.standing.denominator, 1, 'the pre-window record');
  assert.equal(m.cohorts.delta.denominator, 2, 'the post-window record AND the exact-boundary record (>=, epoch-millis compared) both count as delta');
});

test('bornSliceAt: parses the trailing 14-digit stamp from sweep-/adhoc-/bare sliceIds; anything else is null', () => {
  assert.equal(bornSliceAt('sweep-20260810014850'), '2026-08-10T01:48:50Z');
  assert.equal(bornSliceAt('adhoc-20260101000000'), '2026-01-01T00:00:00Z');
  assert.equal(bornSliceAt('20260810014850'), '2026-08-10T01:48:50Z');
  assert.equal(bornSliceAt(null), null);
  assert.equal(bornSliceAt(undefined), null);
  assert.equal(bornSliceAt('not-a-stamp'), null);
  assert.equal(bornSliceAt(''), null);
});

test('computeFindingCalibration: model:null groups under UNMODELED_LABEL ("human"), a real model string groups separately', () => {
  const records = [
    { kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: null, truth: 'false-alarm', bornSlice: null },
    { kind: 'finding-adjudication', category: 'secrets', repo: 'clientD', model: 'sonnet-5', truth: 'true-clean', bornSlice: null },
  ];
  const calib = computeFindingCalibration(records);
  assert.equal(UNMODELED_LABEL, 'human');
  assert.ok(calib.checks.secrets[UNMODELED_LABEL]);
  assert.ok(calib.checks.secrets['sonnet-5']);
  assert.equal(calib.checks.secrets[UNMODELED_LABEL].adjudicated, 1);
  assert.equal(calib.checks.secrets['sonnet-5'].adjudicated, 1);
});

test('--calibrate --json emits the pinned shape: generated, checks[check][model] = {denominator, adjudicated, falseAlarmRate, falseCleanRate, cohorts:{standing,delta}}', () => {
  appendFindingAdjudication({ findingKey: 'k1', category: 'secrets', repo: 'clientD', truth: 'false-alarm', bornSlice: 'sweep-20260801000000' });
  appendFindingAdjudication({ findingKey: 'k2', category: 'secrets', repo: 'clientD', truth: 'true-clean', bornSlice: 'sweep-20260801000000' });
  const res = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'verdict-journal.mjs'), '--calibrate', '--json'],
    { env: process.env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.ok(typeof out.generated === 'string');
  assert.ok(out.checks.secrets);
  const m = out.checks.secrets[UNMODELED_LABEL];
  for (const key of ['denominator', 'adjudicated', 'falseAlarmRate', 'falseCleanRate']) {
    assert.ok(key in m, `pinned key '${key}' present`);
  }
  assert.ok(m.cohorts && 'standing' in m.cohorts && 'delta' in m.cohorts);
  for (const cohort of ['standing', 'delta']) {
    for (const key of ['denominator', 'adjudicated', 'falseAlarmRate', 'falseCleanRate']) {
      assert.ok(key in m.cohorts[cohort], `cohort '${cohort}' carries pinned key '${key}'`);
    }
  }
});

test('--calibrate ratchet: bootstrap bakes a floor with no alarm, a delta-cohort regression alarms and does NOT move the floor, and a standing-only regression is reported but never alarms and DOES move the floor', () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'verdict-journal.mjs');
  const run = (extraEnv = {}) => spawnSync(process.execPath, [SCRIPT, '--calibrate'], { env: { ...process.env, ...extraEnv }, encoding: 'utf8' });

  // bootstrap: no baseline yet so everything is standing; floor rate 0.5, no delta, no alarm
  appendFindingAdjudication({ findingKey: 'k1', category: 'secrets', repo: 'clientD', truth: 'false-alarm', bornSlice: 'sweep-20260801000000' });
  appendFindingAdjudication({ findingKey: 'k2', category: 'secrets', repo: 'clientD', truth: 'true-clean', bornSlice: 'sweep-20260801000000' });
  const boot = run();
  assert.equal(boot.status, 0, boot.stderr);
  assert.ok(existsSync(calibrateBaselinePath()), 'a clean bake writes the ratchet floor');
  const bakedAfterBoot = readFileSync(calibrateBaselinePath(), 'utf8');
  const baseline = JSON.parse(bakedAfterBoot);
  assert.equal(baseline.checks.secrets[UNMODELED_LABEL].falseAlarmRate, 0.5);

  // DELTA regression: a brand-new record, born AFTER the banked baseline.at, is a false-alarm —
  // delta cohort rate (1/1 = 1.0) > baseline floor (0.5) -> ALARM, floor must NOT move.
  appendFindingAdjudication({ findingKey: 'k3', category: 'secrets', repo: 'clientD', truth: 'false-alarm', bornSlice: 'sweep-20260811000000' });
  const deltaRun = run();
  assert.equal(deltaRun.status, 1, 'delta-cohort regression exits non-zero');
  assert.match(deltaRun.stderr, /ALARM \(delta cohort regressed\)/);
  assert.equal(readFileSync(calibrateBaselinePath(), 'utf8'), bakedAfterBoot, 'an alarming run must never silently rebank the floor over the regression');
});

test('--calibrate: standing-only regression is reported (not alarmed) and the floor still advances on that clean bake', () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'verdict-journal.mjs');
  const run = () => spawnSync(process.execPath, [SCRIPT, '--calibrate'], { env: process.env, encoding: 'utf8' });

  appendFindingAdjudication({ findingKey: 'k1', category: 'secrets', repo: 'clientD', truth: 'false-alarm', bornSlice: 'sweep-20260801000000' });
  appendFindingAdjudication({ findingKey: 'k2', category: 'secrets', repo: 'clientD', truth: 'true-clean', bornSlice: 'sweep-20260801000000' });
  const boot = run();
  assert.equal(boot.status, 0, boot.stderr);
  const bakedAfterBoot = readFileSync(calibrateBaselinePath(), 'utf8');

  // a SECOND adjudication landing on the SAME (pre-window) bornSlice makes the standing cohort
  // worse (2 false-alarm / 3 = 0.667 > 0.5 floor); no new delta-cohort record at all.
  appendFindingAdjudication({ findingKey: 'k3', category: 'secrets', repo: 'clientD', truth: 'false-alarm', bornSlice: 'sweep-20260801000000' });
  const standingRun = run();
  assert.equal(standingRun.status, 0, 'standing-only regression never alarms');
  assert.match(standingRun.stdout, /REPORT \(standing, not alarmed\)/);
  assert.notEqual(readFileSync(calibrateBaselinePath(), 'utf8'), bakedAfterBoot, 'a clean (non-alarming) bake DOES advance the floor');
});

test('bankedRatesFrom / compareCalibrationToBaseline: pure functions, null never regresses against anything', () => {
  const calib = computeFindingCalibration([
    { kind: 'finding-adjudication', category: 'secrets', repo: 'r', model: 'm', truth: 'false-alarm', bornSlice: 'sweep-20260811000000' },
  ], { windowStart: '2026-08-10T00:00:00.000Z' });
  const banked = bankedRatesFrom(calib);
  assert.equal(banked.secrets.m.falseAlarmRate, 1);

  // baseline has a NULL rate for this check/model (never baked before) -> no regression, ever
  const { deltaRegressions } = compareCalibrationToBaseline(calib, { checks: { secrets: { m: { falseAlarmRate: null, falseCleanRate: null } } } });
  assert.deepEqual(deltaRegressions, []);

  // no baseline at all -> no regressions of either kind
  assert.deepEqual(compareCalibrationToBaseline(calib, null), { deltaRegressions: [], standingRegressions: [] });
});

// ── A-5: --anchor-data / --verify-data-anchors ──────────────────────────────────────────────────

function writeJson(path, doc) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2));
}

test('data-anchor: index.json truncated mid-file -> TRUNCATED alarm', () => {
  const idx = join(dir, 'history', 'index.json');
  writeJson(idx, [{ sliceId: 's1', source: 'src1', total: 10 }, { sliceId: 's2', source: 'src2', total: 20 }]);
  const a = anchorDataStore(idx, 'index');
  assert.equal(a.ok, true);
  assert.equal(a.rows, 2);

  const raw = readFileSync(idx, 'utf8');
  writeFileSync(idx, raw.slice(0, Math.floor(raw.length / 2))); // chop mid-object: shorter AND unparseable
  const v = verifyDataAnchors();
  assert.equal(v.state, 'ALARM');
  assert.equal(v.results[0].state, 'TRUNCATED');
});

test('data-anchor: index.json same-(sliceId,source) row replacement -> drift-report, never an alarm', () => {
  const idx = join(dir, 'history', 'index.json');
  writeJson(idx, [{ sliceId: 's1', source: 'src1', total: 10 }]);
  anchorDataStore(idx, 'index');

  writeJson(idx, [{ sliceId: 's1', source: 'src1', total: 99 }]); // rollup's own idempotent re-roll upsert
  const v = verifyDataAnchors();
  assert.equal(v.state, 'ok', 'a same-identity content change never alarms');
  assert.equal(v.results[0].state, 'drift-report');
});

test('data-anchor: index.json rows appended -> intact-extended', () => {
  const idx = join(dir, 'history', 'index.json');
  writeJson(idx, [{ sliceId: 's1', source: 'src1', total: 10 }]);
  anchorDataStore(idx, 'index');

  writeJson(idx, [{ sliceId: 's1', source: 'src1', total: 10 }, { sliceId: 's2', source: 'src2', total: 20 }]);
  const v = verifyDataAnchors();
  assert.equal(v.state, 'ok');
  assert.equal(v.results[0].state, 'intact-extended');
});

test('data-anchor: index.json identity ROW REMOVED -> alarm (distinct from a same-identity replacement)', () => {
  const idx = join(dir, 'history', 'index.json');
  writeJson(idx, [{ sliceId: 's1', source: 'src1', total: 10 }, { sliceId: 's2', source: 'src2', total: 20 }]);
  anchorDataStore(idx, 'index');

  writeJson(idx, [{ sliceId: 's2', source: 'src2', total: 20 }]); // s1 identity is simply gone
  const v = verifyDataAnchors();
  assert.equal(v.state, 'ALARM');
  assert.equal(v.results[0].state, 'ROW-REMOVED');
});

test('data-anchor: rollup.json ("rewritten" class) rewritten and even SHRUNK -> drift-report, NEVER an alarm', () => {
  const rollup = join(dir, 'rollup.json');
  writeJson(rollup, { generated: 't1', totals: { crit: 5, high: 10 } });
  anchorDataStore(rollup, 'rewritten');

  writeJson(rollup, { generated: 't2', totals: { crit: 0 } }); // legitimately smaller — findings closed
  const v = verifyDataAnchors();
  assert.equal(v.state, 'ok', 'a rewritten-class store never alarms on content drift, however large');
  assert.equal(v.results[0].state, 'drift-report');
});

test('data-anchor: unreadable anchor store fails closed, matching verifyAnchors\' posture', () => {
  writeJson(join(dir, 'rollup.json'), { a: 1 });
  anchorDataStore(join(dir, 'rollup.json'), 'rewritten');
  const _deny = denyRead(dataAnchorsPath());

  assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
  try {
    const v = verifyDataAnchors();
    assert.equal(v.state, 'anchors-unreadable');
  } finally {
    _deny.restore();
  }
});

test('data-anchor: a retired store reports as retired, never JOURNAL-GONE, and cannot mask another alarm', () => {
  const gone = join(dir, 'wt', 'annotations.json');
  const kept = join(dir, 'kept.jsonl');
  writeJson(gone, { a: 1 });
  writeFileSync(kept, 'one\ntwo\n');
  anchorDataStore(gone, 'rewritten');
  anchorDataStore(kept, 'append-only');
  rmSync(join(dir, 'wt'), { recursive: true });
  assert.equal(verifyDataAnchors().results.find((r) => r.file === gone).state, 'JOURNAL-GONE');

  const r = retireDataAnchor(gone, 'worktree removed after a stray self-sweep anchored it');
  assert.equal(r.ok, true, r.error);
  const v = verifyDataAnchors();
  assert.equal(v.state, 'ok');
  const row = v.results.find((x) => x.file === gone);
  assert.equal(row.state, 'retired');
  assert.match(row.reason, /stray self-sweep/);

  writeFileSync(kept, 'one\n');
  assert.equal(verifyDataAnchors().state, 'ALARM', 'a retirement elsewhere must not quiet a real truncation');
});

test('data-anchor: retirement refuses without a reason, while the store exists, when never anchored, and twice', () => {
  const p = join(dir, 'store.json');
  writeJson(p, { a: 1 });
  anchorDataStore(p, 'rewritten');
  const size = () => readFileSync(dataAnchorsPath(), 'utf8').length;
  const before = size();
  assert.match(retireDataAnchor(p, 'gone').error, /still exists/);
  rmSync(p);
  assert.match(retireDataAnchor(p, '  ').error, /needs a reason/);
  assert.match(retireDataAnchor(join(dir, 'never.json'), 'gone').error, /never anchored/);
  assert.equal(size(), before, 'a refused retirement appends nothing');
  assert.equal(retireDataAnchor(p, 'gone').ok, true);
  assert.match(retireDataAnchor(p, 'gone').error, /already retired/);
});

test('data-anchor: re-anchoring a retired path brings it back under verification', () => {
  const p = join(dir, 'store.json');
  writeJson(p, { a: 1 });
  anchorDataStore(p, 'rewritten');
  rmSync(p);
  retireDataAnchor(p, 'gone for now');
  writeJson(p, { a: 2 });
  anchorDataStore(p, 'rewritten');
  assert.equal(verifyDataAnchors().results.find((r) => r.file === p).state, 'intact');
  rmSync(p);
  assert.equal(verifyDataAnchors().state, 'ALARM', 'the re-anchored store is guarded again');
});

test('data-anchor: absence of anchors is its own state, never a pass', () => {
  assert.equal(verifyDataAnchors().state, 'no-anchors');
});

// ── C-5: --tally fatigue section ────────────────────────────────────────────────────────────────

test('fatigueReport: empty with zero suppression-label records, never throws', () => {
  assert.deepEqual(fatigueReport([]), { targets: [], empty: true });
  assert.deepEqual(fatigueReport([{ kind: 'adjudication', gate: 'g' }]), { targets: [], empty: true });
});

test('fatigueReport: names suppressed-without-adjudication targets, sums counts across records, includes ones with no `expires`', () => {
  const records = [
    { kind: 'suppression-label', target: 'k1', action: 'suppress', count: 3, who: 'tester', at: 't1' },
    { kind: 'suppression-label', target: 'k1', action: 'suppress', count: 2, who: 'tester', at: 't2' }, // same target, sums
    { kind: 'suppression-label', target: 'k2', action: 'suppress', count: 1, who: 'tester', at: 't3' }, // no `expires` — still counted and named
    { kind: 'suppression-label', target: 'k3', action: 'suppress', count: 9, who: 'tester', at: 't4', expires: '2099-01-01' },
    { kind: 'finding-adjudication', findingKey: 'k3', category: 'secrets', repo: 'r' }, // k3 WAS adjudicated -> excluded
  ];
  const r = fatigueReport(records);
  const byTarget = Object.fromEntries(r.targets.map((t) => [t.target, t]));
  assert.equal(byTarget.k3, undefined, 'an adjudicated target is not "suppressed-without-adjudication"');
  assert.equal(byTarget.k1.count, 5, 'counts sum across records for the same target');
  assert.equal(byTarget.k1.sentence, 'k1: suppressed 5 times, never adjudicated — adjudicate or retune');
  assert.equal(byTarget.k2.count, 1, 'a record with no expires is still counted and named');
  assert.deepEqual(r.targets.map((t) => t.target), ['k1', 'k2'], 'sorted by count, descending');
});

test('--tally renders the fatigue section with zero suppression-labels (empty state, no throw) and with fixtures', () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'verdict-journal.mjs');
  const empty = spawnSync(process.execPath, [SCRIPT, '--tally'], { env: process.env, encoding: 'utf8' });
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /fatigue \(suppressed, never adjudicated/);
  assert.match(empty.stdout, /none — either nothing suppressed yet/);

  appendRecord(adjudicationsPath(), { v: 1, kind: 'suppression-label', target: 'sc:clientD|rule|f.md', action: 'suppress', count: 4, who: 'tester', at: '2026-08-01T00:00:00Z' });
  const withFixture = spawnSync(process.execPath, [SCRIPT, '--tally'], { env: process.env, encoding: 'utf8' });
  assert.equal(withFixture.status, 0, withFixture.stderr);
  assert.match(withFixture.stdout, /suppressed 4 times, never adjudicated — adjudicate or retune/);
});

test('--tally fatigue rendering is proposal-only: running --tally (json and text) mutates NOTHING on disk', () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'verdict-journal.mjs');
  appendRecord(adjudicationsPath(), { v: 1, kind: 'suppression-label', target: 'sc:clientD|rule|f.md', action: 'suppress', count: 4, who: 'tester', at: '2026-08-01T00:00:00Z' });
  appendFindingAdjudication({ findingKey: 'other-key', category: 'secrets', repo: 'clientD', truth: 'true-clean' });
  journal('gate-tests', { verdict: 'steady' });

  const before = readFileSync(adjudicationsPath(), 'utf8');
  const journalBefore = readFileSync(join(dir, 'verdicts', 'gate-tests.jsonl'), 'utf8');
  const beforeFiles = new Set(readdirSync(dir, { recursive: true }));

  spawnSync(process.execPath, [SCRIPT, '--tally'], { env: process.env, encoding: 'utf8' });
  spawnSync(process.execPath, [SCRIPT, '--tally', '--json'], { env: process.env, encoding: 'utf8' });

  assert.equal(readFileSync(adjudicationsPath(), 'utf8'), before, 'the adjudications file is byte-identical after --tally');
  assert.equal(readFileSync(join(dir, 'verdicts', 'gate-tests.jsonl'), 'utf8'), journalBefore, 'no unrelated journal is touched either');
  const afterFiles = new Set(readdirSync(dir, { recursive: true }));
  assert.deepEqual(afterFiles, beforeFiles, 'no new file appeared anywhere under the fixture tree');
});

// ── ATTRIBUTION ADJUDICATED ALONE ───────────────────────────────────────────────────────────────
// A regression-uncommitted alarm is unjudgeable forever while its ATTRIBUTION stays checkable at
// the recorded headSha.
test('computeMetrics: an attribution-only adjudication is counted, and moves no detection rate', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', recordAt: 't1' },
    { kind: 'adjudication', gate: 'g', attributionCorrect: false, recordAt: 't2' },   // no truth: alarm unjudgeable
    { kind: 'adjudication', gate: 'g', attributionCorrect: true, recordAt: 't3' },
  ];
  const m = computeMetrics(adj, { g: 10 }, { recordAtIndex: { g: new Set(['t1', 't2', 't3']) } });
  assert.equal(m.g.attributionScored, 2, 'both ownership judgements count');
  assert.equal(m.g.attributionAccuracy, 1 / 2);
  assert.equal(m.g.adjudicated, 1, 'the detection denominator holds only the record that judged detection');
  assert.equal(m.g.attributionOnly, 2, 'and the cohort says how much of its evidence judges ownership only');
  assert.equal(m.g.catchRate, 1, 'an attribution-only record must not dilute a detection rate');
});

test('computeMetrics: a record judging neither channel is still ignored', () => {
  const m = computeMetrics([{ kind: 'adjudication', gate: 'g', basis: 'I looked and could not tell' }], { g: 5 });
  assert.deepEqual(m, {}, 'a record that judges nothing is not evidence, and must not create a cohort');
});

// ── RETRACTION ──────────────────────────────────────────────────────────────────────────────────
// An append-only chained ledger cannot delete, so a retraction kind withdraws a judgement later
// shown unreliable.
test('retraction: a withdrawn judgement stays on disk and moves no rate', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'false-clean', recordAt: 't1', method: 're-measurement' },
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', recordAt: 't2', method: 're-measurement' },
    { kind: 'adjudication-retraction', gate: 'g', recordAt: 't1', method: 're-measurement', reason: 'method did not reproduce' },
  ];
  const m = computeMetrics(adj, { g: 9 }, { recordAtIndex: { g: new Set(['t1', 't2']) } });
  assert.equal(m.g.adjudicated, 1, 'the retracted judgement is not counted');
  assert.equal(m.g['false-clean'], 0, 'its false-clean is gone from the counts');
  assert.equal(m.g.falseCleanN, 0);
  assert.equal(m.g.falseCleanRate, null, 'no clean-stratum record survives, so the rate is undefined, not 0%');
  assert.equal(m.g['true-alarm'], 1, 'the surviving judgement is untouched');
});

test('retraction: scoped by method, so withdrawing a tool`s output leaves a human judgement standing', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'false-clean', recordAt: 't1', method: 're-measurement' },
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', recordAt: 't1', adjudicatedBy: 'a human' },
    { kind: 'adjudication-retraction', gate: 'g', recordAt: 't1', method: 're-measurement', reason: 'did not reproduce' },
  ];
  const m = computeMetrics(adj, { g: 9 }, { recordAtIndex: { g: new Set(['t1']) } });
  assert.equal(m.g.adjudicated, 1);
  assert.equal(m.g['true-alarm'], 1, 'the human judgement of the same decision survives');
  assert.equal(m.g['false-clean'], 0);
});

test('retraction: an unscoped retraction withdraws every judgement of that decision', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', truth: 'false-clean', recordAt: 't1', method: 're-measurement' },
    { kind: 'adjudication', gate: 'g', truth: 'true-alarm', recordAt: 't1', adjudicatedBy: 'a human' },
    { kind: 'adjudication-retraction', gate: 'g', recordAt: 't1', reason: 'the decision itself was misfiled' },
  ];
  const m = computeMetrics(adj, { g: 9 }, { recordAtIndex: { g: new Set(['t1']) } });
  assert.deepEqual(m, {}, 'nothing judged means no cohort at all');
});

// ── ONE RATER, ONE DECISION, ONE JUDGEMENT ──────────────────────────────────────────────────────
// A rater judging the same decision twice has produced a revision, not two pieces of evidence.
test('dedupe: the same rater judging one decision twice counts once, latest winning', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'false-clean', method: 're-measurement' },
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', method: 're-measurement' },
  ];
  const m = computeMetrics(adj, { g: 9 }, { recordAtIndex: { g: new Set(['t1']) } });
  assert.equal(m.g.adjudicated, 1, 'one decision, one rater, one judgement');
  assert.equal(m.g['true-alarm'], 1, 'the later judgement is the revision and wins');
  assert.equal(m.g['false-clean'], 0);
});

test('dedupe: two DIFFERENT raters on one decision are two judgements', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'false-clean', method: 're-measurement' },
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', adjudicatedBy: 'a human' },
  ];
  const m = computeMetrics(adj, { g: 9 }, { recordAtIndex: { g: new Set(['t1']) } });
  assert.equal(m.g.adjudicated, 2, 'disagreement between raters is evidence, not noise to collapse');
});

// ── `at` IS NOT AN IDENTITY ─────────────────────────────────────────────────────────────────────
// Concurrent sessions can journal in the same millisecond, and an adjudication names its subject
// by `at` alone.
test('ambiguity: an adjudication naming a colliding instant judges nothing, and says so', () => {
  const adj = [
    { kind: 'adjudication', gate: 'g', recordAt: 'tCollide', truth: 'false-clean', method: 're-measurement' },
    { kind: 'adjudication', gate: 'g', recordAt: 't2', truth: 'true-alarm', method: 're-measurement' },
  ];
  const m = computeMetrics(adj, { g: 9 }, {
    recordAtIndex: { g: new Set(['tCollide', 't2']) },
    ambiguousRecordAts: new Set(['g@tCollide']),
  });
  assert.equal(m.g.ambiguous, 1, 'the corpus reports how much of itself is unidentified');
  assert.equal(m.g.adjudicated, 1, 'and the ambiguous one moves no rate');
  assert.equal(m.g['false-clean'], 0, 'resolving it by iteration order is what put a true-alarm in the clean stratum');
});

test('ambiguity: dedupe never collapses across a colliding instant', () => {
  // two DIFFERENT decisions share the instant — collapsing would merge judgements of different records
  const adj = [
    { kind: 'adjudication', gate: 'g', recordAt: 'tCollide', truth: 'true-alarm', method: 're-measurement' },
    { kind: 'adjudication', gate: 'g', recordAt: 'tCollide', truth: 'false-clean', method: 're-measurement' },
  ];
  const { records, collapsed } = dedupeJudgements(adj, { ambiguous: new Set(['g@tCollide']) });
  assert.equal(collapsed, 0, 'nothing may be collapsed on a key that names two decisions');
  assert.equal(records.length, 2);
});

// ── ROTATION ARCHIVES, IT DOES NOT OVERWRITE (operator ruling, 2026-08-19) ───────────────────────
// Single-generation rotation renamed over `.1` and destroyed it — fine for a log, not for a
// ledger of ground truth.
test('rotation: a second rotation preserves the first generation instead of overwriting it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rot-'));
  try {
    const p = join(dir, 'adjudications.jsonl');
    const opts = { maxBytes: 400 };   // small, so rotation is reachable in a test
    const write = (tag) => appendRecord(p, { v: 1, kind: 'adjudication', gate: 'g', tag }, opts);
    // Generation 1
    for (let i = 0; i < 6; i++) write(`gen1-${i}`);
    assert.ok(existsSync(`${p}.1`), 'first rotation should produce .1');
    const gen1 = readFileSync(`${p}.1`, 'utf8');
    // Generation 2 — this is the write that used to destroy gen1
    for (let i = 0; i < 6; i++) write(`gen2-${i}`);
    assert.ok(existsSync(`${p}.2`), 'the older generation must be archived, not renamed over');
    assert.equal(readFileSync(`${p}.2`, 'utf8'), gen1, 'and it must be byte-identical to what it was');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rotation: readJournal reads EVERY generation, oldest first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rot2-'));
  try {
    const p = join(dir, 'g.jsonl');
    const opts = { maxBytes: 400 };
    const tags = [];
    for (let i = 0; i < 18; i++) { tags.push(`t${i}`); appendRecord(p, { v: 1, kind: 'adjudication', gate: 'g', tag: `t${i}` }, opts); }
    const j = readJournal('g', { dir });
    assert.ok(j.rotations >= 2, `expected multiple generations, got ${j.rotations}`);
    assert.equal(j.records.length, tags.length, 'no record may be lost to rotation');
    assert.deepEqual(j.records.map((r) => r.tag), tags, 'and they must stay in time order, oldest first');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readAdjudications reaches across the rotation boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-adjrot-'));
  try {
    const p = adjudicationsPath(dir);
    const opts = { maxBytes: 400 };
    for (let i = 0; i < 12; i++) appendRecord(p, { v: 1, kind: 'adjudication', gate: 'g', truth: 'true-alarm', recordAt: `t${i}` }, opts);
    assert.ok(existsSync(`${p}.1`), 'the fixture must actually rotate, or this test proves nothing');
    assert.equal(readJournalFile(p).records.length < 12, true, 'the single-file reader sees only the live tail — this is the defect');
    assert.equal(readAdjudications(dir).records.length, 12, 'the generation-aware reader sees the whole corpus');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── A JUDGEMENT IS ARCHIVED THE MOMENT IT IS BANKED (operator ruling, 2026-08-19) ────────────────
// Rotation-archiving removed the deletion, not the DEPENDENCE on rotation behaving.
test('archive: a judgement is written to the durable archive at bank time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-jarch-'));
  try {
    const p = adjudicationsPath(dir);
    const r = appendRecord(p, { v: 1, kind: 'adjudication', at: '2026-08-19T12:00:00.000Z', gate: 'g', truth: 'true-alarm', recordAt: 't1' });
    assert.equal(r.ok, true);
    assert.ok(r.archive, 'the append must report where it archived to');
    assert.equal(readFileSync(r.archive, 'utf8').split('\n').filter(Boolean).length, 1);
    assert.match(r.archive, /judgements[/\\]2026-08\.jsonl$/, 'segmented by month so no segment grows without bound');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Gate verdicts regenerate every run — archiving them would bury the irreplaceable judgements.
test('archive: a non-judgement record is not archived', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-jarch2-'));
  try {
    const p = adjudicationsPath(dir);
    const r = appendRecord(p, { v: 1, kind: 'gate-verdict', at: '2026-08-19T12:00:00.000Z', gate: 'g' });
    assert.equal(r.ok, true);
    assert.equal(r.archive, undefined, 'only JUDGEMENT_KINDS are archived');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The ledger write lands first, and an archive failure is reported, never silent.
test('archive: the ledger write survives an archive failure, and the failure is reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-jarch3-'));
  try {
    const p = adjudicationsPath(dir);
    // Occupy the archive directory's path with a FILE, so mkdir/append there must fail.
    writeFileSync(join(dir, 'judgements'), 'not a directory');
    const r = appendRecord(p, { v: 1, kind: 'adjudication', at: '2026-08-19T12:00:00.000Z', gate: 'g', truth: 'true-alarm', recordAt: 't1' });
    assert.equal(r.ok, true, 'the primary write must still succeed — durability is not worth the record');
    assert.ok(r.archiveError, 'and the archive failure must be named, not swallowed');
    assert.equal(readJournalFile(p).records.length, 1, 'the judgement is in the ledger regardless');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── RATER RELIABILITY ───────────────────────────────────────────────────────────────────────────
// With zero overlap between raters, reliability is undefined — not low.
test('rater: with no shared decision, reliability is UNMEASURED and never a number', () => {
  const r = raterReliability([
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', method: 'A' },
    { kind: 'adjudication', gate: 'g', recordAt: 't2', truth: 'false-clean', method: 'B' },
  ]);
  assert.equal(r.A.judged, 1);
  assert.equal(r.A.overlap, 0);
  assert.equal(r.A.unmeasured, true);
  assert.equal(r.A.reliability, null, 'zero shared decisions is no denominator — a number here would be the most flattering one available');
});

test('rater: agreement is computed only where two raters judged the SAME decision', () => {
  const r = raterReliability([
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', method: 'A' },
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', method: 'B' },
    { kind: 'adjudication', gate: 'g', recordAt: 't2', truth: 'true-alarm', method: 'A' },
    { kind: 'adjudication', gate: 'g', recordAt: 't2', truth: 'false-clean', method: 'B' },
  ]);
  assert.equal(r.A.overlap, 2, 'two decisions were judged by both');
  assert.equal(r.A.reliability, 0.5, 'they agreed on one of the two');
  assert.equal(r.B.reliability, 0.5, 'and the figure is symmetric');
});

// A rater who detects correctly and attributes wrongly has not half-agreed.
test('rater: attribution agreement is tracked separately from truth agreement', () => {
  const r = raterReliability([
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', attributionCorrect: true, method: 'A' },
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', attributionCorrect: false, method: 'B' },
  ]);
  assert.equal(r.A.reliability, 1, 'they agreed the alarm was true');
  assert.equal(r.A.pairs[0].attributionAgreement, 0, 'and disagreed about whose it was — not the same measurement');
});

// GOLD truth is constructed: agreement with gold approaches accuracy; peer agreement is only consistency.
test('rater: a gold rater is marked, and agreement against it is flagged as such', () => {
  const r = raterReliability([
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', canary: 'T-REG', adjudicatedBy: 'canary-harness' },
    { kind: 'adjudication', gate: 'g', recordAt: 't1', truth: 'true-alarm', method: 'A' },
  ], { gold: ['canary-harness'] });
  assert.equal(r['canary-harness'].isGold, true);
  assert.equal(r.A.isGold, false);
  assert.equal(r.A.pairs[0].againstGold, true, 'agreement with constructed truth is a different claim from agreement with a peer');
});

// ── COVERAGE: AN AGREEMENT RATE OVER A COHORT THE RATER CHOSE ────────────────────────────────────
// An abstention excluded from the denominator leaves "the decisions this rater felt sure about".
const judged = (rater, recordAt, truth) => ({ kind: 'adjudication', method: rater, gate: 'g', recordAt, truth });
const declined = (rater, recordAt) => ({ kind: 'adjudication-abstention', method: rater, gate: 'g', recordAt, reason: 'evidence did not settle it' });

test('rater: a decline is counted, so agreement cannot be quoted over a cohort the rater selected', () => {
  const r = raterReliability([
    judged('peer', 'r1', 'true-alarm'), judged('peer', 'r2', 'true-alarm'), judged('peer', 'r3', 'true-alarm'),
    judged('shy', 'r1', 'true-alarm'),                       // agrees on the one it answered
    declined('shy', 'r2'), declined('shy', 'r3'),            // and refused the other two
  ]);
  assert.equal(r.shy.reliability, 1, 'it did agree on everything it answered — the figure is not wrong');
  assert.equal(r.shy.overlapDecisions, 1);
  assert.equal(r.shy.declinedOverlap, 2, 'and it refused two, which is the half that used to vanish');
  assert.equal(Number(r.shy.coverage.toFixed(4)), 0.3333, 'so coverage is a third, and 100% means 100% of a third');
});

test('rater: no recorded declines means coverage UNKNOWN, never 100%', () => {
  const r = raterReliability([
    judged('peer', 'r1', 'true-alarm'), judged('quiet', 'r1', 'true-alarm'),
  ]);
  assert.equal(r.quiet.abstentionsRecorded, 'unknown', 'nothing here shows this rater declines nothing');
  assert.equal(r.quiet.coverage, null, 'and coverage is null — never 1, which would be the flattering guess');
});

test('rater: once a rater records ANY decline, its coverage becomes computable', () => {
  const r = raterReliability([
    judged('peer', 'r1', 'true-alarm'), judged('peer', 'r2', 'true-alarm'),
    judged('talks', 'r1', 'true-alarm'), declined('talks', 'r2'),
  ]);
  assert.equal(r.talks.abstentionsRecorded, 'yes');
  assert.equal(r.talks.coverage, 0.5);
});

test('rater: declining everything is a distinct state from never having been cross-checked', () => {
  const r = raterReliability([
    judged('peer', 'r1', 'true-alarm'),
    declined('refuser', 'r1'),
    judged('lonely', 'r9', 'true-alarm'),
  ]);
  assert.equal(r.refuser?.declinedAll, true, 'refused every decision it was cross-checked on');
  assert.equal(r.lonely.unmeasured, true, 'whereas this one was never cross-checked at all');
  assert.notEqual(r.refuser?.declinedAll, r.lonely.declinedAll, 'the two must not render alike');
});

// Re-ingestion appends abstentions again; a Set collapses them where a counter would not.
test('abstentionsByRater collapses a decline recorded twice, and ignores unattributable ones', () => {
  const { declined: d, recording } = abstentionsByRater([
    declined('a', 'r1'), declined('a', 'r1'), declined('a', 'r2'),
    { kind: 'adjudication-abstention', gate: 'g', recordAt: 'r3' },     // no rater — belongs to nobody
    judged('a', 'r4', 'true-alarm'),                                    // not an abstention
  ]);
  assert.equal(d.get('a').size, 2, 'one decline per decision, however many times it was written');
  assert.ok(recording.has('a'));
  assert.equal(recording.size, 1, 'an unattributable decline does not make some rater a decline-recorder');
});

test('adding abstention records moves NO existing rate', () => {
  const base = [
    judged('peer', 'r1', 'true-alarm'), judged('peer', 'r2', 'false-clean'),
    judged('other', 'r1', 'true-alarm'),
  ];
  const withDeclines = [...base, declined('peer', 'r7'), declined('other', 'r8'), declined('peer', 'r9')];
  assert.deepEqual(
    JSON.parse(JSON.stringify(computeMetrics(withDeclines))),
    JSON.parse(JSON.stringify(computeMetrics(base))),
    'every headline rate must be byte-identical — abstentions are a separate kind for exactly this reason',
  );
});

// ── COHORTS: "THE SAME 45 DECISIONS" IS A CLAIM ABOUT A MOMENT ───────────────────────────────────
// The cohort id — a hash of the sorted decision ids a rater was GIVEN — pins the asked-set to the
// record, so coverage is verdicts/asked: computed, not inferred from abstention presence.
test('cohortId is order- and duplicate-insensitive, and an empty asked-set has no cohort', () => {
  const a = cohortId(['g@t2', 'g@t1']);
  assert.equal(a, cohortId(['g@t1', 'g@t2', 'g@t1']), 'the SET was asked, not the sequence');
  assert.notEqual(a, cohortId(['g@t1']), 'a different asked-set is a different cohort');
  assert.equal(cohortId([]), null, 'no asked-set, no cohort — null, never a hash of nothing');
  assert.equal(cohortId(), null);
});

const judgedIn = (rater, recordAt, truth, cohort, cohortSize) => ({ ...judged(rater, recordAt, truth), cohort, cohortSize });
const declinedIn = (rater, recordAt, cohort, cohortSize) => ({ ...declined(rater, recordAt), cohort, cohortSize });

test('rater: comparing records from different cohorts WARNS; the same cohort does not', () => {
  const r = raterReliability([
    judgedIn('A', 'r1', 'true-alarm', 'c-one', 2),
    judgedIn('B', 'r1', 'true-alarm', 'c-two', 5),
  ]);
  assert.equal(r.A.pairs[0].crossCohort, true, 'the two raters were ASKED different sets — the agreement pools an intersection neither chose');
  const same = raterReliability([
    judgedIn('A', 'r1', 'true-alarm', 'c-one', 2),
    judgedIn('B', 'r1', 'true-alarm', 'c-one', 2),
  ]);
  assert.equal(same.A.pairs[0].crossCohort, false);
  assert.equal(same.A.pairs[0].cohortUnknown, false);
});

// A record with no cohort stamp is UNKNOWN — every record written before 2026-08-20 is in this state.
test('rater: a record without a cohort makes the pair cohort-UNKNOWN, never same or different', () => {
  const r = raterReliability([
    judgedIn('A', 'r1', 'true-alarm', 'c-one', 2),
    judged('B', 'r1', 'true-alarm'),               // pre-cohort record
  ]);
  assert.equal(r.A.pairs[0].crossCohort, false, 'unknown must not masquerade as a measured difference');
  assert.equal(r.A.pairs[0].cohortUnknown, true, 'and must not masquerade as sameness either');
});

test('rater: cohort coverage is verdicts over asked — computed from the record, not inferred from abstentions', () => {
  const r = raterReliability([
    judgedIn('A', 'r1', 'true-alarm', 'c-one', 4),
    judgedIn('A', 'r2', 'false-clean', 'c-one', 4),
    declinedIn('A', 'r3', 'c-one', 4),
  ]);
  const c = r.A.cohorts['c-one'];
  assert.equal(c.size, 4, 'the denominator is what was ASKED');
  assert.equal(c.verdicts, 2);
  assert.equal(c.declines, 1);
  assert.equal(c.coverage, 0.5, '2 verdicts of 4 asked — the fourth (asked, no verdict, no decline) is what the old proxy could never see');
});

test('rater: a re-ingested duplicate does not inflate cohort coverage', () => {
  const r = raterReliability([
    judgedIn('A', 'r1', 'true-alarm', 'c-one', 2),
    judgedIn('A', 'r1', 'true-alarm', 'c-one', 2),   // the same judgement, banked twice
    declinedIn('A', 'r2', 'c-one', 2),
    declinedIn('A', 'r2', 'c-one', 2),
  ]);
  const c = r.A.cohorts['c-one'];
  assert.equal(c.verdicts, 1, 'one decision, however many times it was written');
  assert.equal(c.declines, 1);
  assert.equal(c.coverage, 0.5);
});

test('rater: records disagreeing about a cohort\'s size yield NO coverage, not a chosen one', () => {
  const r = raterReliability([
    judgedIn('A', 'r1', 'true-alarm', 'c-one', 4),
    judgedIn('A', 'r2', 'true-alarm', 'c-one', 9),
  ]);
  const c = r.A.cohorts['c-one'];
  assert.equal(c.size, null, 'a contradicted size is no size');
  assert.equal(c.coverage, null, 'and no denominator means no rate — never the flattering pick');
});

test('rater: a cohort recorded without a size still groups, but its coverage is null', () => {
  const r = raterReliability([judgedIn('A', 'r1', 'true-alarm', 'c-one', undefined)]);
  const c = r.A.cohorts['c-one'];
  assert.equal(c.verdicts, 1);
  assert.equal(c.coverage, null, 'verdicts over an unrecorded denominator is not a figure');
});

// ── THE SECRETS GATE IS ON THE ROSTER ──────────────────────────────────────────────────────────
// A gate that journals but is absent from GATE_ROSTER is invisible to journalHealth.
test('pre-publish is on GATE_ROSTER, with no baseline by construction', () => {
  const entry = GATE_ROSTER.find((g) => g.gate === 'pre-publish');
  assert.ok(entry, 'pre-publish journals gate verdicts and must be visible to journalHealth');
  assert.equal(entry.baseline, null, 'pre-publish gates an act, not an artifact against a floor');
});

test('journalHealth renders a never-written pre-publish as ABSENT, not as ok', () => {
  const roster = GATE_ROSTER.filter((g) => g.gate === 'pre-publish');
  const [h] = journalHealth({ roster, dir: join(dir, 'no-prepublish-yet') });
  assert.equal(h.state, 'absent-not-running');
  assert.equal(h.entries, 0);
});

// ── THE ARCHIVE CHAINS ON ITS OWN TAIL (2026-09-12) ──────────────────────────────────────────────
// It used to copy the live line verbatim, so its `prev` was the live ledger's link and every live
// rotation, non-judgement row, month boundary and re-link read as a break in the archive. Two
// sessions investigated 62 such breaks as tampering. None was an edit of the archive.
test('archive: verifies as its own chain across live non-judgement rows and a live rotation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-jarch4-'));
  try {
    const p = adjudicationsPath(dir);
    const opts = { maxBytes: 400 };                       // small, so the live ledger rotates under the archive
    const at = (i) => `2026-08-19T12:00:${String(i).padStart(2, '0')}.000Z`;
    let n = 0;
    for (let i = 0; i < 14; i++) {
      // every third live row is a kind the archive never receives — the exact shape that broke it
      const rec = i % 3 === 2
        ? { v: 1, kind: 'suppression-label', at: at(i), gate: 'g', pad: 'x'.repeat(60) }
        : { v: 1, kind: 'adjudication', at: at(i), gate: 'g', truth: 'true-alarm', recordAt: `t${i}`, pad: 'x'.repeat(60) };
      const r = appendRecord(p, rec, opts);
      assert.equal(r.ok, true);
      if (rec.kind === 'adjudication') { n++; assert.ok(r.archive); }
    }
    assert.ok(existsSync(`${p}.1`), 'the live ledger must actually rotate, or this proves nothing');
    const arch = readJournalFile(join(dir, 'judgements', '2026-08.jsonl'));
    assert.equal(arch.records.length, n);
    assert.equal(arch.chain.broken, 0, 'a live rotation or a skipped live row is not a break in the archive');
    assert.equal(arch.chain.verified, n);
    const v = verifyJudgementArchive({ dir });
    assert.deepEqual(v.months.map((m) => [m.month, m.records, m.verified, m.broken]), [['2026-08', n, n, 0]]);
    assert.deepEqual(v.months[0].legacy, { rotation: 0, nonJudgement: 0, resealed: 0, restart: 0, monthBoundary: 0 }, 'new rows need no explaining');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('archive: a row still resolves to the live line it copies — same bytes with prev := livePrev', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-jarch5-'));
  try {
    const p = adjudicationsPath(dir);
    appendRecord(p, { v: 1, kind: 'suppression-label', at: '2026-08-19T12:00:00.000Z', gate: 'g' });
    const r = appendRecord(p, { v: 1, kind: 'adjudication', at: '2026-08-19T12:00:01.000Z', gate: 'g', truth: 'true-alarm', recordAt: 't1' });
    const liveLine = readFileSync(p, 'utf8').split('\n').filter(Boolean).at(-1);
    const archLine = readFileSync(r.archive, 'utf8').split('\n').filter(Boolean).at(-1);
    const a = JSON.parse(archLine);
    assert.equal(a.prev, 'genesis', 'first row of a month starts the archive chain');
    assert.equal(a.livePrev, JSON.parse(liveLine).prev, 'and keeps the live link by name');
    const { livePrev, ...rest } = a;
    assert.equal(JSON.stringify({ ...rest, prev: livePrev }), liveLine, 'the live line is recoverable byte for byte');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verifyJudgementArchive: legacy rows are explained against the live generations; a real break stays broken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-jarch6-'));
  try {
    const p = adjudicationsPath(dir);
    const H = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
    // A live ledger written the old way, by hand: judgement, suppression-label, judgement.
    const l1 = JSON.stringify({ v: 1, kind: 'adjudication', at: '2026-07-01T00:00:00.000Z', gate: 'g', prev: 'genesis' });
    const l2 = JSON.stringify({ v: 1, kind: 'suppression-label', at: '2026-07-01T00:00:01.000Z', gate: 'g', prev: H(l1) });
    const l3 = JSON.stringify({ v: 1, kind: 'adjudication', at: '2026-07-01T00:00:02.000Z', gate: 'g', prev: H(l2) });
    const l4 = JSON.stringify({ v: 1, kind: 'adjudication', at: '2026-07-01T00:00:03.000Z', gate: 'g', prev: H(l3), resealed: { was: 'deadbeefdeadbeefdeadbeefdeadbeef', from: 'test', at: '2026-07-02T00:00:00.000Z' } });
    writeFileSync(p, `${[l1, l2, l3, l4].join('\n')}\n`);
    mkdirSync(join(dir, 'judgements'));
    // The legacy archive: verbatim copies of l1, l3 (prev names l2, which it never received),
    // a copy of l4 as it was before its relink, one row whose prev names nothing anywhere,
    // and a mid-file genesis (a live restart).
    const l4pre = JSON.stringify({ v: 1, kind: 'adjudication', at: '2026-07-01T00:00:03.000Z', gate: 'g', prev: 'deadbeefdeadbeefdeadbeefdeadbeef' });
    const bogus = JSON.stringify({ v: 1, kind: 'adjudication', at: '2026-07-01T00:00:04.000Z', gate: 'g', prev: 'no-such-hash-anywhere-0000000000' });
    const restart = JSON.stringify({ v: 1, kind: 'adjudication', at: '2026-07-01T00:00:05.000Z', gate: 'g', prev: 'genesis' });
    writeFileSync(join(dir, 'judgements', '2026-07.jsonl'), `${[l1, l3, l4pre, bogus, restart].join('\n')}\n`);
    const v = verifyJudgementArchive({ dir });
    assert.equal(v.months.length, 1);
    const m = v.months[0];
    assert.equal(m.records, 5);
    assert.equal(m.verified, 1, 'only the genesis row verifies on its own');
    assert.deepEqual(m.legacy, { rotation: 0, nonJudgement: 1, resealed: 1, restart: 1, monthBoundary: 0 });
    assert.equal(m.broken, 1, 'a prev that resolves nowhere is still a break');
    assert.deepEqual(m.brokenAt, [4]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
