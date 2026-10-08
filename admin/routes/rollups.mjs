// admin/routes/rollups.mjs — GET /api/rollups: when each area last rolled up, when launchd will next
// run its sweep, and what the last 30 days of runs looked like.
//
// NEXT RUN COMES FROM THE INSTALLED JOB, NOT FROM THE INSTALLER'S PLAN. monitor/install-agents.mjs
// writes one StartCalendarInterval per area, but launchd runs the plist on disk, which lags the plan
// until somebody re-installs. An area with no installed job has no next run and says so, rather than
// inheriting a time from a plan nothing is executing.
//
// A DAY WITH NO RUN IS NOT A GOOD DAY. Each day is graded from the area's own sweep journal
// (reports/<out>/sweep-journal.jsonl): broken when the rollup did not publish or a scan did not run,
// warn when it published with a failed step, good otherwise. A scheduled day with no record is
// `none`; a day nothing was scheduled for is not graded at all, because missing a run nobody asked
// for is not a failure.
//
// FAIL CLOSED. An unreadable journal or index is named on the row; it never reads as an empty history.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { CW, registry } from '../lib/core.mjs';
import { areaOut } from '../../monitor/registry.mjs';

export const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;
// Bounds the first request on a cold cache; rows it did not reach say so and fill on the next poll.
const SLICE_READ_BUDGET = 400;

const agentDir = () => process.env.CW_AGENT_DIR || join(homedir(), 'Library', 'LaunchAgents');
const nowMsFrom = (nowMs) => {
  if (Number.isFinite(nowMs)) return nowMs;
  const t = Date.parse(process.env.CW_NOW || '');
  return Number.isFinite(t) ? t : Date.now();
};

/** StartCalendarInterval dicts from a plist's XML; a missing key is launchd's wildcard. */
export function parseCalendar(xml) {
  const at = xml.indexOf('<key>StartCalendarInterval</key>');
  if (at < 0) return null;
  const rest = xml.slice(at + '<key>StartCalendarInterval</key>'.length).trimStart();
  const block = rest.startsWith('<array>') ? rest.slice(0, rest.indexOf('</array>')) : rest.slice(0, rest.indexOf('</dict>') + 7);
  const dicts = [...block.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map((m) => {
    const d = {};
    for (const k of m[1].matchAll(/<key>(Minute|Hour|Day|Weekday|Month)<\/key>\s*<integer>(\d+)<\/integer>/g)) d[k[1]] = Number(k[2]);
    return d;
  });
  return dicts.length ? dicts : null;
}

/** One installed job: absent | unreadable | disabled | unscheduled | scheduled {intervals}. */
export function readJob(label, dir = agentDir()) {
  let xml;
  try { xml = readFileSync(join(dir, `${label}.plist`), 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent', label };
    return { state: 'unreadable', label, detail: e.code || String(e.message) };
  }
  if (/<key>Disabled<\/key>\s*<true\/>/.test(xml)) return { state: 'disabled', label };
  const intervals = parseCalendar(xml);
  return intervals ? { state: 'scheduled', label, intervals } : { state: 'unscheduled', label };
}

/** Next local-time firing after fromMs, or null when none falls within 400 days. */
export function nextFire(intervals, fromMs) {
  let best = null;
  const start = new Date(fromMs);
  for (let off = 0; off <= 400 && best === null; off++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + off);
    for (const iv of intervals || []) {
      if (iv.Month != null && iv.Month !== day.getMonth() + 1) continue;
      if (iv.Day != null && iv.Day !== day.getDate()) continue;
      if (iv.Weekday != null && iv.Weekday % 7 !== day.getDay()) continue;
      const hours = iv.Hour != null ? [iv.Hour] : [...Array(24).keys()];
      const minutes = iv.Minute != null ? [iv.Minute] : [...Array(60).keys()];
      for (const h of hours) for (const m of minutes) {
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
        if (t > fromMs && (best === null || t < best)) best = t;
      }
    }
  }
  return best;
}

/** daily when any interval fires every day; weekly when all name one weekday; custom otherwise. */
export function cadenceOf(intervals) {
  if (!intervals || !intervals.length) return { kind: 'none', label: 'not scheduled' };
  if (intervals.some((iv) => iv.Weekday == null && iv.Day == null && iv.Month == null)) return { kind: 'daily', label: 'daily' };
  const days = new Set(intervals.filter((iv) => iv.Weekday != null).map((iv) => iv.Weekday % 7));
  if (days.size === 1 && intervals.every((iv) => iv.Weekday != null)) return { kind: 'weekly', label: 'weekly' };
  return { kind: 'custom', label: `${days.size} days a week` };
}

const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const RANK = { empty: 0, good: 1, warn: 2, broken: 3 };
const OK_STEP = new Set(['ok', 'skipped']);

/**
 * One sweep-area-verdict → empty | good | warn | broken. `empty` is a run over a scope with no
 * repositories (a deploy-only area): it ran, and there was nothing to scan. The fleet deadman's exit
 * is not this run's outcome.
 */
export function gradeVerdict(rec) {
  if (!rec || rec.kind !== 'sweep-area-verdict') return null;
  if (rec.rollup === 'nothing-to-roll-up' && rec.repos && rec.repos.resolved === 0) return 'empty';
  const scans = rec.repos && Array.isArray(rec.repos.scans) ? rec.repos.scans : [];
  if (rec.rollup !== 'published' || scans.some((s) => s && s.ran === false)) return 'broken';
  const steps = Object.entries(rec.steps || {}).filter(([k]) => k !== 'liveness').map(([, v]) => v);
  const fin = Object.values(rec.finalize || {});
  if (rec.issues === 'failed' || [...steps, ...fin].some((v) => typeof v === 'string' && !OK_STEP.has(v))
    || (rec.preflight && Number(rec.preflight.blind) > 0)) return 'warn';
  return 'good';
}

// The gate's own error rate, from the canary result the latest area verdict journals (W1). A
// verdict written before the field existed, an absent journal and an unreadable one each say so;
// none of them reads as a rate. Whitelisted, so the served shape is fixed whatever a record carries.
const RATE_KEYS = ['state', 'n', 'of', 'rate', 'why'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
export function canaryOf(jr) {
  if (jr.state === 'unreadable') return { state: 'unreadable', why: `the sweep journal could not be read (${jr.detail})` };
  let last = null;
  for (const rec of jr.records) {
    const t = Date.parse(rec && rec.at);
    if (rec && rec.kind === 'sweep-area-verdict' && Number.isFinite(t) && (!last || t >= last.t)) last = { t, rec };
  }
  if (!last) return { state: 'not-measured', why: 'no sweep verdict is recorded for this area' };
  const c = last.rec.canary;
  const at = last.rec.at;
  if (!c || typeof c !== 'object' || typeof c.state !== 'string') {
    return { state: 'not-measured', at, predates: true, why: 'the latest sweep verdict predates canary journaling' };
  }
  return {
    ...pick(c, ['state', 'why', 'exit', 'scored', 'skipped', 'requiredSkipped']), at,
    ...(c.falseClean ? { falseClean: pick(c.falseClean, RATE_KEYS) } : {}),
    ...(c.falseAlarm ? { falseAlarm: pick(c.falseAlarm, RATE_KEYS) } : {}),
    ...(c.attribution ? { attribution: pick(c.attribution, ['scored', 'wrong']) } : {}),
  };
}

function readJournal(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? { state: 'absent', records: [] } : { state: 'unreadable', detail: e.code || e.message, records: [] }; }
  const records = []; let badLines = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { badLines++; }
  }
  return { state: 'ok', records, badLines };
}

function readIndex(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? { state: 'absent', rows: [] } : { state: 'unreadable', detail: e.code || e.message, rows: [] }; }
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? { state: 'ok', rows: j } : { state: 'unreadable', detail: 'not an array', rows: [] };
  } catch (e) { return { state: 'unreadable', detail: `unparseable (${String(e.message).slice(0, 80)})`, rows: [] }; }
}

// Slices are immutable and hash-chained, so a summary read once is valid for the file's lifetime.
let memo = null;
const cachePath = (reportsRoot) => process.env.CW_ROLLUPS_CACHE || join(reportsRoot, '.rollups-slice-cache.json');
function loadMemo(path) {
  if (memo && memo.path === path) return memo;
  let entries = {};
  try { entries = JSON.parse(readFileSync(path, 'utf8')).entries || {}; } catch { /* a missing or unreadable cache is rebuilt, never trusted */ }
  memo = { path, entries, dirty: false };
  return memo;
}
function saveMemo() {
  if (!memo || !memo.dirty) return;
  try {
    mkdirSync(dirname(memo.path), { recursive: true });
    const tmp = `${memo.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ v: 1, entries: memo.entries }));
    renameSync(tmp, memo.path);
    memo.dirty = false;
  } catch { /* the cache is an optimisation; failing to persist it costs a re-read next time */ }
}
function sliceSummary(reportsRoot, out, file, budget) {
  const key = `${out}/${file}`;
  if (memo.entries[key]) return memo.entries[key];
  if (budget.left <= 0) return { state: 'not-read' };
  budget.left--;
  let s;
  try {
    const t = (JSON.parse(readFileSync(join(reportsRoot, out, 'history', file), 'utf8')).totals) || {};
    const cve = t.cveTotals || {};
    s = { state: 'ok', cve: Number.isFinite(cve.cves) ? cve.cves : null,
      kev: t.kevConsulted === true && Number.isFinite(t.kev) ? t.kev : null,
      crit: Number(t.crit) || 0, high: Number(t.high) || 0, med: Number(t.med) || 0, low: Number(t.low) || 0 };
  } catch (e) { s = { state: 'unreadable', detail: e.code || 'unparseable' }; }
  memo.entries[key] = s; memo.dirty = true;
  return s;
}

const worstOf = (s) => {
  if (!s || s.state !== 'ok') return 'unknown';
  if (s.kev > 0) return 'kev';
  return s.crit > 0 ? 'crit' : s.high > 0 ? 'high' : s.med > 0 ? 'med' : s.low > 0 ? 'low' : 'none';
};

export function rollupsView({ nowMs, reg = null, root = null, dir = null } = {}) {
  const now = nowMsFrom(nowMs);
  let live = reg;
  if (!live) {
    try { live = registry(); }
    catch (e) { return { ok: false, reason: `the registry could not be read (${e.message}) — the schedule is UNKNOWN, not empty` }; }
  }
  const reportsRoot = root ? resolve(root) : resolve(CW, live.reportsRoot || 'reports');
  const jobs = dir || agentDir();
  loadMemo(cachePath(reportsRoot));
  const budget = { left: SLICE_READ_BUDGET };
  const days = [];
  const today = new Date(now);
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) days.push(localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i).getTime()));
  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (WINDOW_DAYS - 1)).getTime();

  const rows = [];
  for (const a of live.areas || []) {
    const out = areaOut(a.slug, live) || a.slug;
    const row = { slug: a.slug, label: a.label || a.slug, out, paused: a.paused ? { since: a.paused.since || null } : null };
    if (!SAFE_SEGMENT.test(String(out))) { rows.push({ ...row, misdeclared: true }); continue; }

    const job = readJob(`com.portll.commitwork-monitor-${a.slug}`, jobs);
    const deep = readJob(`com.portll.commitwork-deep-${a.slug}`, jobs);
    const next = job.state === 'scheduled' && !a.paused ? nextFire(job.intervals, now) : null;
    const deepNext = deep.state === 'scheduled' && !a.paused ? nextFire(deep.intervals, now) : null;
    row.cadence = cadenceOf(job.state === 'scheduled' ? job.intervals : null);
    row.schedule = { state: a.paused ? 'paused' : job.state, next: next ? new Date(next).toISOString() : null, ...(job.detail ? { detail: job.detail } : {}) };
    row.deep = { state: a.paused ? 'paused' : deep.state, next: deepNext ? new Date(deepNext).toISOString() : null };

    const idx = readIndex(join(reportsRoot, out, 'history', 'index.json'));
    const jr = readJournal(join(reportsRoot, out, 'sweep-journal.jsonl'));
    row.sources = { index: idx.state, journal: jr.state, ...(idx.detail ? { indexDetail: idx.detail } : {}),
      ...(jr.detail ? { journalDetail: jr.detail } : {}), ...(jr.badLines ? { journalBadLines: jr.badLines } : {}) };
    const lastRow = idx.rows.length ? idx.rows[idx.rows.length - 1] : null;
    row.last = lastRow && lastRow.generated ? { at: lastRow.generated, sliceId: lastRow.sliceId || null } : null;
    row.worst = lastRow && lastRow.file ? worstOf(sliceSummary(reportsRoot, out, lastRow.file, budget)) : 'unknown';
    row.canary = canaryOf(jr);

    // Days before an area's first recorded run are not missed runs: the area, or its job, did not exist yet.
    let firstRun = Infinity;
    for (const rec of jr.records) { const t = Date.parse(rec && rec.at); if (rec && rec.kind === 'sweep-area-verdict' && Number.isFinite(t) && t < firstRun) firstRun = t; }
    const firstDay = Number.isFinite(firstRun) ? localDay(firstRun) : null;
    const graded = new Map();
    for (const rec of jr.records) {
      const g = gradeVerdict(rec); const t = Date.parse(rec && rec.at);
      if (!g || !Number.isFinite(t) || t < windowStart) continue;
      const k = localDay(t); const cur = graded.get(k) || { state: null, runs: 0 };
      cur.runs++; if (!cur.state || RANK[g] > RANK[cur.state]) cur.state = g;
      graded.set(k, cur);
    }
    const lastSliceOfDay = new Map();
    for (const r of idx.rows) {
      const t = Date.parse(r && r.generated);
      if (Number.isFinite(t) && t >= windowStart && r.file) lastSliceOfDay.set(localDay(t), r.file);
    }
    const expected = (k) => {
      if (a.paused || job.state !== 'scheduled' || !firstDay || k < firstDay) return false;
      if (row.cadence.kind === 'daily') return true;
      const [y, m, d] = k.split('-').map(Number);
      const wd = new Date(y, m - 1, d).getDay();
      return job.intervals.some((iv) => iv.Weekday == null || iv.Weekday % 7 === wd);
    };
    row.days = days.map((k) => {
      const g = graded.get(k);
      const file = lastSliceOfDay.get(k);
      const s = file ? sliceSummary(reportsRoot, out, file, budget) : null;
      const exposure = s && s.state === 'ok' ? { cve: s.cve, kev: s.kev, crit: s.crit, high: s.high } : (s ? { state: s.state } : null);
      const isToday = k === days[days.length - 1];
      const state = g ? g.state : (expected(k) && !isToday ? 'none' : null);
      return { day: k, state, runs: g ? g.runs : 0, ...(exposure ? { exposure } : {}) };
    });
    rows.push(row);
  }
  saveMemo();

  const scheduled = rows.filter((r) => r.schedule && r.schedule.next).sort((x, y) => x.schedule.next.localeCompare(y.schedule.next));
  const fleetDays = days.map((k, i) => {
    const d = { day: k, ran: 0, runs: 0, empty: 0, good: 0, warn: 0, broken: 0, none: 0, cve: 0, kev: 0, exposureAreas: 0 };
    for (const r of rows) {
      const x = r.days && r.days[i]; if (!x) continue;
      if (x.runs) { d.ran++; d.runs += x.runs; }
      if (x.state) d[x.state]++;
      if (x.exposure && Number.isFinite(x.exposure.cve)) { d.cve += x.exposure.cve; d.kev += x.exposure.kev || 0; d.exposureAreas++; }
    }
    return d;
  });
  // The canary tests the gates, not the area, so the fleet's current error rate is the newest one.
  let canary = { state: 'not-measured', why: 'no area has a sweep verdict recording the canary' };
  for (const r of rows) {
    const c = r.canary;
    if (c && c.at && !c.predates && (!canary.at || Date.parse(c.at) > Date.parse(canary.at))) canary = { ...c, area: r.slug };
  }
  const totals = fleetDays.reduce((t, d) => { for (const k of ['good', 'warn', 'broken', 'none', 'empty']) t[k] += d[k]; return t; }, { good: 0, warn: 0, broken: 0, none: 0, empty: 0 });

  return {
    ok: true,
    generatedAt: new Date(now).toISOString(),
    windowDays: WINDOW_DAYS,
    days,
    fleet: { next: scheduled.length ? { at: scheduled[0].schedule.next, area: scheduled[0].label, slug: scheduled[0].slug } : null, days: fleetDays, totals, canary },
    // true when this assembly hit its read budget: some exposure cells read `not-read` until the next
    slicesPending: budget.left <= 0,
    areas: rows,
  };
}

const authed = (ctx) => {
  if (ctx.isLoopbackReq) return true;
  const s = ctx.adminSession && ctx.adminSession(ctx.req);
  return Boolean(s && s.user);
};
const CACHE_MS = 15_000;
let cached = null;

export const routes = [
  {
    method: 'GET', path: '/api/rollups',
    handle: (ctx) => {
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
      if (cached && Date.now() - cached.at < CACHE_MS) return ctx.send(cached.body.ok ? 200 : 503, cached.body);
      let body;
      try { body = rollupsView({}); }
      catch (e) { return ctx.send(500, { ok: false, reason: `the rollup schedule could not be assembled (${e.message}) — nothing below is a reading` }); }
      cached = { at: Date.now(), body };
      return ctx.send(body.ok ? 200 : 503, body);
    },
  },
];

export default routes;
