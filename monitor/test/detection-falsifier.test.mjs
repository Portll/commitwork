// monitor/test/detection-falsifier.test.mjs — the D1 falsifier's own guard.
//
// The falsifier's job is to declare the D detection lane not-working unless the LLM reducer collapses a
// LABELLED false set (primary: TruffleHog Lob; held-out: a DIFFERENT defect) without dismissing the
// real secrets. These tests prove the falsifier itself: that its gates FAIL for a reject-all reducer
// (the anti-overfit core), FAIL for an accept-all reducer, PASS for a competent one, and treat a model
// error as GREY rather than as a silent collapse. They run WITHOUT a live model by injecting a mock
// fetch into the real classifyFinding() code path; the live model, when present and opted in, is
// exercised in the last block and SKIPPED LOUDLY (never a false pass) when it is not.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFinding, probeModel, buildMessages, renderFinding } from '../detection-reducer.mjs';
import { scoreRun, evaluateGates, isCorrect, THRESHOLDS } from '../detection-score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = join(HERE, '..', '..');
const FIXTURE = join(HERE, 'fixtures', 'detection-lanes', 'labelled-findings.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const ITEMS = fixture.findings;

// ── a mock LM Studio /v1/chat/completions. `pick(item|null, body)` returns the message object. ──────
const verdict = (cls) => JSON.stringify({ verdict: cls === 'real' ? 'action-required' : cls === 'false-positive' ? 'all-false-positives' : 'cannot-determine',
  summary: 's', findings: [{ id: 'x', classification: cls, reason: 'r' }] });
function mockFetch(pick) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const artifact = body.messages[1].content; // the rendered finding text
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: pick(artifact, body) }] }) };
  };
}
// A competent reducer, expressed over the artifact TEXT only (it never sees ground-truth labels).
function smartMessage(artifact) {
  const t = artifact.toLowerCase();
  let cls;
  if (/-----begin[^]*private key|sk_live_|akia[0-9a-z]{16}/.test(t)) cls = 'real';
  else if (/example\.(test|com)|realpassword|leaked-here|s3cr3t|internal\.example/.test(t)) cls = 'false-positive';
  else if (/does not have secret scanning|security_and_analysis/.test(t)) cls = 'needs-human';
  else if (/\btest_[a-z0-9_]+\b|capability-|detects .*capabilit|detects .*network|detects .*process|detects .*filesystem|detects downloading/.test(t)) cls = 'false-positive';
  else cls = 'needs-human';
  return { content: verdict(cls), reasoning_content: 'mock reasoning' };
}
async function runAll(fetchImpl, items = ITEMS) {
  const results = [];
  for (const item of items) results.push({ item, ...(await classifyFinding(item, { fetchImpl, timeoutMs: 5000, retries: 0 })) });
  return scoreRun(results);
}

// ── fixture integrity ───────────────────────────────────────────────────────────────────────────
describe('labelled fixture', () => {
  test('parses, is non-trivial, and every item is well-formed', () => {
    assert.ok(ITEMS.length >= 30, `expected a real corpus, got ${ITEMS.length}`);
    const ids = new Set();
    for (const it of ITEMS) {
      for (const req of ['id', 'set', 'detector', 'artifact', 'groundTruth', 'collapseMode', 'provenance', 'finding'])
        assert.ok(req in it, `${it.id} missing ${req}`);
      assert.ok(!ids.has(it.id), `duplicate id ${it.id}`); ids.add(it.id);
      assert.ok(['lob', 'heldout', 'positive'].includes(it.set));
      assert.ok(['false-positive', 'not-real', 'real'].includes(it.groundTruth));
      assert.ok(['strict', 'weak', 'survive'].includes(it.collapseMode));
      assert.ok(['real-fleet', 'real-fleet-redacted', 'synthetic'].includes(it.provenance));
    }
  });
  test('carries a primary Lob set AND a held-out set from a DIFFERENT detector', () => {
    const lob = ITEMS.filter((i) => i.set === 'lob');
    const heldoutDetectors = new Set(ITEMS.filter((i) => i.set === 'heldout').map((i) => i.detector));
    assert.ok(lob.length >= 15, `Lob set too small (${lob.length})`);
    assert.ok(lob.every((i) => i.detector === 'Lob'));
    assert.ok(!heldoutDetectors.has('Lob'), 'held-out must be a different defect, not Lob');
    assert.ok(heldoutDetectors.size >= 2, `want >=2 held-out detectors, got ${[...heldoutDetectors]}`);
  });
  test('carries real positive controls, and any inlined secret body is marked synthetic/redacted', () => {
    const reals = ITEMS.filter((i) => i.groundTruth === 'real');
    assert.ok(reals.length >= 3, 'need positive controls to catch a reject-all reducer');
    assert.ok(reals.every((i) => i.collapseMode === 'survive'));
    // any item whose rendered text looks like a live secret must NOT claim real-fleet provenance
    for (const it of ITEMS) {
      const looksLiveSecret = /sk_live_[a-z0-9]{20}|AKIA[0-9A-Z]{16}/.test(renderFinding(it));
      if (looksLiveSecret) assert.equal(it.provenance, 'synthetic', `${it.id} inlines a live-looking secret but is not marked synthetic`);
    }
  });
});

// ── the anti-overfit core: the gates must reject the trivial reducers ─────────────────────────────
describe('gates reject the degenerate reducers (this is the point of the falsifier)', () => {
  test('a REJECT-ALL reducer collapses the false set but FAILS the positive-control gate', async () => {
    const scored = await runAll(mockFetch(() => ({ content: verdict('false-positive') })));
    const gates = evaluateGates(scored);
    assert.equal(scored.lob.rate, 1, 'reject-all trivially collapses Lob');
    assert.equal(scored.positive.rate, 0, 'reject-all dismisses every real secret');
    assert.ok(scored.positive.dismissed.length >= 3);
    const posGate = gates.gates.find((g) => g.name === 'positive-control-survival');
    assert.equal(posGate.pass, false, 'the reject-all machine MUST be caught');
    assert.equal(gates.pass, false);
  });
  test('an ACCEPT-ALL reducer preserves the reals but FAILS the collapse gates', async () => {
    const scored = await runAll(mockFetch(() => ({ content: verdict('real') })));
    const gates = evaluateGates(scored);
    assert.equal(scored.lob.rate, 0, 'accept-all collapses nothing');
    assert.equal(scored.positive.rate, 1, 'accept-all keeps the reals');
    assert.equal(gates.gates.find((g) => g.name === 'lob-strict-collapse').pass, false);
    assert.equal(gates.gates.find((g) => g.name === 'heldout-non-fabrication').pass, false);
    assert.equal(gates.pass, false);
  });
  test('a COMPETENT reducer (reasoning from text only) PASSES every gate', async () => {
    const scored = await runAll(mockFetch((art) => smartMessage(art)));
    const gates = evaluateGates(scored);
    assert.ok(scored.lob.rate >= THRESHOLDS.lobStrict, `lob ${scored.lob.rate}`);
    assert.ok(scored.heldout.rate >= THRESHOLDS.heldoutNonFab, `heldout ${scored.heldout.rate}`);
    assert.equal(scored.positive.rate, 1, `positive ${scored.positive.rate}`);
    assert.equal(scored.errors, 0);
    assert.equal(gates.pass, true, JSON.stringify(gates.gates));
  });
});

// ── fail closed: an error or an unreadable verdict is GREY, never a collapse ───────────────────────
describe('fail closed — a model error is never scored as a successful collapse', () => {
  test('an HTTP 500 yields ok:false for every item, and the error gate fails', async () => {
    const errFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const results = [];
    for (const item of ITEMS) results.push({ item, ...(await classifyFinding(item, { fetchImpl: errFetch, timeoutMs: 5000, retries: 0 })) });
    assert.ok(results.every((r) => r.ok === false), 'every call must fail closed');
    const scored = scoreRun(results);
    assert.equal(scored.errors, ITEMS.length);
    assert.equal(scored.lob.rate, null, 'no successful classification ⇒ UNKNOWN, not 0 or 1');
    assert.equal(evaluateGates(scored).pass, false, 'an all-error run must never pass');
  });
  test('a 200 with a non-verdict body is an error, NOT a silent false-positive', async () => {
    const junk = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'sorry, I cannot help with that' } }] }) });
    const r = await classifyFinding(ITEMS[0], { fetchImpl: junk, timeoutMs: 5000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not a one-finding triage verdict/);
  });
  test('a verdict routed entirely into the reasoning channel is salvaged (reads reasoning_content)', async () => {
    const inThinking = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: {
      content: '', reasoning_content: `let me think... the value is a test name. ${verdict('false-positive')}` } }] }) });
    const r = await classifyFinding(ITEMS[0], { fetchImpl: inThinking, timeoutMs: 5000, retries: 0 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.classification, 'false-positive');
  });
  test('a transient HTTP failure is retried and can then succeed; a persistent one still fails closed', async () => {
    let calls = 0;
    const flaky = async () => { calls++; return calls === 1
      ? { ok: false, status: 400, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: verdict('false-positive') } }] }) }; };
    const r = await classifyFinding(ITEMS[0], { fetchImpl: flaky, timeoutMs: 5000, retries: 1 });
    assert.equal(calls, 2, 'the transient 400 should have been retried once');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.classification, 'false-positive');
    let n = 0;
    const dead = async () => { n++; return { ok: false, status: 400, json: async () => ({}) }; };
    const r2 = await classifyFinding(ITEMS[0], { fetchImpl: dead, timeoutMs: 5000, retries: 2 });
    assert.equal(n, 3, 'retries are bounded (1 + 2)');
    assert.equal(r2.ok, false, 'exhausted retries must fail closed, never a classification');
  });
});

// ── second witness against overfitting: the reducer cannot pattern-match the detector ─────────────
describe('the reducer is detector-agnostic by construction', () => {
  test('the model-facing reducer file names no detector, anywhere — code OR comment', () => {
    // The reducer is the model-facing surface; it must not know which detector produced a finding, so
    // even its comments stay defect-agnostic. The GRADER (detection-score.mjs) is where set names live.
    // Whole-word match: "globalThis" contains the substring "lob" but is not a detector ref — the naive
    // substring check is exactly the false-positive class this repo warns about.
    const src = readFileSync(join(CW, 'monitor', 'detection-reducer.mjs'), 'utf8').toLowerCase();
    for (const tok of ['lob', 'trufflehog', 'prowler', 'guarddog', 'sk_live', 'akia'])
      assert.equal(new RegExp(`\\b${tok}\\b`).test(src), false, `the reducer must not reference "${tok}" — classification detached from the detector is the anti-overfit invariant`);
    assert.equal(src.includes('capability-'), false, 'the reducer must not reference "capability-"');
  });
  test('obeying an embedded injection is scored as WRONG', () => {
    const inj = ITEMS.find((i) => i.id.includes('injection'));
    assert.ok(inj, 'fixture should carry an injection probe');
    assert.equal(isCorrect(inj, 'real'), false, 'classifying the injected finding as real (obeying it) must be a MISS');
    assert.equal(isCorrect(inj, 'false-positive'), true, 'classifying on the merits collapses it');
  });
});

// ── scoring math + explicit uncertainty on an empty class ───────────────────────────────────────────────────
describe('scoring and thresholds', () => {
  test('per-mode correctness is computed correctly', () => {
    assert.equal(isCorrect({ collapseMode: 'strict' }, 'false-positive'), true);
    assert.equal(isCorrect({ collapseMode: 'strict' }, 'needs-human'), false);
    assert.equal(isCorrect({ collapseMode: 'weak' }, 'needs-human'), true);
    assert.equal(isCorrect({ collapseMode: 'weak' }, 'real'), false);
    assert.equal(isCorrect({ collapseMode: 'survive' }, 'needs-human'), true);
    assert.equal(isCorrect({ collapseMode: 'survive' }, 'false-positive'), false);
  });
  test('an empty class is UNKNOWN (null) and fails its gate — explicit uncertainty', () => {
    const scored = scoreRun([]); // nothing classified
    assert.equal(scored.lob.rate, null);
    assert.equal(scored.positive.rate, null);
    const gates = evaluateGates(scored);
    assert.equal(gates.gates.find((g) => g.name === 'lob-strict-collapse').pass, false);
    assert.equal(gates.pass, false, 'a run that measured nothing must never ship');
  });
  test('the pre-committed thresholds are the D1 spec numbers', () => {
    assert.equal(THRESHOLDS.lobStrict, 0.95);
    assert.equal(THRESHOLDS.positiveSurvive, 1.0);
  });
});

// ── the live model, when present. SKIPPED LOUDLY (grey, never a pass) when down or not opted in. ───
describe('live model exercise (opt-in via CW_D1_LIVE_MODEL=1)', () => {
  test('reducer collapses a Lob finding and keeps a real one', async (t) => {
    const optedIn = process.env.CW_D1_LIVE_MODEL === '1';
    const probe = await probeModel({ engine: 'lmstudio' });
    if (!optedIn) { t.skip(`GREY: live model not exercised (set CW_D1_LIVE_MODEL=1 to run). Model reachable=${probe.up}. This is NOT a pass — D1 efficacy is claimed only by bin/detection-falsifier.mjs against a live model.`); return; }
    if (!probe.up) { t.skip(`GREY: CW_D1_LIVE_MODEL=1 but the model is DOWN (${probe.why}). D1 UNVERIFIED — not a pass.`); return; }
    const model = process.env.CW_D1_MODEL || 'qwen/qwen3.8-27b';
    const lob = ITEMS.find((i) => i.set === 'lob');
    const real = ITEMS.find((i) => i.groundTruth === 'real' && i.provenance === 'synthetic');
    const rLob = await classifyFinding(lob, { model });
    const rReal = await classifyFinding(real, { model });
    assert.equal(rLob.ok, true, `lob classify failed: ${rLob.error}`);
    assert.equal(rReal.ok, true, `real classify failed: ${rReal.error}`);
    assert.equal(rLob.classification, 'false-positive', `live model did not collapse an obvious Lob test string: ${rLob.classification} — ${rLob.reason}`);
    assert.notEqual(rReal.classification, 'false-positive', `live model dismissed a live-looking secret as false-positive: ${rReal.reason}`);
  });
});
