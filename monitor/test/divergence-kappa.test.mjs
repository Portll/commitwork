// divergence-kappa.test.mjs — Cohen's kappa over CodeQL stage-1 pairs as an upper bound on lens
// correlation: known answers, the minimum n, sampling bases kept apart, one pair per finding, and the
// estimate fed into the recorded divergence row. Synthetic rows only.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cohenKappa, estimateKappa, allEstimates, correlationFor, stage1Pair, pairKey, KAPPA_MIN_N, KAPPA_METHOD } from '../divergence-kappa.mjs';
import { recordDivergence } from '../divergence.mjs';
import { readDimension } from '../nondeterministic-store.mjs';

const QWEN = 'qwen/qwen3.8-27b';
const OPUS = Object.freeze({ answeredBy: null, engine: { engine: 'claude-p', model: 'opus' } });
const localSide = (classification, { model = QWEN, sampling = 'pinned-0' } = {}) => ({
  classification, salvaged: false,
  answeredBy: { provider: 'local', engine: 'lmstudio', model, host: '127.0.0.1:1234' },
  engine: { engine: 'lmstudio', model, pinned: true, provider: 'local', host: '127.0.0.1:1234' },
  ...(sampling ? { sampling } : {}),
});
let seq = 0;
const row = (subject, a, b, { model, sampling, ts, source = 'codeql-remediation', basis = 'stage-1 independent analyses' } = {}) => ({
  subject, dimension: 'divergence', score: a === b ? 0 : 0.9, ts: ts || `2026-10-08T00:00:${String(seq++ % 60).padStart(2, '0')}.000Z`,
  detail: { source, basis, jobId: '0123456789abcdef', local: localSide(a, { model, sampling }), opus: { classification: b, ...OPUS } },
});
const subj = (i) => `svc|codeql.sarif|js/rule-${i}|src/f${i}.js`;
// `counts` maps "a/b" to how many findings carry that pair
const rowsFrom = (counts, opts = {}, offset = 0) => {
  const out = [];
  let i = offset;
  for (const [k, c] of Object.entries(counts)) {
    const [a, b] = k.split('/');
    for (let j = 0; j < c; j++) out.push(row(subj(i++), a, b, opts));
  }
  return out;
};
const PAIR = `local:${QWEN} × claude-p:opus`;

describe('cohenKappa', () => {
  test('the textbook 2×2: observed 0.7, chance 0.5, kappa 0.4', () => {
    const pairs = rowsFrom({ 'real/real': 20, 'real/false-positive': 5, 'false-positive/real': 10, 'false-positive/false-positive': 15 }).map(stage1Pair);
    assert.deepEqual(cohenKappa(pairs), { n: 50, observed: 0.7, chance: 0.5, kappa: 0.4 });
  });

  test('perfect agreement over three classes is 1', () => {
    const pairs = rowsFrom({ 'real/real': 10, 'false-positive/false-positive': 12, 'needs-human/needs-human': 8 }).map(stage1Pair);
    const k = cohenKappa(pairs);
    assert.equal(k.kappa, 1);
    assert.equal(k.observed, 1);
  });

  test('independent engines agree at chance: kappa 0', () => {
    const pairs = rowsFrom({ 'real/real': 10, 'real/false-positive': 10, 'false-positive/real': 10, 'false-positive/false-positive': 10 }).map(stage1Pair);
    assert.deepEqual(cohenKappa(pairs), { n: 40, observed: 0.5, chance: 0.5, kappa: 0 });
  });

  test('systematic opposition is below zero', () => {
    const pairs = rowsFrom({ 'real/false-positive': 15, 'false-positive/real': 15 }).map(stage1Pair);
    assert.equal(cohenKappa(pairs).kappa, -1);
  });

  test('one shared class everywhere leaves kappa undefined, never 1 and never 0', () => {
    const k = cohenKappa(rowsFrom({ 'real/real': 40 }).map(stage1Pair));
    assert.equal(k.kappa, null);
    assert.equal(k.chance, 1);
    assert.match(k.why, /undefined/);
    assert.deepEqual(cohenKappa([]), { n: 0, observed: null, chance: null, kappa: null, why: 'no pairs' });
  });
});

describe('estimateKappa', () => {
  test('30 agreeing findings on one basis are measured: kappa 1 applied as correlation 1', () => {
    const e = estimateKappa(rowsFrom({ 'real/real': 15, 'false-positive/false-positive': 15 }), { pair: PAIR, sampling: 'pinned-0' });
    assert.equal(e.method, KAPPA_METHOD);
    assert.equal(e.measured, true);
    assert.equal(e.n, 30);
    assert.equal(e.kappa, 1);
    assert.equal(e.correlation, 1);
    assert.equal(e.minN, KAPPA_MIN_N);
    assert.equal(KAPPA_MIN_N, 30);
  });

  test('chance-level agreement is measured as kappa 0 and applies no discount', () => {
    const e = estimateKappa(rowsFrom({ 'real/real': 10, 'real/needs-human': 10, 'needs-human/real': 10, 'needs-human/needs-human': 10 }), { pair: PAIR, sampling: 'pinned-0' });
    assert.equal(e.measured, true);
    assert.equal(e.kappa, 0);
    assert.equal(e.correlation, 0);
  });

  test('below the minimum it stays unmeasured, with no figure at all', () => {
    const e = estimateKappa(rowsFrom({ 'real/real': 14, 'false-positive/false-positive': 15 }), { pair: PAIR, sampling: 'pinned-0' });
    assert.equal(e.measured, false);
    assert.equal(e.n, 29);
    assert.equal(e.kappa, null);
    assert.equal(e.observed, null);
    assert.equal(e.correlation, undefined);
    assert.match(e.why, /29 finding\(s\).*below the minimum of 30/);
  });

  test('pinned-0 and model-default pairs are estimated apart, never pooled', () => {
    const pinned = rowsFrom({ 'real/real': 15, 'false-positive/false-positive': 15 }, { sampling: 'pinned-0' }, 0);
    const modelDefault = rowsFrom({ 'real/real': 10, 'real/false-positive': 10, 'false-positive/real': 10, 'false-positive/false-positive': 10 }, { sampling: 'model-default' }, 100);
    const unrecorded = rowsFrom({ 'real/real': 40 }, { sampling: null }, 200);
    const rows = [...pinned, ...modelDefault, ...unrecorded];
    const p = estimateKappa(rows, { pair: PAIR, sampling: 'pinned-0' });
    const m = estimateKappa(rows, { pair: PAIR, sampling: 'model-default' });
    assert.deepEqual([p.n, p.kappa], [30, 1]);
    assert.deepEqual([m.n, m.kappa], [40, 0]);
    const u = estimateKappa(rows, { pair: PAIR, sampling: null });
    assert.equal(u.measured, false);
    assert.match(u.why, /sampling basis was not recorded/);
    assert.deepEqual(allEstimates(rows).map((e) => [e.sampling, e.measured, e.n, e.kappa]),
      [['model-default', true, 40, 0], ['pinned-0', true, 30, 1], ['unrecorded', false, 0, null]]);
  });

  test('another engine pair is never counted toward this one', () => {
    const rows = [...rowsFrom({ 'real/real': 15, 'false-positive/false-positive': 15 }), ...rowsFrom({ 'real/false-positive': 30 }, { model: 'other/model-9b' }, 100)];
    const own = estimateKappa(rows, { pair: PAIR, sampling: 'pinned-0' });
    assert.deepEqual([own.n, own.kappa], [30, 1]);
    const other = estimateKappa(rows, { pair: 'local:other/model-9b × claude-p:opus', sampling: 'pinned-0' });
    assert.deepEqual([other.n, other.kappa], [30, 0]);
  });

  test('one pair per finding, its latest: re-runs never make up the minimum', () => {
    const one = Array.from({ length: 40 }, (_, i) => row(subj(1), 'real', 'real', { ts: `2026-10-08T01:00:${String(i).padStart(2, '0')}.000Z` }));
    const e = estimateKappa(one, { pair: PAIR, sampling: 'pinned-0' });
    assert.equal(e.pairs, 40);
    assert.equal(e.n, 1);
    assert.equal(e.measured, false);
    // a finding that agreed and was later re-run into disagreement counts once, as the disagreement
    const base = rowsFrom({ 'real/real': 15, 'false-positive/false-positive': 15 });
    const rerun = row(subj(0), 'real', 'false-positive', { ts: '2026-10-09T00:00:00.000Z' });
    const k = estimateKappa([...base, rerun], { pair: PAIR, sampling: 'pinned-0' });
    assert.equal(k.n, 30);
    assert.equal(k.observed, Number((29 / 30).toFixed(4)));
  });

  test('rows from another producer or without both classifications are not pairs', () => {
    assert.equal(stage1Pair(row(subj(1), 'real', 'real', { source: 'triage-verdict' })), null);
    assert.equal(stage1Pair(row(subj(1), 'real', 'real', { basis: 'cross-review' })), null);
    assert.equal(stage1Pair({ subject: 's', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'real' } } }), null);
    assert.equal(pairKey({ engine: { engine: 'lmstudio', provider: 'local', model: QWEN } }, OPUS), PAIR, 'an older row without answeredBy keys the same pair');
  });

  test('same records give the same estimate, in any order', () => {
    const rows = [...rowsFrom({ 'real/real': 12, 'real/needs-human': 4, 'needs-human/real': 3, 'false-positive/false-positive': 14 }), row(subj(0), 'real', 'needs-human', { ts: '2026-10-09T00:00:00.000Z' })];
    const a = JSON.stringify(allEstimates(rows));
    assert.equal(JSON.stringify(allEstimates(rows)), a);
    assert.equal(JSON.stringify(allEstimates([...rows].reverse())), a);
  });

  test('agreement below chance records the negative kappa and applies no discount', () => {
    const e = estimateKappa(rowsFrom({ 'real/false-positive': 15, 'false-positive/real': 15 }), { pair: PAIR, sampling: 'pinned-0' });
    assert.equal(e.kappa, -1);
    assert.equal(e.correlation, 0);
  });
});

describe('correlationFor and the recorded row', () => {
  let dir, saved;
  beforeEach(() => { saved = process.env.CW_NONDET_STORE; dir = mkdtempSync(join(tmpdir(), 'cw-kappa-')); process.env.CW_NONDET_STORE = dir; });
  afterEach(() => { if (saved === undefined) delete process.env.CW_NONDET_STORE; else process.env.CW_NONDET_STORE = saved; rmSync(dir, { recursive: true, force: true }); });

  const seed = (rows) => {
    mkdirSync(join(dir, 'divergence'), { recursive: true });
    const by = new Map();
    for (const r of rows) by.set(r.subject, [...(by.get(r.subject) || []), r]);
    for (const [s, rs] of by) writeFileSync(join(dir, 'divergence', `${s.replace(/[^a-zA-Z0-9._-]/g, '_')}.jsonl`), rs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };

  test('an empty store is unmeasured with its reason, and applies 0', () => {
    const c = correlationFor({ local: localSide('real'), opus: { classification: 'real', ...OPUS } });
    assert.equal(c.correlation, 0);
    assert.equal(c.detail.correlation, 'unmeasured');
    assert.equal(c.detail.correlationApplied, 0);
    assert.match(c.detail.correlationWhy, /0 finding\(s\).*below the minimum of 30/);
    assert.deepEqual(c.detail.correlationBasis, { method: KAPPA_METHOD, pair: PAIR, sampling: 'pinned-0', n: 0, minN: 30 });
  });

  test('a measured estimate is fed to divergenceScore and named on the row', () => {
    // 30 findings, 24 agreeing: observed 0.8; marginals 15/15 each way give chance 0.5, so kappa 0.6
    seed(rowsFrom({ 'real/real': 12, 'real/false-positive': 3, 'false-positive/real': 3, 'false-positive/false-positive': 12 }));
    const local = localSide('real'), opus = { classification: 'real', ...OPUS };
    const c = correlationFor({ local, opus });
    assert.deepEqual(c.detail.correlation, { method: KAPPA_METHOD, n: 30, kappa: 0.6, observed: 0.8, chance: 0.5, pair: PAIR, sampling: 'pinned-0', minN: 30 });
    assert.equal(c.detail.correlationApplied, 0.6);
    const one = (cl) => ({ verdict: 'x', findings: [{ id: 'f', classification: cl }] });
    const r = recordDivergence({ subject: subj(999), verdictA: one('real'), verdictB: one('real'), correlation: c.correlation, detail: { ...c.detail, local, opus } });
    assert.equal(r.score, 0.6, 'agreement discounted by the upper bound: 1 - (1 - 0) * (1 - 0.6)');
    const stored = readDimension('divergence').subjects.find((s) => s.subject === subj(999)).rows[0];
    assert.deepEqual(stored.detail.correlation, c.detail.correlation, 'the method object survives, not the bare number');
    // a model-default analyst on the same pair finds no pinned pairs to borrow
    const md = correlationFor({ local: localSide('real', { sampling: 'model-default' }), opus });
    assert.equal(md.detail.correlation, 'unmeasured');
    assert.match(md.detail.correlationWhy, /at model-default sampling, below the minimum/);
  });

  test('an unreadable store is unmeasured with the reason, never estimated over what could be read', () => {
    seed(rowsFrom({ 'real/real': 15, 'false-positive/false-positive': 15 }));
    writeFileSync(join(dir, 'divergence', 'torn.jsonl'), '{"subject":"t"}\nnot json\n');
    const c = correlationFor({ local: localSide('real'), opus: { classification: 'real', ...OPUS } });
    assert.equal(c.detail.correlation, 'unmeasured');
    assert.match(c.detail.correlationWhy, /could not be read.*corrupt record/);
  });
});
