#!/usr/bin/env node
// bin/digest.mjs — one periodic summary over a window: severity crossings, ratchet breaches and
// failed work, read from the stores that already record them. Writes nothing anywhere but
// reports/ (with --write); delivery to a channel is bin/digest-deliver.mjs, which reads the JSON.
//
// Each section names its inputs. An input that is absent or unreadable, or that recorded nothing
// inside the window, makes the section (or its part) NOT MEASURED with the reason — an empty list
// is only ever printed when the inputs were read and covered the window.
//
// usage: node bin/digest.mjs [--since <iso>] [--json] [--write]
//   --since   window start (default: 24h before the window end); the end is CW_NOW or now
//   --json    print the JSON document instead of markdown
//   --write   also write reports/digest/digest-<end>.{json,md} atomically (CW_REPORTS_ROOT)
// Exit 0 every section measured · 2 usage · 20 at least one section not measured (still printed).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowISO } from '../lib/clock.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { issuesPathFor, reportsRootFor } from '../monitor/store-paths.mjs';
import { loadIssues, normaliseSeverity, verifyChain } from '../monitor/issue-store.mjs';
import { readJournal, readJournalFile, verdictDir } from './lib/verdict-journal-core.mjs';
import { sweepHealth, defaultPidAlive } from '../monitor/sweep-health.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA = 'commitwork.digest/1';
const DAY_MS = 24 * 3600 * 1000;
// `unknown` is deliberately not a band: a move out of it is an entry, never a raise.
const BAND = Object.freeze({ low: 1, med: 2, high: 3, crit: 4 });
const ALERT = new Set(['crit', 'high']);
// Gates whose journal carries a floor. Others on the roster have no baseline to breach.
export const RATCHET_GATES = Object.freeze(['gate-ratchet', 'gate-tests']);

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const inWindow = (at, w) => typeof at === 'string' && at > w.since && at <= w.until;
const shown = (root, p) => {
  const r = relative(root, p);
  return r && !r.startsWith('..') && !r.startsWith(sep) ? r.split(sep).join('/') : p;
};
const errText = (e) => (e && e.code ? e.code : String((e && e.message) || e)).slice(0, 200);
const statusOf = (measuredParts, totalParts) => (measuredParts === 0 ? 'not-measured' : measuredParts < totalParts ? 'partial' : 'measured');

// ── severity crossings ──────────────────────────────────────────────────────────────────────────
// Read from the issue store's event chain, keyed on issue id (never a line). Coverage is per area:
// an area whose last ingest predates the window is not measured, because its silence is the
// absence of a sweep, not the absence of a crossing.
export function severityCrossings({ root, window, issuesPath = issuesPathFor(root) }) {
  const input = { name: 'issue store', path: shown(root, issuesPath) };
  const section = { title: 'Severity crossings', input: [input], notMeasured: [], caveats: [], items: [] };
  try { statSync(issuesPath); } catch (e) {
    input.state = e.code === 'ENOENT' ? 'absent' : 'unreadable';
    section.notMeasured.push(e.code === 'ENOENT' ? `issue store absent at ${input.path}` : `issue store unreadable (${errText(e)})`);
    section.status = 'not-measured';
    return section;
  }
  let doc;
  try { doc = loadIssues({ path: issuesPath }); } catch (e) {
    input.state = 'unreadable';
    section.notMeasured.push(`issue store refused: ${String(e.message || e).split('\n')[0].slice(0, 300)}`);
    section.status = 'not-measured';
    return section;
  }
  input.state = 'read';
  const problems = verifyChain(doc);
  if (problems.length) section.caveats.push(`issue store chain does not verify (${problems.length} problem(s)); crossings are read from events that cannot be proved unedited`);

  const areas = Object.keys(doc.lastIngest || {}).sort();
  const ingested = areas.filter((a) => inWindow(doc.lastIngest[a]?.generated, window));
  for (const a of areas) {
    if (!ingested.includes(a)) section.notMeasured.push(`area ${a}: no ingest in window (last ${doc.lastIngest[a]?.generated || 'unknown'})`);
  }
  if (!areas.length) section.notMeasured.push('issue store records no ingest for any area');
  section.coverage = { areas: areas.length, ingestedInWindow: ingested.length };

  const sev = new Map();
  const byIssue = new Map();
  const note = (e, kind, from, to) => {
    const id = e.issueId;
    const cur = byIssue.get(id);
    if (!cur) {
      byIssue.set(id, { issueId: id, kind, from, to, firstAt: e.at, lastAt: e.at, crossings: 1 });
      return;
    }
    cur.crossings += 1;
    cur.lastAt = e.at;
    if ((BAND[to] || 0) > (BAND[cur.to] || 0)) cur.to = to;
  };
  for (const e of doc.events || []) {
    const id = e.issueId;
    const d = e.data || {};
    if (e.type === 'issue-opened') {
      const to = normaliseSeverity(d.severity);
      sev.set(id, to);
      if (inWindow(e.at, window) && ALERT.has(to)) note(e, 'entered', null, to);
    } else if (e.type === 'issue-updated' && d.severity && typeof d.severity === 'object') {
      const from = normaliseSeverity(d.severity.from ?? sev.get(id));
      const to = normaliseSeverity(d.severity.to);
      sev.set(id, to);
      if (!inWindow(e.at, window)) continue;
      if (BAND[from] && BAND[to] && BAND[to] > BAND[from]) note(e, 'raised', from, to);
      else if (!BAND[from] && ALERT.has(to)) note(e, 'entered', from, to);
    } else if (e.type === 'issue-reopened') {
      const to = sev.get(id) ?? normaliseSeverity(doc.issues?.[id]?.severity);
      if (inWindow(e.at, window) && ALERT.has(to)) note(e, 'reopened', null, to);
    } else if (e.type === 'issue-key-migrated' && d.inherited?.severity) {
      sev.set(id, normaliseSeverity(d.inherited.severity));
    }
  }
  section.items = [...byIssue.values()].map((r) => {
    const iss = doc.issues?.[r.issueId] || {};
    return { ...r, area: iss.area ?? null, repo: iss.repo ?? null, title: iss.title ?? null, state: iss.state ?? null };
  }).sort((a, b) => (BAND[b.to] || 0) - (BAND[a.to] || 0) || cmp(a.firstAt, b.firstAt) || cmp(a.issueId, b.issueId));
  section.status = !areas.length ? 'not-measured' : statusOf(ingested.length, areas.length);
  return section;
}

// ── ratchet breaches ────────────────────────────────────────────────────────────────────────────
const UNDETERMINED_VERDICTS = new Set(['baseline-unreadable', 'no-tally', 'deferred', 'degraded']);
export const isUndetermined = (v) => UNDETERMINED_VERDICTS.has(v) || /undetermined/.test(String(v));
export const isBreach = (v) => !isUndetermined(v)
  && (v === 'worse' || (/^(regression|coverage)-/.test(String(v)) && !/(transient|pending)$/.test(String(v))));

// One subject per breached floor: the ratchet's metric, or the test gate's verdict.
function breachSubjects(gate, r) {
  if (gate === 'gate-ratchet') {
    const m = r.metrics || {};
    const b = r.baseline || {};
    const over = Object.keys(m).filter((k) => Number.isFinite(m[k]) && Number.isFinite(b[k]) && m[k] > b[k]).sort();
    return over.length ? over.map((k) => ({ subject: k, baseline: b[k], value: m[k] })) : [{ subject: 'unattributed', baseline: null, value: null }];
  }
  const value = Array.isArray(r.names) ? r.names.length : (Number.isFinite(r.headFail) ? r.headFail : null);
  return [{ subject: r.verdict, baseline: Number.isFinite(r.baseline?.fail) ? r.baseline.fail : null, value }];
}

export function ratchetBreaches({ root, window, dir = verdictDir(), gates = RATCHET_GATES }) {
  const section = { title: 'Ratchet breaches', input: [], notMeasured: [], caveats: [], items: [], undetermined: [] };
  let measured = 0;
  for (const gate of gates) {
    const input = { name: `${gate} verdict journal`, path: shown(root, join(dir, `${gate}.jsonl`)) };
    section.input.push(input);
    let j;
    try { j = readJournal(gate, { dir }); } catch (e) {
      input.state = 'unreadable';
      section.notMeasured.push(`${gate}: journal unreadable (${errText(e)})`);
      continue;
    }
    if (j.absent) {
      input.state = 'absent';
      section.notMeasured.push(`${gate}: journal absent — the gate has never recorded a run here`);
      continue;
    }
    input.state = 'read';
    if (j.chain?.broken) section.caveats.push(`${gate}: journal chain broken ×${j.chain.broken}`);
    if (j.torn) section.caveats.push(`${gate}: ${j.torn} torn line(s) skipped`);
    const recs = j.records.filter((r) => r && inWindow(r.at, window));
    const decided = recs.filter((r) => !isUndetermined(r.verdict));
    const undetermined = recs.length - decided.length;
    if (undetermined) {
      const byVerdict = {};
      for (const r of recs) if (isUndetermined(r.verdict)) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
      section.undetermined.push({ gate, runs: undetermined, byVerdict: Object.fromEntries(Object.entries(byVerdict).sort()) });
    }
    if (!decided.length) {
      const last = j.records.length ? j.records[j.records.length - 1].at : null;
      section.notMeasured.push(`${gate}: no decided run in window (${recs.length} undetermined; last record ${last || 'none'})`);
      continue;
    }
    measured++;
    const latest = decided[decided.length - 1];
    const standing = new Set(isBreach(latest.verdict) ? breachSubjects(gate, latest).map((s) => s.subject) : []);
    const groups = new Map();
    for (const r of decided) {
      if (!isBreach(r.verdict)) continue;
      for (const s of breachSubjects(gate, r)) {
        const g = groups.get(s.subject);
        if (!g) groups.set(s.subject, { gate, subject: s.subject, baseline: s.baseline, peak: s.value, latest: s.value, firstAt: r.at, lastAt: r.at, runs: 1 });
        else {
          g.runs += 1;
          g.lastAt = r.at;
          g.latest = s.value;
          if (Number.isFinite(s.value) && (!Number.isFinite(g.peak) || s.value > g.peak)) g.peak = s.value;
        }
      }
    }
    for (const g of groups.values()) section.items.push({ ...g, standing: standing.has(g.subject), runsInWindow: decided.length });
  }
  section.items.sort((a, b) => cmp(a.gate, b.gate) || cmp(a.subject, b.subject));
  section.status = statusOf(measured, gates.length);
  return section;
}

// ── failed work ─────────────────────────────────────────────────────────────────────────────────
// What one sweep-area-verdict says did not happen. 'unknown' fields are counted as undetermined,
// never as a failure and never as a pass.
export function areaVerdictFailures(v) {
  const out = [];
  const base = { at: v.at, area: v.area ?? null, sliceId: v.sliceId ?? null };
  const add = (type, subject, detail) => out.push({ ...base, type, subject, detail });
  let unknown = 0;
  const repos = v.repos && typeof v.repos === 'object' ? v.repos : null;
  if (!repos) unknown++;
  for (const s of repos?.scans || []) if (s && s.ran === false) add('scan-not-run', `${s.name}${s.manifest ? ` (${s.manifest})` : ''}`, s.why ?? null);
  for (const m of repos?.missing || []) add('repo-missing', String(m), 'repository path absent at sweep time');
  if (v.rollup === 'unknown' || v.rollup == null) unknown++;
  else if (v.rollup !== 'published') add('rollup-not-published', 'rollup', String(v.rollup));
  for (const k of ['preflight', 'hostInventory', 'races']) {
    if (v[k] === 'failed') add('step-failed', k, null);
    else if (v[k] === 'unknown') unknown++;
  }
  const iss = v.issues;
  if (iss === 'failed') add('step-failed', 'issues', null);
  else if (iss === 'unknown') unknown++;
  else if (iss && typeof iss === 'object' && /^(refused|failed)/.test(String(iss.status || ''))) add('ingest-refused', 'issues', String(iss.status));
  const me = v.memoryExport;
  if (me === 'unknown' || me == null) unknown++;
  else if (me && me.kind === 'broken') add('export-failed', 'memoryExport', `${me.state}${me.reason ? `: ${me.reason}` : ''}`);
  if (v.canary && v.canary.state === 'failed') add('canary-failed', 'canary', v.canary.why ?? null);
  for (const [group, steps] of [['steps', v.steps], ['finalize', v.finalize]]) {
    for (const [k, s] of Object.entries(steps || {}).sort(([a], [b]) => cmp(a, b))) if (s === 'failed') add('step-failed', `${group}.${k}`, null);
  }
  return { failures: out, unknown };
}

export function fleetVerdictFailures(v) {
  const out = [];
  const base = { at: v.at, area: null, sliceId: v.stamp ? `sweep-${v.stamp}` : null };
  for (const a of [...(v.areas || [])].sort((x, y) => cmp(String(x?.slug), String(y?.slug)))) {
    if (!a) continue;
    if (a.timedOut) out.push({ ...base, area: a.slug ?? null, type: 'area-sweep-timed-out', subject: a.slug ?? null, detail: `after ${a.secs ?? '?'}s` });
    else if (a.code !== 0) out.push({ ...base, area: a.slug ?? null, type: 'area-sweep-failed', subject: a.slug ?? null, detail: `exit ${a.code ?? 'null'}` });
  }
  for (const [k, s] of Object.entries(v.finalize || {}).sort(([a], [b]) => cmp(a, b))) {
    if (s === 'failed') out.push({ ...base, type: 'step-failed', subject: `fleet.finalize.${k}`, detail: null });
  }
  return out;
}

export function failedWork({ root, window, reportsRoot = reportsRootFor(root), pidAlive = defaultPidAlive }) {
  const section = { title: 'Failed work', input: [], notMeasured: [], caveats: [], items: [], undetermined: [] };
  const rootIn = { name: 'reports root', path: shown(root, reportsRoot) };
  section.input.push(rootIn);
  let names;
  try { names = readdirSync(reportsRoot, { withFileTypes: true }); } catch (e) {
    rootIn.state = e.code === 'ENOENT' ? 'absent' : 'unreadable';
    section.notMeasured.push(e.code === 'ENOENT' ? `reports root absent at ${rootIn.path}` : `reports root unreadable (${errText(e)})`);
    section.status = 'not-measured';
    return section;
  }
  rootIn.state = 'read';
  const journals = [join(reportsRoot, 'sweep-fleet-journal.jsonl')]
    .concat(names.filter((d) => d.isDirectory()).map((d) => d.name).sort().map((n) => join(reportsRoot, n, 'sweep-journal.jsonl')));
  let verdicts = 0;
  let unknownFields = 0;
  let journalsRead = 0;
  let journalsBad = 0;
  for (const p of journals) {
    let j;
    try { j = readJournalFile(p); } catch (e) {
      journalsBad++;
      section.input.push({ name: 'sweep verdict journal', path: shown(root, p), state: 'unreadable' });
      section.notMeasured.push(`${shown(root, p)}: unreadable (${errText(e)})`);
      continue;
    }
    if (j.absent) continue;
    journalsRead++;
    if (j.chain?.broken) section.caveats.push(`${shown(root, p)}: chain broken ×${j.chain.broken}`);
    for (const r of j.records) {
      if (!r || !inWindow(r.at, window)) continue;
      if (r.kind === 'sweep-area-verdict') {
        verdicts++;
        const { failures, unknown } = areaVerdictFailures(r);
        section.items.push(...failures);
        unknownFields += unknown;
      } else if (r.kind === 'sweep-fleet-verdict') {
        verdicts++;
        section.items.push(...fleetVerdictFailures(r));
      }
    }
  }
  section.input.push({ name: 'sweep verdict journals', path: `${rootIn.path}/{,*/}sweep{,-fleet}-journal.jsonl`, state: journalsRead ? 'read' : 'absent', files: journalsRead, unreadable: journalsBad });
  if (unknownFields) section.undetermined.push({ source: 'sweep verdicts', fields: unknownFields, why: 'verdict fields the sweep never supplied (recorded as unknown)' });

  // Standing markers are read at the window END: a hang is a present fact, not a windowed event.
  const health = sweepHealth({ reportsRoot, nowMs: Date.parse(window.until), pidAlive });
  section.input.push({ name: 'in-flight markers', path: `${rootIn.path}/*/.sweep-inflight.json`, state: health.ok ? 'read' : 'unreadable', markers: health.rows.length });
  for (const u of health.unreadable) section.notMeasured.push(`in-flight marker ${u.area ?? ''}: ${u.reason}`);
  for (const r of health.rows) {
    if (r.state === 'hung') section.items.push({ at: window.until, area: r.area, sliceId: r.sliceId, type: 'sweep-hung', subject: r.area, detail: `pid ${r.pid} dead, marker standing since ${r.startedAt ?? 'unknown'}` });
    else if (r.state === 'unknown') section.undetermined.push({ source: 'in-flight marker', area: r.area, why: r.reasons[0] || 'unclassifiable' });
  }

  section.items.sort((a, b) => cmp(a.at, b.at) || cmp(String(a.area), String(b.area)) || cmp(a.type, b.type) || cmp(String(a.subject), String(b.subject)));
  if (!verdicts) section.notMeasured.push(`no sweep verdict recorded in window (${journalsRead} journal(s) read)`);
  section.coverage = { verdictsInWindow: verdicts, journalsRead };
  section.status = !verdicts ? 'not-measured' : (journalsBad || health.unreadable.length ? 'partial' : 'measured');
  return section;
}

// ── document ────────────────────────────────────────────────────────────────────────────────────
export function resolveWindow({ since = null, env = process.env } = {}) {
  const until = nowISO(env);
  let s;
  if (since == null) s = new Date(Date.parse(until) - DAY_MS).toISOString();
  else {
    const t = new Date(since);
    if (Number.isNaN(t.getTime())) throw new RangeError(`--since is not a parseable timestamp: ${JSON.stringify(since)}`);
    s = t.toISOString();
  }
  if (s >= until) throw new RangeError(`--since ${s} is not before the window end ${until}`);
  return { since: s, until };
}

const headlineOf = (key, s) => {
  if (s.status === 'not-measured') return `${s.title}: not measured — ${s.notMeasured[0] || 'no input'}`;
  const n = s.items.length;
  const what = key === 'severityCrossings' ? `${n} finding(s) crossed into a higher band`
    : key === 'ratchetBreaches' ? `${n} floor(s) breached${n ? ` (${s.items.filter((i) => i.standing).length} still standing)` : ''}`
      : `${n} failure(s)`;
  return `${s.title}: ${what}${s.status === 'partial' ? ` · partial (${s.notMeasured.length} part(s) not measured)` : ''}`;
};

export function buildDigest({ root = REPO, since = null, env = process.env, issuesPath, verdictDir: dir, reportsRoot, pidAlive } = {}) {
  const window = resolveWindow({ since, env });
  const sections = {
    severityCrossings: severityCrossings({ root, window, ...(issuesPath ? { issuesPath } : {}) }),
    ratchetBreaches: ratchetBreaches({ root, window, ...(dir ? { dir } : {}) }),
    failedWork: failedWork({ root, window, ...(reportsRoot ? { reportsRoot } : {}), ...(pidAlive ? { pidAlive } : {}) }),
  };
  for (const [k, s] of Object.entries(sections)) s.headline = headlineOf(k, s);
  const doc = {
    schema: SCHEMA,
    digestId: '',
    window,
    generatedAt: window.until,
    status: Object.values(sections).every((s) => s.status === 'measured') ? 'measured'
      : Object.values(sections).every((s) => s.status === 'not-measured') ? 'not-measured' : 'partial',
    headlines: Object.values(sections).map((s) => s.headline),
    sections,
  };
  doc.digestId = createHash('sha256').update(JSON.stringify(doc)).digest('hex');
  return doc;
}

const mdEsc = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/([\\|*_`[\]<>])/g, '\\$1');

export function renderMarkdown(doc) {
  const L = [`# commitwork digest`, '', `Window: ${doc.window.since} → ${doc.window.until} · status: ${doc.status}`, ''];
  for (const [key, s] of Object.entries(doc.sections)) {
    L.push(`## ${s.title} — ${s.status}`, '');
    for (const i of s.input) L.push(`- input: ${i.name} \`${i.path}\` (${i.state})`);
    for (const r of s.notMeasured) L.push(`- not measured: ${mdEsc(r)}`);
    for (const c of s.caveats) L.push(`- caveat: ${mdEsc(c)}`);
    for (const u of s.undetermined || []) L.push(`- undetermined: ${mdEsc(JSON.stringify(u))}`);
    L.push('');
    if (s.items.length) {
      if (key === 'severityCrossings') {
        for (const i of s.items) L.push(`- **${i.to}** ${i.kind}${i.from ? ` from ${i.from}` : ''} · ${i.issueId} · ${mdEsc(i.title)} (${mdEsc(i.area)}${i.repo ? `/${mdEsc(i.repo)}` : ''}) · ${i.firstAt}${i.state ? ` · now ${i.state}` : ''}`);
      } else if (key === 'ratchetBreaches') {
        for (const i of s.items) L.push(`- ${i.gate} · ${mdEsc(i.subject)}: ${i.baseline ?? '?'} → peak ${i.peak ?? '?'} · ${i.runs} of ${i.runsInWindow} run(s) · ${i.firstAt} … ${i.lastAt}${i.standing ? ' · **standing**' : ' · cleared'}`);
      } else {
        for (const i of s.items) L.push(`- ${i.at} · ${i.type} · ${mdEsc(i.area ?? '-')} · ${mdEsc(i.subject)}${i.detail ? ` — ${mdEsc(i.detail)}` : ''}`);
      }
    } else if (s.status === 'measured') {
      L.push('None in window over the inputs above.');
    } else if (s.status === 'partial') {
      L.push('None in the measured part of the window; the parts above marked not measured say nothing.');
    }
    if (L[L.length - 1] !== '') L.push('');
  }
  L.push(`digestId: ${doc.digestId}`, '');
  return L.join('\n');
}

const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function writeDigest(doc, { root = REPO, reportsRoot = reportsRootFor(root) } = {}) {
  const dir = join(reportsRoot, 'digest');
  const base = join(dir, `digest-${stamp(doc.window.until)}`);
  writeAtomic(`${base}.json`, `${JSON.stringify(doc, null, 2)}\n`, { mkdir: true });
  writeAtomic(`${base}.md`, renderMarkdown(doc), { mkdir: true });
  return { json: `${base}.json`, md: `${base}.md` };
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const known = new Set(['--since', '--json', '--write']);
  const bad = argv.filter((a, i) => (a.startsWith('--') ? !known.has(a) : argv[i - 1] !== '--since'));
  const si = argv.indexOf('--since');
  if (bad.length || (si >= 0 && !argv[si + 1])) {
    process.stderr.write(`usage: digest.mjs [--since <iso>] [--json] [--write]${bad.length ? ` (unknown: ${bad.join(' ')})` : ''}\n`);
    process.exitCode = 2;
  } else {
    let doc = null;
    try { doc = buildDigest({ since: si >= 0 ? argv[si + 1] : null }); } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 2;
    }
    if (doc) {
      process.stdout.write(argv.includes('--json') ? `${JSON.stringify(doc, null, 2)}\n` : renderMarkdown(doc));
      if (argv.includes('--write')) {
        const w = writeDigest(doc);
        process.stderr.write(`digest written: ${shown(REPO, w.json)}, ${shown(REPO, w.md)}\n`);
      }
      process.exitCode = doc.status === 'measured' ? 0 : 20;
    }
  }
}
