// rate-llm — the second rater's evidence handling. The endpoint is not mocked: the model's
// behaviour was probed against the real LM Studio instance and recorded in bin/rate-llm.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  peerEvidence, extractJSON, evidenceFor, targetPool, SYSTEM,
  renderMeasurement, extractMeasurement, CONCLUSION_PHRASES,
} from '../rate-llm.mjs';
import { judge, STRATA } from '../adjudicate-gates.mjs';
import { appendRecord, readJournalFile, cohortId } from '../lib/verdict-journal-core.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'rate-llm.mjs');

const hasConclusion = (s) => CONCLUSION_PHRASES.find((p) => String(s).toLowerCase().includes(p.toLowerCase())) || null;

// ── THE MEASUREMENT CHANNEL (external development task ledger cw-adjudication-integrity-20260813 task 14) ───────────────
// A rater shown a conclusion agrees with a label, not evidence — the preferred channel is the
// structured `measurement`, rendered into a rater-facing sentence IN CODE.
test('a measurement renders as numbers and names, never as a conclusion', () => {
  const s = renderMeasurement({ sha: 'abc1234abc1234', floor: 1, fail: 3, pass: 1288, corroboratedTests: ['taxonomy render escapes'] });
  assert.ok(s.includes('3 failing') && s.includes('1288 passing') && s.includes('floor of 1'), 'every figure must cross');
  assert.ok(s.includes('taxonomy render escapes'), 'and the corroborated test names');
  assert.equal(hasConclusion(s), null, `the rendered sentence leaked a conclusion phrase: ${hasConclusion(s)}`);
});

test('a malformed measurement renders null — fail closed, never a guessed sentence', () => {
  assert.equal(renderMeasurement(null), null);
  assert.equal(renderMeasurement({}), null);
  assert.equal(renderMeasurement({ fail: 3 }), null, 'a fail count with no floor is not a comparison');
  assert.equal(renderMeasurement({ fail: 'three', floor: 1 }), null, 'numbers are numbers');
});

test('the structured measurement wins over the prose evidence field', () => {
  const e = peerEvidence({
    measurement: { sha: 'abc1234', floor: 1, fail: 3, pass: 1288, corroboratedTests: [] },
    evidence: 'the gate called the tree steady against a floor of 1, but committed HEAD at abc1234 re-measures 3 failing — a committed regression was already present and this run stayed quiet about it',
  });
  assert.ok(e.includes('3 failing'), 'the numbers cross');
  assert.equal(hasConclusion(e), null, 'the prose conclusion does not');
});

// Legacy records have only prose — it crosses only via the validating extractor, or yields null.
test('legacy prose crosses only via the validating extractor, re-rendered clean', () => {
  const shapes = [
    're-ran the suite at fedcba98 twice: 8 failing, 2100 passing, against the floor of 0 the record compared to; the failing tests correspond to the ones the record named (registry coverage)',
    'the gate called the tree steady against a floor of 0, but committed HEAD at fedcba98 re-measures 8 failing on tests a sibling record from that same commit also named (x) — a committed regression was already present and this run stayed quiet about it',
    'the alarm is unjudgeable (its working tree is gone), but pristine HEAD re-measures 0 failing at aa11bb22 against a floor of 0; the record claimed HEAD sat at 0 (HEAD clean now, as the record said)',
    're-derived docs-doctor at 0abc123: green, matching the recorded verdict — the gate read the tree correctly',
  ];
  for (const evidence of shapes) {
    const e = peerEvidence({ evidence });
    assert.ok(e, `a prose shape the peer actually wrote was not recoverable:\n  ${evidence.slice(0, 90)}`);
    assert.equal(hasConclusion(e), null, `legacy prose leaked "${hasConclusion(e)}" through:\n  ${evidence.slice(0, 90)}`);
  }
  // And the same shapes reachable only through `basis` (the oldest records) still cross clean.
  const viaBasis = peerEvidence({ basis: `RE-MEASURED at fedcba9876543a: ${shapes[0]}. Method: bin/adjudicate-gates.mjs --verify (…).` });
  assert.ok(viaBasis && viaBasis.includes('8 failing') && !/Method:/.test(viaBasis));
});

test('extractMeasurement validates or refuses — a number it cannot pin is not a measurement', () => {
  assert.deepEqual(extractMeasurement('re-ran the suite at abc1234 twice: 8 failing, 2100 passing, against the floor of 0'), { floor: 0, fail: 8, pass: 2100 });
  assert.deepEqual(extractMeasurement('steady against a floor of 1, but committed HEAD at abc1234 re-measures 3 failing'), { floor: 1, fail: 3 });
  assert.equal(extractMeasurement('committed HEAD at abc1234 re-measures 3 failing'), null,
    'a fail count with no floor anywhere is not a comparison — refuse, never guess a floor');
  assert.equal(extractMeasurement('the structured one'), null);
  assert.equal(extractMeasurement('CANARY T-REG (truth by construction): planted a regression.'), null);
  assert.equal(extractMeasurement(''), null);
});

// null is load-bearing — skipping costs one data point, not skipping poisons the statistic.
test('unrecoverable evidence yields null, so the caller can refuse to compare', () => {
  assert.equal(peerEvidence({ basis: 'CANARY T-REG (truth by construction): planted a regression.' }), null);
  assert.equal(peerEvidence({ evidence: 'the structured one' }), null, 'prose with no validated figures is not evidence a rater can be shown');
  assert.equal(peerEvidence({ basis: '' }), null);
  assert.equal(peerEvidence({}), null);
  assert.equal(peerEvidence(null), null);
});

// ── THE GATE: no rater prompt may contain any conclusion phrase ──────────────────────────────────
// Built from what judge() ACTUALLY emits, banked both ways (modern + legacy), full prompt swept.
test('GATE: no rater-facing prompt contains a conclusion phrase, for modern or legacy records', () => {
  const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12';
  const cases = [
    { rec: { gate: 'gate-tests', verdict: 'steady', at: 't1', headSha: SHA, baseline: { fail: 1, pass: 1200 }, names: [], fail: 1, pass: 1200 },
      measured: { ok: true, fail: 3, pass: 1288, names: ['x'] }, stratum: STRATA.ATTRIBUTION_ONLY, corroborating: ['x'] },
    { rec: { gate: 'gate-tests', verdict: 'regression-committed', at: 't2', headSha: SHA, baseline: { fail: 0, pass: 100 }, committed: ['y'], fail: 2, pass: 99 },
      measured: { ok: true, fail: 2, pass: 99, names: ['y'] }, stratum: STRATA.VERIFIABLE },
    { rec: { gate: 'gate-tests', verdict: 'regression-committed', at: 't3', headSha: SHA, baseline: { fail: 0, pass: 100 }, committed: [], fail: 1, pass: 99 },
      measured: { ok: true, fail: 0, pass: 100, names: [] }, stratum: STRATA.VERIFIABLE },
    { rec: { gate: 'gate-tests', verdict: 'regression-uncommitted', at: 't4', headSha: SHA, headFail: 0, baseline: { fail: 0, pass: 50 }, fail: 2, pass: 48 },
      measured: { ok: true, fail: 0, pass: 50, names: [] }, stratum: STRATA.ATTRIBUTION_ONLY },
    { rec: { gate: 'docs-doctor', verdict: 'green', at: 't5', headSha: SHA },
      measured: { ok: true, docs: { ok: true, verdict: 'green' } }, stratum: STRATA.VERIFIABLE },
  ];
  let prompts = 0;
  for (const { rec, measured, stratum, corroborating = [] } of cases) {
    const v = judge(rec, measured, stratum, { corroborating });
    assert.ok(v && !v.undecidable, `fixture must reach a judgement (${rec.verdict})`);
    for (const banked of [
      { evidence: v.evidence, measurement: v.measurement },   // modern record
      { evidence: v.evidence },                               // legacy: prose only
    ]) {
      const numbers = peerEvidence(banked);
      if (numbers == null) continue;                          // declining is always an allowed outcome
      const prompt = evidenceFor(rec, numbers);
      prompts++;
      const leak = hasConclusion(prompt);
      assert.equal(leak, null, `the prompt for a ${rec.gate}/${rec.verdict} record leaked "${leak}":\n${prompt}`);
    }
  }
  assert.ok(prompts >= cases.length, 'the gate must actually sweep prompts — a gate over zero prompts gates nothing');
});

// The model is judged on evidence, never on anyone's conclusion.
test('the prompt carries evidence and leaks no verdict', () => {
  const rec = {
    gate: 'gate-tests', at: 't1', headSha: 'abc1234', fail: 7, pass: 2244,
    baseline: { fail: 0, pass: 2174 }, committed: ['registry coverage'],
    verdict: 'regression-committed', headline: 'commitwork tests: 7 failing — THIS TURN ADDED DEBT',
  };
  const p = evidenceFor(rec, 're-ran the suite twice: 7 failing');
  assert.ok(p.includes('7 failing') && p.includes('2174'), 'the numbers must cross');
  assert.ok(p.includes('registry coverage'), 'and the failing test names');
  assert.ok(!p.includes('regression-committed'), 'the gate`s verdict must NOT cross');
  assert.ok(!p.includes('ADDED DEBT'), 'nor its headline wording');
  assert.ok(!/true-alarm|false-clean/.test(p), 'nor any prior rater`s label');
});

test('extractJSON takes the first balanced object and refuses garbage', () => {
  assert.deepEqual(extractJSON('noise {"truth":"true-alarm","why":"x"} trailing'), { truth: 'true-alarm', why: 'x' });
  assert.deepEqual(extractJSON('{"a":{"b":1}}'), { a: { b: 1 } });
  assert.equal(extractJSON('no json here'), null);
  assert.equal(extractJSON('{"unterminated": '), null);
  assert.equal(extractJSON(''), null);
  assert.equal(extractJSON(null), null);
});

// ── THE TARGET SET ───────────────────────────────────────────────────────────────────────────────
// A rater comparison is only a comparison of RATERS if every rater judged the same decisions.
const peer = (recordAt, truth, at) => ({ kind: 'adjudication', method: 're-measurement', gate: 'gate-tests', recordAt, truth, at });

test('a decision the peer judged twice is ONE target, not two', () => {
  const { pool } = targetPool([
    peer('r1', 'true-alarm', '2026-08-13T00:00:00Z'),
    peer('r1', 'true-alarm', '2026-08-14T00:00:00Z'),
    peer('r2', 'false-clean', '2026-08-13T00:00:00Z'),
  ]);
  assert.equal(pool.length, 2, 'the pool counts decisions, never peer records');
  assert.equal(pool.find((p) => p.recordAt === 'r1').at, '2026-08-14T00:00:00Z',
    'and the later judgement wins — a re-judgement revises its predecessor');
});

// Zero are contested today, which is exactly why the branch needs a test.
test('a decision the peer judged twice AND disagreed with itself is dropped, not resolved', () => {
  const { pool, contested } = targetPool([
    peer('r1', 'true-alarm', '2026-08-13T00:00:00Z'),
    peer('r1', 'false-clean', '2026-08-14T00:00:00Z'),
    peer('r2', 'true-clean', '2026-08-13T00:00:00Z'),
  ]);
  assert.deepEqual(pool.map((p) => p.recordAt), ['r2'], 'a contested decision has no single label to agree with');
  assert.deepEqual(contested, ['gate-tests@r1'], 'and is NAMED, so the corpus reports its own ambiguity');
});

test('only the peer rater, only settled truths, and unidentifiable records never enter the pool', () => {
  const { pool } = targetPool([
    peer('r1', 'true-alarm', 't'),
    { ...peer('r2', 'true-alarm', 't'), method: 'lmstudio:qwen' },  // a different rater is not the peer
    peer('r3', 'undecidable', 't'),                                  // a non-verdict is not a target
    { ...peer('r4', 'true-alarm', 't'), recordAt: undefined },       // names no decision
    { ...peer('r5', 'true-alarm', 't'), gate: undefined },
  ]);
  assert.deepEqual(pool.map((p) => p.recordAt), ['r1']);
});

// Sorted by the judged decision's own timestamp, so raters run days apart see the same order.
test('the pool is ordered by the judged decision, not by when the peer got around to judging it', () => {
  const { pool } = targetPool([
    peer('2026-08-11T09:00:00Z', 'true-alarm', '2026-08-19T00:00:00Z'),
    peer('2026-08-10T09:00:00Z', 'true-clean', '2026-08-13T00:00:00Z'),
  ]);
  assert.deepEqual(pool.map((p) => p.recordAt), ['2026-08-10T09:00:00Z', '2026-08-11T09:00:00Z']);
});

// ── COHORTS: BOTH WRITERS STAMP THE ASKED-SET (external development task ledger task 16) ────────────────────────────────
// Every record carries `cohort` (hash of the asked decision ids) and `cohortSize`, wired into
// BOTH writers and tested through the CLI — the two paths have already disagreed once.
const peerRecord = (recordAt, truth) => ({
  v: 1, kind: 'adjudication', at: `banked-${recordAt}`, gate: 'gate-tests', recordAt, truth,
  method: 're-measurement', adjudicatedBy: 'adjudicate-gates',
  measurement: { sha: 'abc1234abc1234', floor: 0, fail: 2, pass: 99, corroboratedTests: ['y'] },
});

const run = (args, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env } });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});

test('the --ingest writer stamps cohort and cohortSize on verdicts AND abstentions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rate-cohort-'));
  try {
    const ledger = join(dir, 'adjudications.jsonl');
    for (const r of [peerRecord('t1', 'true-alarm'), peerRecord('t2', 'false-clean')]) {
      assert.equal(appendRecord(ledger, r).ok, true);
    }
    const asked = join(dir, 'dump.json');
    writeFileSync(asked, JSON.stringify({ v: 1, items: [{ id: 'gate-tests@t1' }, { id: 'gate-tests@t2' }] }));
    const verdicts = join(dir, 'verdicts.json');
    writeFileSync(verdicts, JSON.stringify([
      { id: 'gate-tests@t1', truth: 'false-alarm', why: 'w', counterfactual: 'c' },
      { id: 'gate-tests@t2', truth: 'undecidable', why: 'unsure', counterfactual: 'c' },
    ]));
    const r = await run(['--ingest', verdicts, '--rater', 'subagent-x', '--asked', asked, '--write'], { CW_VERDICT_DIR: dir });
    assert.equal(r.code, 0, `ingest failed:\n${r.out}\n${r.err}`);
    const banked = readJournalFile(ledger).records.filter((x) => x.adjudicatedBy === 'subagent-x');
    const expect = cohortId(['gate-tests@t1', 'gate-tests@t2']);
    assert.equal(banked.length, 2, 'one verdict and one abstention');
    for (const b of banked) {
      assert.equal(b.cohort, expect, `${b.kind} must carry the cohort it was asked as part of`);
      assert.equal(b.cohortSize, 2, 'and the asked COUNT, so verdicts/asked is a computable rate');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A cohort computed from the answers would hash the self-selected set — no asked-set, no ingest.
test('--ingest without --asked refuses, rather than minting a cohort from the answers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rate-cohort-'));
  try {
    const ledger = join(dir, 'adjudications.jsonl');
    assert.equal(appendRecord(ledger, peerRecord('t1', 'true-alarm')).ok, true);
    const verdicts = join(dir, 'verdicts.json');
    writeFileSync(verdicts, JSON.stringify([{ id: 'gate-tests@t1', truth: 'false-alarm', why: 'w', counterfactual: 'c' }]));
    const r = await run(['--ingest', verdicts, '--rater', 'subagent-x', '--write'], { CW_VERDICT_DIR: dir });
    assert.notEqual(r.code, 0, 'an ingest with no asked-set must not bank cohortless records');
    const banked = readJournalFile(ledger).records.filter((x) => x.adjudicatedBy === 'subagent-x');
    assert.equal(banked.length, 0, 'and nothing may have been written on the way to refusing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the HTTP writer stamps the same cohort shape on verdicts AND abstentions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rate-cohort-'));
  // canned model: first ask answers, second declines — the cohort must land on BOTH kinds
  const replies = [
    '{"truth":"true-alarm","why":"w","counterfactual":"c","confidence":"high"}',
    '{"truth":"undecidable","why":"unsure","counterfactual":"c"}',
  ];
  let calls = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: replies[Math.min(calls++, replies.length - 1)] } }] }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const ledger = join(dir, 'adjudications.jsonl');
    for (const r of [peerRecord('t1', 'true-alarm'), peerRecord('t2', 'false-clean')]) {
      assert.equal(appendRecord(ledger, r).ok, true);
    }
    // The judged decisions themselves, so evidenceFor has a record to build the prompt from.
    const gateJournal = join(dir, 'gate-tests.jsonl');
    for (const at of ['t1', 't2']) {
      assert.equal(appendRecord(gateJournal, {
        v: 1, gate: 'gate-tests', at, verdict: 'regression-committed', headSha: 'abc1234abc1234',
        baseline: { fail: 0, pass: 100 }, fail: 2, pass: 99, committed: ['y'],
      }).ok, true);
    }
    const r = await run(['--limit', '2', '--write'], {
      CW_VERDICT_DIR: dir,
      CW_LLM_URL: `http://127.0.0.1:${server.address().port}/v1`,
      CW_LLM_MODEL: 'fake/model',
    });
    assert.equal(r.code, 0, `HTTP run failed:\n${r.out}\n${r.err}`);
    const banked = readJournalFile(ledger).records.filter((x) => x.method === 'lmstudio:fake/model');
    const expect = cohortId(['gate-tests@t1', 'gate-tests@t2']);
    assert.equal(banked.length, 2, 'one verdict and one abstention');
    assert.deepEqual(banked.map((b) => b.kind).sort(), ['adjudication', 'adjudication-abstention']);
    for (const b of banked) {
      assert.equal(b.cohort, expect, `${b.kind} must carry the asked-set of THIS run`);
      assert.equal(b.cohortSize, 2);
    }
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--anchored swaps the target population to planted decisions', () => {
  const adj = [
    { method: 're-measurement', truth: 'true-alarm', gate: 'g', recordAt: 't1', at: '1' },
    { adjudicatedBy: 'canary-harness', canary: 'C-1', truth: 'false-clean', gate: 'g', recordAt: 't2', at: '1' },
  ];
  const peer = targetPool(adj);
  assert.equal(peer.pool.length, 1);
  assert.equal(peer.pool[0].recordAt, 't1', 'default pool is peer-judged only — the negative control');

  const anchored = targetPool(adj, { anchored: true });
  assert.equal(anchored.pool.length, 1);
  assert.equal(anchored.pool[0].recordAt, 't2');
  assert.equal(anchored.pool[0].canary, 'C-1', 'the plant id rides through so the dump can stamp it');
});

test('an anchored target with a contested label is dropped, same as a peer one', () => {
  const adj = [
    { canary: 'C-2', truth: 'true-alarm', gate: 'g', recordAt: 't', at: '1' },
    { canary: 'C-2', truth: 'false-clean', gate: 'g', recordAt: 't', at: '2' },
  ];
  const r = targetPool(adj, { anchored: true });
  assert.equal(r.pool.length, 0, 'a plant that disagrees with itself is not truth by construction');
  assert.deepEqual(r.contested, ['g@t']);
});

test('the system prompt does not promise a re-measurement that anchored items lack', () => {
  assert.match(SYSTEM, /WHERE ONE EXISTS/,
    'anchored items carry no peer measurement; a prompt promising one describes evidence not supplied');
  assert.doesNotMatch(SYSTEM, /the evidence the gate had, plus an independent re-measurement taken later/);
});

// ── the planted record must survive the scenario that produced it ────────────────────────────────
// canary-harness runs each scenario under an mkdtemp CW_VERDICT_DIR and deletes it in a `finally`.
// The adjudication it banks was keyed `gate@recordAt` into that deleted journal, so every anchored
// target resolved to nothing and rater-accuracy stayed GREY over 9,217 anchors with zero overlap.
// Measured before the fix: 0 resolvable of 4162 gate-ratchet, 2032 gate-tests, 1002 gate-spine,
// 668 docs-doctor. The record now rides on the adjudication; these assert the shape that carries it.
test('an anchored target carries its own record, because its journal no longer exists', () => {
  const planted = {
    kind: 'adjudication', canary: 'T-REG', gate: 'gate-tests', truth: 'true-alarm',
    recordAt: '2026-09-02T11:40:47.405Z', at: '2026-09-02T11:40:48.000Z',
    record: { gate: 'gate-tests', at: '2026-09-02T11:40:47.405Z', verdict: 'drift', headSha: 'abc1234' },
  };
  const { pool } = targetPool([planted], { anchored: true });
  assert.equal(pool.length, 1);
  assert.ok(pool[0].record, 'the pool entry must carry the record, or the consumer has nothing to render');
  const evidence = evidenceFor(pool[0].record, null);
  assert.match(evidence, /GATE: gate-tests/, 'a rater shown "GATE: undefined" is judging degraded evidence');
  assert.match(evidence, /WHEN: 2026-09-02T11:40:47\.405Z/);
});

test('a plant banked WITHOUT a record is not silently indistinguishable from a missing decision', () => {
  // Pre-embed adjudications are still in the ledger and will never resolve. They must say why,
  // rather than sharing the "not in the journal" message that describes a different fault.
  const legacy = {
    kind: 'adjudication', canary: 'T-OLD', gate: 'gate-tests', truth: 'true-alarm',
    recordAt: '2026-08-01T00:00:00.000Z', at: '2026-08-01T00:00:01.000Z',
  };
  const { pool } = targetPool([legacy], { anchored: true });
  assert.equal(pool.length, 1, 'it still enters the pool — it is the RECORD that is absent, not the decision');
  assert.equal(pool[0].record, undefined, 'and the consumer must handle that rather than assume a record');
});

test('an absent field renders as a state, never as the string "undefined"', () => {
  // Two docs-doctor canary records are synthesised from an artifact and carry no `at`. Showing a
  // rater "WHEN: undefined" presents a missing measurement as though it were one — the same
  // unmeasured-value fault the house invariants name, inside the evidence block itself.
  const ev = evidenceFor({ verdict: 'fresh', statuses: [] }, null);
  assert.doesNotMatch(ev, /undefined/, 'no field may interpolate a raw undefined into rater evidence');
  assert.match(ev, /WHEN: \(none recorded\)/);
  assert.match(ev, /GATE: \(none recorded\)/);
});
