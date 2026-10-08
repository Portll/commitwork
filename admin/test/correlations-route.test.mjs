// Tests for the correlations routes and view (positive and negative), on synthetic fixtures only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { coincidenceView, divergenceView, anomaliesView, undeterminedHistory, ratchetSeries, ratchetHistory, routes } from '../routes/correlations.mjs';
import { record } from '../../monitor/nondeterministic-store.mjs';
import { appendHistory, historyPoint } from '../../monitor/unknown-rate.mjs';
import { esc } from '../../lib/html-escape.mjs';
import { panelSource, panelScript } from './lib/panel-source.mjs';

const ENV = ['CW_FORENSICS_OUT', 'CW_NONDET_STORE', 'CW_ANOMALY_OUT', 'CW_UNKNOWN_RATE_HISTORY', 'CW_VERDICT_DIR'];
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-corr-'));
  process.env.CW_FORENSICS_OUT = join(dir, 'forensics.json');
  process.env.CW_NONDET_STORE = join(dir, 'nondet');
  process.env.CW_ANOMALY_OUT = join(dir, 'artifact-anomalies.json');
  process.env.CW_UNKNOWN_RATE_HISTORY = join(dir, 'unknown-rate-history.jsonl');
  process.env.CW_VERDICT_DIR = join(dir, 'verdicts');
});
process.on('exit', () => { for (const k of ENV) delete process.env[k]; });

const ctx = (session = { user: 'tester' }) => {
  const out = {};
  return { out, req: {}, adminSession: () => session, send: (code, body) => { out.code = code; out.body = body; } };
};
const call = (path, c = ctx()) => { routes.find((r) => r.path === path).handle(c); return c.out; };

test('every route is a GET that refuses a caller with no session', () => {
  assert.equal(routes.length, 5);
  for (const r of routes) {
    assert.equal(r.method, 'GET');
    const c = ctx(null);
    r.handle(c);
    assert.equal(c.out.code, 401, r.path);
  }
});

test('coincidence: absent is not-generated, unparseable is a 503, never an empty list', () => {
  assert.equal(coincidenceView().state, 'not-generated');
  writeFileSync(process.env.CW_FORENSICS_OUT, '{not json');
  const o = call('/api/correlations/coincidence');
  assert.equal(o.code, 503);
  assert.equal(o.body.state, 'unreadable');
  assert.equal(o.body.leads, undefined);
});

test('coincidence: a failed lane is its own state, and a measured lane is projected', () => {
  writeFileSync(process.env.CW_FORENSICS_OUT, JSON.stringify({ generated: '2026-01-02T00:00:00Z', lanes: { coincidence: { failed: true, error: 'boom' } } }));
  assert.deepEqual(coincidenceView(), { state: 'failed', generated: '2026-01-02T00:00:00Z', detail: 'boom' });
  writeFileSync(process.env.CW_FORENSICS_OUT, JSON.stringify({ generated: '2026-01-02T00:00:00Z', lanes: { coincidence: {
    configured: true, windowDays: 14, events: 40, kinds: ['slice', 'verdict'], pairsExamined: 2, pairsUnexaminable: 0,
    examinedAnything: true, leadCount: 1,
    leads: [{ pair: 'verdict→slice', gapSec: 0.5, pairMedianSec: 600, antecedents: 3, session: 'x',
      from: { kind: 'verdict', at: '2026-01-01T00:00:00Z', label: 'gate-a', ref: 'gate-a.jsonl' },
      to: { kind: 'slice', at: '2026-01-01T00:00:00.5Z', label: 'sweep-1', ref: '1.json' } }],
    sourcesMissing: [{ source: '/abs/elsewhere/index.json', reason: 'absent' }],
  } } }));
  const o = call('/api/correlations/coincidence');
  assert.equal(o.code, 200);
  assert.equal(o.body.state, 'measured');
  assert.equal(o.body.leads[0].from.label, 'gate-a');
  assert.equal(o.body.leads[0].session, undefined, 'only named fields cross');
  assert.deepEqual(o.body.sourcesMissing, [{ source: 'index.json', reason: 'absent' }]);
});

test('divergence: no store is not-generated, recorded scores are served highest first', () => {
  assert.equal(divergenceView().state, 'not-generated');
  record({ subject: 'area-a', dimension: 'divergence', score: 0.1 });
  record({ subject: 'area-b', dimension: 'divergence', score: 0.2 });
  record({ subject: 'area-b', dimension: 'divergence', score: 0.8 });
  const v = divergenceView();
  assert.equal(v.state, 'measured');
  assert.deepEqual(v.subjects.map((s) => [s.subject, s.score, s.samples]), [['area-b', 0.8, 2], ['area-a', 0.1, 1]]);
  assert.equal(v.subjects[0].series.length, 2);
});

test('divergence: a corrupt record is a 503, not a missing subject', () => {
  mkdirSync(join(process.env.CW_NONDET_STORE, 'divergence'), { recursive: true });
  writeFileSync(join(process.env.CW_NONDET_STORE, 'divergence', 'area-a.jsonl'), '{"score":0.1}\nnot json\n');
  assert.equal(call('/api/correlations/divergence').code, 503);
});

test('anomalies: absent, unparseable and measured are three different answers', () => {
  assert.equal(anomaliesView().state, 'not-generated');
  writeFileSync(process.env.CW_ANOMALY_OUT, '{}');
  assert.equal(call('/api/correlations/anomalies').code, 503, 'not an array is unreadable');
  writeFileSync(process.env.CW_ANOMALY_OUT, JSON.stringify([{ category: 'secrets', hash: 'abcdef0123456789', repoCount: 9, bytes: 2, repos: ['r1', 'r2'] }]));
  const v = anomaliesView();
  assert.equal(v.state, 'measured');
  assert.equal(v.count, 1);
  assert.equal(v.anomalies[0].hash, 'abcdef012345');
});

test('undetermined history: points carry derived rates; a corrupt line is a 503', () => {
  assert.equal(undeterminedHistory().state, 'not-generated');
  let text = appendHistory('', historyPoint('2026-01-01T00:00:00Z', { count: 10, observed: 100, population: 400, undetermined: 300 }));
  text = appendHistory(text, historyPoint('2026-01-02T00:00:00Z', { count: 5, observed: 0, population: 0, undetermined: 0 }));
  writeFileSync(process.env.CW_UNKNOWN_RATE_HISTORY, text);
  const h = undeterminedHistory();
  assert.equal(h.state, 'measured');
  assert.deepEqual(h.points.map((p) => [p.unknownRate, p.undeterminedShare]), [[0.1, 0.75], [null, null]], 'a rate over zero is no rate');
  writeFileSync(process.env.CW_UNKNOWN_RATE_HISTORY, `${text}oops\n`);
  assert.equal(call('/api/correlations/undetermined-history').code, 503);
});

test('unknown-rate history appends once per run stamp, refuses a corrupt journal, and holds its cap', () => {
  const p = historyPoint('2026-01-01T00:00:00Z', { count: 1, observed: 2, population: 3, undetermined: 1 });
  const once = appendHistory('', p);
  assert.equal(appendHistory(once, p), once, 'a re-run at the same CW_NOW adds nothing');
  assert.throws(() => appendHistory('garbage\n', p), /does not parse/);
  let t = '';
  for (let i = 0; i < 5; i++) t = appendHistory(t, historyPoint(`2026-01-0${i + 1}T00:00:00Z`, {}), 3);
  assert.equal(t.trim().split('\n').length, 3);
  assert.match(t.trim().split('\n').pop(), /2026-01-05/);
});

test('ratchet series keeps change points in time order and counts runs that carried no numbers', () => {
  const recs = [
    { gate: 'gate-ratchet', at: '2026-01-03T00:00:00Z', verdict: 'steady', metrics: { drifted: 1 }, baseline: { drifted: 0 } },
    { gate: 'gate-ratchet', at: '2026-01-01T00:00:00Z', verdict: 'steady', metrics: { drifted: 0 }, baseline: { drifted: 0 } },
    { gate: 'gate-ratchet', at: '2026-01-02T00:00:00Z', verdict: 'steady', metrics: { drifted: 0 }, baseline: { drifted: 0 }, headline: 'free text' },
    { gate: 'gate-ratchet', at: '2026-01-04T00:00:00Z', verdict: 'degraded' },
  ];
  const s = ratchetSeries('gate-ratchet', recs);
  assert.equal(s.records, 4);
  assert.equal(s.unmeasured, 1);
  assert.deepEqual(s.byVerdict, { degraded: 1, steady: 3 });
  const m = s.metrics[0];
  assert.deepEqual(m.points.map((p) => [p.at.slice(0, 10), p.value]), [['2026-01-01', 0], ['2026-01-03', 1]]);
  assert.equal(m.points[0].lastAt, '2026-01-02T00:00:00Z');
  assert.equal(m.current, 1);
});

test('ratchet history: a gate that never journaled is not-generated, not a flat zero', () => {
  const gates = ratchetHistory();
  assert.deepEqual(gates.map((g) => [g.gate, g.state]), [['gate-ratchet', 'not-generated'], ['gate-tests', 'not-generated']]);
  const o = call('/api/correlations/ratchet-history');
  assert.equal(o.code, 200);
  assert.equal(o.body.gates.length, 2);
});

test('the panel declares the view, its loader and its route, and the view escapes what it renders', () => {
  const html = panelSource();
  assert.match(html, /id="view-correlations"/);
  assert.match(html, /data-v="correlations"/);
  const js = panelScript();
  assert.match(js, /correlations:'view-correlations'/);
  assert.match(js, /function loadCorrelations\(/);
  const src = readFileSync(new URL('../static/panel-correlations.js', import.meta.url), 'utf8');
  const sandbox = { esc, document: { addEventListener() {}, getElementById() { return null; } } };
  vm.runInNewContext(src, sandbox);
  const { stateLine, spark } = sandbox.cwCorrelations;
  assert.match(stateLine({ state: 'error', error: '<b>x</b>' }, 'src'), /unreadable[\s\S]*&lt;b&gt;/);
  assert.match(stateLine({ state: 'not-generated' }, 'src'), /not generated/);
  assert.equal(stateLine({ state: 'measured' }, 'src'), null);
  assert.match(spark([{ at: '2026-01-01T00:00:00Z', value: 1 }, { at: '2026-01-02T00:00:00Z', value: 2 }], '<l>'), /&lt;l&gt;[\s\S]*<polyline/);
  assert.match(spark([{ at: '2026-01-01T00:00:00Z', value: null }], 'x'), /—/);
});
