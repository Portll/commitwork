// admin/routes/correlations.mjs — the correlations view: cross-kind coincidence leads, engine
// divergence, byte-identical artifact anomalies, and the history of the unknown/undetermined rate
// and of the ratchet floors. Read-only; every source is a file another producer already writes.
//
// Each source answers in one of three ways and they never merge: absent (`not-generated`, 200),
// unreadable (503 with the reason), or what the producer recorded. A coincidence list is leads,
// never findings, and a divergence score is a pointer for a human, never a verdict.
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { requireSession } from '../lib/route-auth.mjs';
import { readJSONState, projectAnomalies } from '../lib/served-projection.mjs';
import { sanitizeServed } from '../../monitor/sweep-verdict.mjs';
import { forensicsOutPath } from '../../monitor/forensics.mjs';
import { anomaliesPath } from '../../monitor/artifact-anomaly.mjs';
import { readDimension } from '../../monitor/nondeterministic-store.mjs';
import { unknownRatePath, unknownRateHistoryPath } from '../../monitor/unknown-rate.mjs';
import { loadRegistry } from '../../monitor/registry.mjs';
import { reportsRootDir } from '../../monitor/area.mjs';
import { readJournal, redactGateRecord } from '../../bin/lib/verdict-journal-core.mjs';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const str = (v, cap = 160) => (typeof v === 'string' ? v.slice(0, cap) : null);
const num = (v) => (isNum(v) ? v : null);
const LEAD_CAP = 25;
const SERIES_CAP = 200;

// Read per request: the registry is memoised in area.mjs, and a view must follow a changed root.
const reportsRoot = () => reportsRootDir(loadRegistry({ quiet: true }));

class Unreadable extends Error {}
const unreadable = (what, detail) => { throw new Unreadable(`${what} unreadable (${detail})`); };

// ── coincidence: the forensics artifact's coincidence lane (monitor/coincidence.mjs) ──────────────
const projectEvent = (e) => ({ kind: str(e && e.kind, 40), at: str(e && e.at, 40), label: str(e && e.label), ref: str(e && e.ref) });

export function coincidenceView() {
  const r = readJSONState(forensicsOutPath());
  if (r.state === 'absent') return { state: 'not-generated', why: 'no forensics artifact — the sweep has not run its forensics pass here' };
  if (r.state === 'unreadable') unreadable('forensics.json', r.detail);
  const generated = str(r.data && r.data.generated, 40);
  const lane = r.data && r.data.lanes && r.data.lanes.coincidence;
  if (!lane || typeof lane !== 'object') return { state: 'not-generated', generated, why: 'the forensics artifact carries no coincidence lane' };
  if (lane.skipped) return { state: 'skipped', generated, why: str(lane.why) };
  if (lane.failed) return { state: 'failed', generated, detail: str(lane.error, 300) };
  if (lane.configured !== true) return { state: 'not-configured', generated };
  const leads = Array.isArray(lane.leads) ? lane.leads : [];
  return sanitizeServed({
    state: 'measured', generated,
    windowDays: num(lane.windowDays), events: num(lane.events),
    kinds: Array.isArray(lane.kinds) ? lane.kinds.map((k) => str(k, 40)) : [],
    pairsExamined: num(lane.pairsExamined), pairsUnexaminable: num(lane.pairsUnexaminable),
    examinedAnything: lane.examinedAnything === true,
    leadCount: num(lane.leadCount),
    leads: leads.slice(0, LEAD_CAP).map((l) => ({
      pair: str(l && l.pair, 60), gapSec: num(l && l.gapSec), pairMedianSec: num(l && l.pairMedianSec),
      antecedents: num(l && l.antecedents), from: projectEvent(l && l.from), to: projectEvent(l && l.to),
    })),
    // a source path can sit outside the checkout; the file name is what a reader needs
    sourcesMissing: (Array.isArray(lane.sourcesMissing) ? lane.sourcesMissing : [])
      .map((m) => ({ source: basename(String((m && m.source) || '')), reason: str(m && m.reason, 40) })),
  });
}

// ── divergence: the nondeterministic store's `divergence` dimension (monitor/divergence.mjs) ──────
export function divergenceView() {
  let d;
  try { d = readDimension('divergence'); }
  catch (e) { unreadable('divergence store', e.code || e.message); }
  if (d.absent || !d.subjects.length) return { state: 'not-generated', why: 'no divergence score has been recorded — nothing has been compared, which is not agreement' };
  const subjects = d.subjects.map(({ subject, rows }) => {
    const scored = rows.filter((r) => r && isNum(r.score));
    const last = scored[scored.length - 1] || null;
    const c = last && last.detail && last.detail.components;
    return {
      subject: str(subject, 120), samples: scored.length,
      score: last ? last.score : null, at: last ? str(last.ts, 40) : null,
      components: c ? { perFinding: num(c.perFinding), verdictMismatch: num(c.verdictMismatch), coveragePenalty: num(c.coveragePenalty) } : null,
      series: scored.slice(-SERIES_CAP).map((r) => ({ at: str(r.ts, 40), value: r.score })),
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(a.subject).localeCompare(String(b.subject)));
  return sanitizeServed({ state: 'measured', count: subjects.length, subjects });
}

// ── artifact anomalies: the husk detector's artifact (monitor/artifact-anomaly.mjs) ──────────────
export function anomaliesView() {
  const dir = process.env.CW_ANOMALY_OUT ? '' : (process.env.CW_ANOMALY_REPORTS_DIR || reportsRoot());
  const r = readJSONState(anomaliesPath(dir));
  if (r.state === 'absent') return { state: 'not-generated', why: 'no artifact-anomalies.json — the husk detector has not run here' };
  if (r.state === 'unreadable') unreadable('artifact-anomalies.json', r.detail);
  const p = projectAnomalies(r);
  if (p.state === 'unreadable') unreadable('artifact-anomalies.json', p.detail);
  return p;
}

// ── history ──────────────────────────────────────────────────────────────────────────────────────
const ratio = (a, b) => (isNum(a) && isNum(b) && b > 0 ? Number((a / b).toFixed(4)) : null);

export function undeterminedHistory() {
  const root = process.env.CW_UNKNOWN_RATE_HISTORY ? null : reportsRoot();
  let text = null;
  try { text = readFileSync(unknownRateHistoryPath(root), 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') unreadable('unknown-rate history', e.code || e.message); }
  const points = [];
  if (text !== null) {
    text.split('\n').filter(Boolean).forEach((l, i) => {
      let p;
      try { p = JSON.parse(l); } catch { unreadable('unknown-rate history', `line ${i + 1} does not parse`); }
      points.push({
        at: str(p.at, 40), count: num(p.count), observed: num(p.observed), population: num(p.population),
        undetermined: num(p.undetermined),
        unknownRate: ratio(p.count, p.observed), undeterminedShare: ratio(p.undetermined, p.population),
      });
    });
  }
  // the latest snapshot rides along so a box with no history yet still shows where the rate stands
  let current = null;
  if (root) {
    const snap = readJSONState(unknownRatePath(root));
    if (snap.state === 'unreadable') unreadable('unknown-rate.json', snap.detail);
    const c = snap.state === 'ok' && snap.data && snap.data.fleet && snap.data.fleet.claim;
    if (c) current = { at: str(snap.data.generated, 40), count: num(c.count), observed: num(c.observed), population: num(c.population), undetermined: num(c.undetermined), unknownRate: ratio(c.count, c.observed), undeterminedShare: ratio(c.undetermined, c.population) };
  }
  if (!points.length) return { state: 'not-generated', why: 'no unknown-rate history yet — one point is added each time monitor/unknown-rate.mjs runs', current };
  const kept = points.slice(-SERIES_CAP);
  return { state: 'measured', count: points.length, truncated: points.length - kept.length, points: kept, current };
}

// Which numbers each ratchet journals, and where its floor sits in the same record.
const RATCHETS = Object.freeze({
  'gate-ratchet': (r) => Object.keys(r.metrics || {}).map((k) => [k, r.metrics[k], r.baseline && r.baseline[k]]),
  'gate-tests': (r) => ['fail', 'pass'].filter((k) => isNum(r[k])).map((k) => [k, r[k], r.baseline && r.baseline[k]]),
});

/** Change points only: a run that repeats the previous value and floor adds nothing to a series. */
export function ratchetSeries(gate, records) {
  const pick = RATCHETS[gate];
  const byVerdict = {};
  const series = new Map();
  let measured = 0;
  // rotation generations do not arrive in time order; a series must
  const ordered = records.map((r, i) => [Date.parse(r && r.at), i, r])
    .sort((a, b) => (a[0] || 0) - (b[0] || 0) || a[1] - b[1]).map(([, , r]) => r);
  for (const raw of ordered) {
    const r = redactGateRecord(raw);
    if (!r) continue;
    const v = String(r.verdict ?? 'none');
    byVerdict[v] = (byVerdict[v] || 0) + 1;
    const vals = pick(r).filter(([, value]) => isNum(value));
    if (vals.length) measured++;
    for (const [name, value, floor] of vals) {
      if (!series.has(name)) series.set(name, []);
      const pts = series.get(name);
      const pt = { at: str(r.at, 40), value, floor: num(floor) };
      const prev = pts[pts.length - 1];
      if (prev && prev.value === value && prev.floor === pt.floor) prev.lastAt = pt.at;
      else pts.push(pt);
    }
  }
  const metrics = [...series.keys()].sort().map((name) => {
    const pts = series.get(name);
    const last = pts[pts.length - 1];
    return { name, current: last.value, floor: last.floor, changes: pts.length, truncated: Math.max(0, pts.length - SERIES_CAP), points: pts.slice(-SERIES_CAP) };
  });
  return { gate, records: records.length, measured, unmeasured: records.length - measured, byVerdict: Object.fromEntries(Object.entries(byVerdict).sort()), metrics };
}

export function ratchetHistory() {
  return Object.keys(RATCHETS).map((gate) => {
    let j;
    try { j = readJournal(gate); }
    catch (e) { unreadable(`${gate} journal`, e.code || e.message); }
    if (j.absent) return { gate, state: 'not-generated', why: 'this gate has never journaled' };
    return { state: 'measured', torn: j.torn, chainBroken: (j.chain && j.chain.broken) || 0, ...ratchetSeries(gate, j.records || []) };
  });
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────
function serve(ctx, build) {
  if (!requireSession(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
  try { return ctx.send(200, { ok: true, ...build() }); }
  catch (e) {
    if (e instanceof Unreadable) return ctx.send(503, { ok: false, state: 'unreadable', error: e.message });
    return ctx.send(500, { ok: false, state: 'error', error: String((e && e.message) || e).slice(0, 300) });
  }
}

export const routes = [
  { method: 'GET', path: '/api/correlations/coincidence', handle: (ctx) => serve(ctx, coincidenceView) },
  { method: 'GET', path: '/api/correlations/divergence', handle: (ctx) => serve(ctx, divergenceView) },
  { method: 'GET', path: '/api/correlations/anomalies', handle: (ctx) => serve(ctx, anomaliesView) },
  { method: 'GET', path: '/api/correlations/undetermined-history', handle: (ctx) => serve(ctx, undeterminedHistory) },
  { method: 'GET', path: '/api/correlations/ratchet-history', handle: (ctx) => serve(ctx, () => ({ state: 'measured', gates: ratchetHistory() })) },
];
