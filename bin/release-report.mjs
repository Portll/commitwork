#!/usr/bin/env node
// bin/release-report.mjs — what a deploy box served, whether it should have, and for how long.
//
// Reads release-evidence documents (schema/release-evidence.schema.json) printed by a deploy box,
// re-judges every finding under the document's own policy with commitwork's KEV catalogue, EPSS
// cache and advisory CVSS index, and writes a self-contained page and a JSON report per product.
//
// usage:
//   node bin/release-report.mjs --evidence <file> [--evidence <file> ...] [--fetch]
//                               [--out <dir>] [--json]
//   --evidence <file>  a saved document; repeatable
//   --fetch            pull each source of monitor/private/releases.json over ssh and keep the documents
//   --out <dir>        base directory for the reports, default <reports>/releases; one <product>/ each
//   --json             print the report JSON (an array when several products) to stdout
//
// sources: monitor/private/releases.json, [{"product","ssh":"user@host","key":"path"}]; the shape
//   ships as monitor/releases.example.json. Runs ssh -o BatchMode=yes -o IdentitiesOnly=yes -i
//   <key> <user@host> with no remote command: the host's forced command prints the document.
//
// policy rules, applied to each finding: a non-runtime finding cannot block when runtime_only; a
// KEV-listed finding blocks when kev; a critical one when critical; a high one when its EPSS is at
// or above high_epss_min. Unknown EPSS (null) never satisfies the threshold.
//
// When both apply, a known-bad finding is never masked by staleness: code 1 wins over code 4.
// exit: 0 ok · 1 the serving release is blocked, or commitwork and the box disagree on a finding ·
//       2 usage, unreadable or invalid input, or a failed fetch (invalid input writes nothing) ·
//       4 evidence older than 26 h, or the KEV catalogue stale or undated (no agreement is claimed)
// env, read at call time: CW_NOW · CW_RELEASES_DIR · CW_RELEASE_SOURCES · CW_KEV · CW_EPSS ·
//      CW_ADVISORY_INDEX · CW_REPORTS_ROOT · CRA_KEV_STALE_DAYS

import { readFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { esc } from '../lib/html-escape.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { MARK_ICON } from '../lib/brand-tokens.mjs';
import { validateAgainstSchema } from '../lib/json-schema.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { privateDir, reportsRootFor } from '../monitor/store-paths.mjs';
import { kevFreshness, kevSet, epssFor, loadJSON, craRoot } from '../cra/lib.mjs';
import { loadIndex } from './advisory-index.mjs';
import { baseScore, band, versionOf } from './cvss.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = join(CW, 'schema', 'release-evidence.schema.json');
export const STALE_HOURS = 26;
const HOUR = 3600_000;
const SSH_TIMEOUT_MS = 60_000;

const releasesDir = () => resolve(process.env.CW_RELEASES_DIR || join(homedir(), '.commitwork', 'releases'));
const sourcesPath = () => resolve(process.env.CW_RELEASE_SOURCES || join(privateDir(CW), 'releases.json'));
const kevPath = () => resolve(process.env.CW_KEV || join(craRoot(), 'monitor', 'data', 'kev.json'));
const epssPath = () => resolve(process.env.CW_EPSS || join(craRoot(), 'monitor', 'data', 'epss.json'));

const ms = (iso) => Date.parse(iso);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// ── validation ─────────────────────────────────────────────────────────────────────────────
/** Schema, then the cross-field facts a schema cannot say. Errors refuse the document. */
export function validateEvidence(doc) {
  const errors = validateAgainstSchema(doc, { path: SCHEMA }).errors.map((e) => e.replace(/^schema: /, ''));
  const warnings = [];
  if (errors.length) return { errors, warnings };
  const bad = (iso) => !Number.isFinite(ms(iso));
  const times = [['generated_at', doc.generated_at]];
  doc.events.forEach((e, i) => times.push([`events[${i}].at`, e.at]));
  doc.releases.forEach((r, i) => {
    if (r.built_at) times.push([`releases[${i}].built_at`, r.built_at]);
    if (r.verdict_at) times.push([`releases[${i}].verdict_at`, r.verdict_at]);
    if (r.verdict) times.push([`releases[${i}].verdict.checked_at`, r.verdict.checked_at]);
  });
  for (const [where, iso] of times) if (bad(iso)) errors.push(`${where}: ${JSON.stringify(iso)} is not a real date`);
  const shas = doc.releases.map((r) => r.sha);
  if (new Set(shas).size !== shas.length) errors.push('releases: a sha appears twice');
  if (doc.serving && !shas.includes(doc.serving)) errors.push(`serving: ${doc.serving} is not among releases`);
  const live = doc.releases.filter((r) => r.state === 'serving').map((r) => r.sha);
  if (live.length > 1) errors.push('releases: more than one release is in state serving');
  if (live.length === 1 && live[0] !== doc.serving) errors.push('releases: the serving-state release is not the document\'s serving sha');
  if (doc.serving && live.length === 0) errors.push('serving: names a release that is not in state serving');
  for (const r of doc.releases) {
    if (r.verdict && r.verdict.status === 'blocked' && r.verdict.blocking.length === 0) {
      warnings.push(`${r.sha.slice(0, 12)}: verdict is blocked but lists no blocking finding`);
    }
    if (r.verdict && r.verdict.status === 'clean' && r.verdict.blocking.length) {
      warnings.push(`${r.sha.slice(0, 12)}: verdict is clean but lists blocking findings`);
    }
  }
  return { errors, warnings };
}

export function parseEvidence(text, where = 'input') {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { errors: [`${where}: not JSON (${e.message})`] }; }
  const { errors, warnings } = validateEvidence(doc);
  return errors.length ? { errors: errors.map((e) => `${where}: ${e}`) } : { doc, warnings };
}

// ── serving timeline ───────────────────────────────────────────────────────────────────────
/** sha → [{from, to, open}]. A serving event opens an interval; the next serving of another sha closes it. */
export function servingIntervals(doc) {
  const evs = doc.events.map((e, i) => ({ ...e, i, t: ms(e.at) })).filter((e) => e.event === 'serving')
    .sort((a, b) => a.t - b.t || a.i - b.i);
  const out = new Map();
  let cur = null;
  const end = ms(doc.generated_at);
  for (const e of evs) {
    if (cur && cur.sha === e.sha) continue;
    if (cur) cur.iv.to = e.t;
    const iv = { from: e.t, to: end, open: false };
    if (!out.has(e.sha)) out.set(e.sha, []);
    out.get(e.sha).push(iv);
    cur = { sha: e.sha, iv };
  }
  if (cur) { cur.iv.open = true; cur.iv.to = Math.max(end, cur.iv.from); }
  return out;
}

const overlapAfter = (ivs, t0) => (ivs || []).reduce((s, iv) => s + Math.max(0, iv.to - Math.max(iv.from, t0)), 0);
const sumMs = (ivs) => (ivs || []).reduce((s, iv) => s + Math.max(0, iv.to - iv.from), 0);
const secs = (msec) => Math.round(msec / 1000);

// ── second opinion ─────────────────────────────────────────────────────────────────────────
const SEV = { crit: 'critical', high: 'high', med: 'medium', low: 'low', none: 'low' };

function indexScore(entry) {
  if (!entry) return null;
  if (isNum(entry.s3)) return { score: entry.s3, version: '3.1', via: 'advisory index s3' };
  for (const k of ['v3', 'v2']) {
    const s = entry[k] ? baseScore(entry[k]) : null;
    if (s !== null) return { score: s, version: versionOf(entry[k]), via: `cvss scorer on index ${k}` };
  }
  if (isNum(entry.s4)) return { score: entry.s4, version: '4.0', via: 'advisory index s4' };
  return null;
}

/** The context a second opinion needs. Every part says whether it was there. */
export function loadContext(now) {
  const fresh = kevFreshness({ kev: kevPath() }, now);
  const kevDoc = loadJSON(kevPath(), null);
  const added = new Map();
  for (const v of (kevDoc && kevDoc.vulnerabilities) || []) if (v && v.cveID) added.set(v.cveID, v.dateAdded || null);
  const epssDoc = loadJSON(epssPath(), null);
  const index = loadIndex();
  const byCve = new Map();
  for (const [id, e] of Object.entries(index.advisories)) if (e && e.cve) byCve.set(e.cve, e);
  return { now, fresh, kev: kevSet(kevDoc), kevAdded: added, epssDoc, index, byCve };
}

/** commitwork's own judgement of one finding under `policy`. */
export function judgeFinding(f, policy, ctx) {
  const entry = ctx.index.advisories[f.id] || f.cves.map((c) => ctx.byCve.get(c)).find(Boolean) || null;
  let severity = f.severity;
  let cvss = f.cvss;
  let cvssSource = isNum(f.cvss) ? 'box' : 'none';
  if (!isNum(f.cvss)) {
    const s = indexScore(entry);
    if (s) { cvss = s.score; cvssSource = s.via; severity = SEV[band(s.score, s.version)] || severity; }
    else if (severity === 'unknown' && entry && entry.label) severity = entry.label === 'moderate' ? 'medium' : entry.label;
  }
  const kev = f.cves.some((c) => ctx.kev.has(c));
  let epss = null;
  let epssSource = 'none';
  const ours = f.cves.map((c) => epssFor(ctx.epssDoc, c)).filter((x) => x !== null);
  if (ours.length) { epss = Math.max(...ours); epssSource = 'commitwork'; }
  else if (isNum(f.epss)) { epss = f.epss; epssSource = 'box'; }
  let blocking = false;
  let reason = 'no policy rule fires';
  if (policy.runtime_only && !f.runtime) reason = 'dev-only dependency; policy.runtime_only';
  else if (policy.kev && kev) { blocking = true; reason = 'listed in CISA KEV'; }
  else if (policy.critical && severity === 'critical') { blocking = true; reason = 'critical severity'; }
  else if (severity === 'high' && epss !== null && epss >= policy.high_epss_min) {
    blocking = true; reason = `high severity with EPSS ${epss} >= ${policy.high_epss_min}`;
  } else if (severity === 'high' && epss === null) reason = 'high severity but EPSS unknown; not blocking';
  return { blocking, reason, severity, cvss, cvss_source: cvssSource, kev, epss, epss_source: epssSource };
}

function uniqueFindings(verdict) {
  const m = new Map();
  for (const [list, flag] of [[verdict.findings, false], [verdict.blocking, true]]) {
    for (const f of list) {
      const k = `${f.id}|${f.package}|${f.version}`;
      const prev = m.get(k);
      m.set(k, prev ? { ...prev, blocking: prev.blocking || f.blocking || flag } : { ...f, blocking: f.blocking || flag });
    }
  }
  return [...m.values()];
}

// ── report ─────────────────────────────────────────────────────────────────────────────────
export function buildReport(doc, ctx, warnings = []) {
  const nowMs = ms(ctx.now);
  const ageHours = (nowMs - ms(doc.generated_at)) / HOUR;
  const stale = ageHours > STALE_HOURS;
  const kevOk = ctx.fresh.state === 'fresh';
  const ivs = servingIntervals(doc);
  const rel = new Map(doc.releases.map((r) => [r.sha, r]));
  const policy = doc.policy;

  const judged = [];
  const disagreements = [];
  const flagDiffs = [];
  const epssCounts = { commitwork: 0, box: 0, none: 0 };
  const kevHits = new Map();
  for (const r of doc.releases) {
    if (!r.verdict) continue;
    for (const f of uniqueFindings(r.verdict)) {
      const j = judgeFinding(f, policy, ctx);
      epssCounts[j.epss_source] += 1;
      judged.push({ sha: r.sha });
      if (j.kev) {
        const dates = f.cves.filter((c) => ctx.kev.has(c)).map((c) => ctx.kevAdded.get(c)).filter((d) => d && Number.isFinite(ms(d)));
        const first = dates.length ? dates.sort()[0] : null;
        if (!kevHits.has(r.sha)) kevHits.set(r.sha, []);
        kevHits.get(r.sha).push({ id: f.id, package: f.package, version: f.version, date_added: first });
      }
      if (j.kev !== f.kev) flagDiffs.push({ sha: r.sha, id: f.id, package: f.package, box_kev: f.kev, commitwork_kev: j.kev });
      if (j.blocking !== f.blocking) {
        disagreements.push({
          sha: r.sha, id: f.id, package: f.package, version: f.version,
          kind: f.blocking ? 'box-blocks-commitwork-does-not' : 'commitwork-blocks-box-does-not',
          box: { blocking: f.blocking, kev: f.kev, severity: f.severity, cvss: f.cvss, epss: f.epss, reason: f.reason },
          commitwork: j,
        });
      }
    }
  }
  const performed = kevOk;
  const second = {
    performed,
    reason: performed ? null : `KEV catalogue ${ctx.fresh.state}${ctx.fresh.ageDays !== null ? ` (${ctx.fresh.ageDays}d old, limit ${ctx.fresh.maxDays}d)` : ''}; no agreement is claimed`,
    findings_judged: judged.length,
    epss_sources: epssCounts,
    disagreements: performed ? disagreements : [],
    kev_flag_differences: performed ? flagDiffs : [],
  };

  // exposure
  const blockedEvents = new Map();
  for (const e of doc.events) if (e.event === 'blocked') {
    if (!blockedEvents.has(e.sha)) blockedEvents.set(e.sha, []);
    blockedEvents.get(e.sha).push(e.at);
  }
  const exposure = [];
  for (const r of doc.releases) {
    const marks = [];
    for (const at of blockedEvents.get(r.sha) || []) marks.push({ at, via: 'blocked event' });
    if (r.verdict && r.verdict.status === 'blocked') {
      marks.push({ at: r.verdict.checked_at, via: 'verdict checked_at' });
      if (r.verdict_at) marks.push({ at: r.verdict_at, via: 'verdict_at' });
    }
    const hits = (kevHits.get(r.sha) || []).map((h) => ({
      ...h,
      exposure_seconds: h.date_added ? secs(overlapAfter(ivs.get(r.sha), ms(h.date_added))) : null,
    }));
    if (!marks.length && !hits.length) continue;
    marks.sort((a, b) => ms(a.at) - ms(b.at));
    const first = marks[0] || null;
    const dated = hits.filter((h) => h.date_added).map((h) => h.date_added).sort();
    exposure.push({
      sha: r.sha,
      serving_seconds: secs(sumMs(ivs.get(r.sha))),
      first_blocked_evidence: first,
      blocked_exposure_seconds: first ? secs(overlapAfter(ivs.get(r.sha), ms(first.at))) : null,
      kev_findings: hits,
      kev_exposure_seconds: dated.length ? secs(overlapAfter(ivs.get(r.sha), ms(dated[0]))) : (hits.length ? null : 0),
    });
  }
  const total = (k) => exposure.reduce((s, e) => s + (e[k] || 0), 0);

  const verdictAge = (r) => (r.verdict_at ? (nowMs - ms(r.verdict_at)) / HOUR : null);
  const eligible = doc.releases.filter((r) => r.state === 'kept' && r.verdict && r.verdict.status === 'clean'
    && r.verdict_at && verdictAge(r) <= policy.verdict_max_age_hours)
    .map((r) => ({ sha: r.sha, built_at: r.built_at, verdict_at: r.verdict_at, verdict_age_hours: round(verdictAge(r)) }));

  const servingRel = doc.serving ? rel.get(doc.serving) : null;
  const servingBlocked = !!servingRel && ((servingRel.verdict && servingRel.verdict.status === 'blocked')
    || (performed && disagreements.some((d) => d.sha === servingRel.sha && d.kind === 'commitwork-blocks-box-does-not')));
  const lastServing = [...doc.events].filter((e) => e.event === 'serving').sort((a, b) => ms(a.at) - ms(b.at)).pop();
  const warn = [...warnings];
  if (lastServing && lastServing.sha !== doc.serving) warn.push(`events say ${lastServing.sha.slice(0, 12)} served last but the document names ${doc.serving ? doc.serving.slice(0, 12) : 'nothing'}`);
  if (servingRel && !servingRel.verdict) warn.push('the serving release has no verdict: nothing about it was checked');
  if (!doc.serving) warn.push('nothing is serving');

  const reasons = [];
  let code = 0;
  if (servingBlocked) reasons.push('the serving release is blocked');
  if (disagreements.length && performed) reasons.push(`${disagreements.length} disagreement(s) with the box`);
  if (reasons.length) code = 1;
  else {
    if (stale) reasons.push(`evidence is ${round(ageHours)} h old (limit ${STALE_HOURS} h)`);
    if (!kevOk) reasons.push(`KEV catalogue ${ctx.fresh.state}`);
    if (reasons.length) code = 4;
  }

  const unchecked = (r) => ({
    sha: r.sha,
    state: r.state,
    has_verdict: !!r.verdict,
    jsr: r.verdict ? r.verdict.unchecked.jsr : null,
    remote_hosts: r.verdict ? r.verdict.unchecked.remote_hosts : null,
  });

  return {
    schema: 'commitwork.release-report/1',
    product: doc.product,
    evidence_generated_at: doc.generated_at,
    evaluated_at: ctx.now,
    source: doc.source,
    policy,
    evidence: { age_hours: round(ageHours), stale, limit_hours: STALE_HOURS },
    kev: ctx.fresh,
    serving: servingRel ? {
      sha: servingRel.sha, built_at: servingRel.built_at, verdict_status: servingRel.verdict ? servingRel.verdict.status : null,
      verdict_at: servingRel.verdict_at, blocked: servingBlocked,
      blocking: servingRel.verdict ? servingRel.verdict.blocking.map((f) => ({ id: f.id, package: f.package, version: f.version, reason: f.reason })) : [],
    } : null,
    rollback_eligible: eligible,
    history: doc.events.filter((e) => ['blocked', 'refused', 'failed-live', 'removed'].includes(e.event))
      .sort((a, b) => ms(a.at) - ms(b.at)),
    timeline: doc.releases.map((r) => ({
      sha: r.sha, state: r.state, built_at: r.built_at,
      verdict_status: r.verdict ? r.verdict.status : null,
      intervals: (ivs.get(r.sha) || []).map((iv) => ({ from: new Date(iv.from).toISOString(), to: new Date(iv.to).toISOString(), open: iv.open })),
      serving_seconds: secs(sumMs(ivs.get(r.sha))),
    })).sort((a, b) => firstServed(a) - firstServed(b)),
    exposure: { releases: exposure, totals: { blocked_exposure_seconds: total('blocked_exposure_seconds'), kev_exposure_seconds: total('kev_exposure_seconds') } },
    second_opinion: second,
    not_covered: doc.releases.map(unchecked),
    warnings: warn,
    exit: { code, reasons },
  };
}

const firstServed = (t) => (t.intervals[0] ? ms(t.intervals[0].from) : Number.MAX_SAFE_INTEGER);
const round = (x) => Math.round(x * 100) / 100;

// ── page ───────────────────────────────────────────────────────────────────────────────────
export function fmtSecs(s) {
  if (s === null || s === undefined) return 'unknown';
  if (s === 0) return '0s';
  const u = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
  const parts = [];
  let left = s;
  for (const [n, size] of u) { const q = Math.floor(left / size); if (q) { parts.push(`${q}${n}`); left -= q * size; } }
  return parts.slice(0, 3).join(' ');
}

const short = (sha) => `<code>${esc(sha.slice(0, 12))}</code>`;
const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
const verdictPill = (s) => (s === 'blocked' ? pill('crit', 'blocked') : s === 'clean' ? pill('live', 'clean') : pill('unk', 'no verdict'));
const table = (head, rows) => (rows.length
  ? `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : '<p class="mut">None.</p>');

export function renderHtml(rep) {
  const r = rep;
  const banner = r.exit.code === 1 ? pill('crit', 'ATTENTION') : r.exit.code === 4 ? pill('med', 'STALE') : pill('live', 'OK');
  const s = r.serving;
  const data = JSON.stringify(r).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const dis = r.second_opinion.disagreements;
  const body = `
<h1>${esc(r.product)} releases ${banner}</h1>
<div class="meta">
<div>Evidence generated <b class="tnum">${esc(r.evidence_generated_at)}</b> by <code>${esc(r.source)}</code>, ${r.evidence.stale ? pill('med', 'stale') : pill('live', 'fresh')} at <b class="tnum">${esc(r.evidence.age_hours)} h</b> old (limit ${r.evidence.limit_hours} h). Evaluated ${esc(r.evaluated_at)}.</div>
<div>Policy <code>${esc(r.policy.name)}</code>: kev ${r.policy.kev ? 'blocks' : 'ignored'}, critical ${r.policy.critical ? 'blocks' : 'ignored'}, high blocks at EPSS &ge; ${esc(r.policy.high_epss_min)}, ${r.policy.runtime_only ? 'runtime dependencies only' : 'all dependencies'}.</div>
<div>KEV catalogue ${esc(r.kev.catalogVersion || 'unknown')}, released ${esc(r.kev.dateReleased || 'unknown')}: ${r.kev.state === 'fresh' ? pill('live', 'fresh') : pill('med', r.kev.state)}${r.kev.ageDays !== null ? ` ${esc(r.kev.ageDays)} d old` : ''}.</div>
${r.exit.reasons.length ? `<div>${r.exit.reasons.map((x) => esc(x)).join('; ')}.</div>` : ''}
${r.warnings.map((w) => `<div>${pill('unk', 'note')} ${esc(w)}</div>`).join('')}
</div>

<h2 id="serving">Serving now</h2>
${s ? `<p>${short(s.sha)} ${verdictPill(s.verdict_status)} built ${esc(s.built_at || 'unknown')}, verdict ${esc(s.verdict_at || 'unknown')}.</p>
${s.blocking.length ? table(['Advisory', 'Package', 'Reason'], s.blocking.map((f) => [esc(f.id), `${esc(f.package)}@${esc(f.version)}`, esc(f.reason)])) : ''}` : '<p>Nothing is serving.</p>'}

<h2 id="rollback">Rollback-eligible</h2>
<p class="mut">Kept, clean verdict, verdict younger than ${esc(r.policy.verdict_max_age_hours)} h.</p>
${table(['Release', 'Built', 'Verdict', 'Verdict age'], r.rollback_eligible.map((e) => [short(e.sha), esc(e.built_at || ''), esc(e.verdict_at), `${esc(e.verdict_age_hours)} h`]))}

<h2 id="history">Blocked, refused, failed and removed</h2>
${table(['At', 'Event', 'Release', 'Detail'], r.history.map((e) => [esc(e.at), pill(e.event === 'removed' ? 'plan' : 'crit', e.event), short(e.sha), esc(e.detail || '')]))}

<h2 id="timeline">Timeline</h2>
${table(['Release', 'State', 'Verdict', 'Serving intervals', 'Serving total'], r.timeline.map((t) => [short(t.sha), esc(t.state), verdictPill(t.verdict_status),
    t.intervals.map((iv) => `${esc(iv.from)} to ${iv.open ? 'now' : esc(iv.to)}`).join('<br>') || '<span class="mut">never</span>', esc(fmtSecs(t.serving_seconds))]))}

<h2 id="exposure">Exposure</h2>
<p>Serving time after the first evidence a release was blocked, and after the KEV date added for its KEV-listed findings. Totals: blocked <b class="tnum">${esc(fmtSecs(r.exposure.totals.blocked_exposure_seconds))}</b>, KEV <b class="tnum">${esc(fmtSecs(r.exposure.totals.kev_exposure_seconds))}</b>.</p>
${table(['Release', 'First blocked evidence', 'Blocked exposure', 'KEV findings', 'KEV exposure'], r.exposure.releases.map((e) => [short(e.sha),
    e.first_blocked_evidence ? `${esc(e.first_blocked_evidence.at)} <span class="mut">(${esc(e.first_blocked_evidence.via)})</span>` : '<span class="mut">none</span>',
    esc(fmtSecs(e.blocked_exposure_seconds)),
    e.kev_findings.map((k) => `${esc(k.id)} <span class="mut">added ${esc(k.date_added || 'unknown')}</span>`).join('<br>') || '<span class="mut">none</span>',
    esc(fmtSecs(e.kev_exposure_seconds))]))}

<h2 id="second-opinion">Second opinion</h2>
${r.second_opinion.performed
    ? `<p>${esc(r.second_opinion.findings_judged)} finding(s) re-judged with commitwork's KEV catalogue, EPSS cache and advisory CVSS index. EPSS from commitwork: ${r.second_opinion.epss_sources.commitwork}, kept from the box: ${r.second_opinion.epss_sources.box}, none: ${r.second_opinion.epss_sources.none}.</p>
${dis.length ? table(['Release', 'Finding', 'Disagreement', 'The box says', 'commitwork says'], dis.map((d) => [short(d.sha), `${esc(d.id)}<br><span class="mut">${esc(d.package)}@${esc(d.version)}</span>`,
      pill('crit', d.kind === 'box-blocks-commitwork-does-not' ? 'box blocks' : 'commitwork blocks'),
      `${d.box.blocking ? 'blocking' : 'not blocking'}: ${esc(d.box.reason)}`,
      `${d.commitwork.blocking ? 'blocking' : 'not blocking'}: ${esc(d.commitwork.reason)}<br><span class="mut">KEV ${d.commitwork.kev}, severity ${esc(d.commitwork.severity)}, CVSS ${esc(d.commitwork.cvss ?? 'unknown')} (${esc(d.commitwork.cvss_source)}), EPSS ${esc(d.commitwork.epss ?? 'unknown')} (${esc(d.commitwork.epss_source)})</span>`])) : '<p>No disagreements.</p>'}`
    : `<p>${pill('med', 'not performed')} ${esc(r.second_opinion.reason)}</p>`}

<h2 id="not-covered">Not covered</h2>
<p class="mut">A clean verdict is clean over what the check can see. JSR packages and imports from remote hosts are not checked.</p>
${table(['Release', 'State', 'JSR packages', 'Remote hosts'], r.not_covered.map((u) => [short(u.sha), esc(u.state),
    u.has_verdict ? esc(u.jsr) : pill('unk', 'no verdict'),
    u.has_verdict ? (u.remote_hosts.map((h) => `<code>${esc(h)}</code>`).join('<br>') || '<span class="mut">none</span>') : '']))}
<script type="application/json" id="report-data">${data}</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${MARK_ICON}
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.product)} releases</title>
<style>
${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
body{padding:2.5rem 1.5rem 5rem;max-width:64rem;margin-inline:auto}
.meta{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem 1.2rem;margin:1rem 0;font-size:.88rem;color:var(--mut)}
.meta div+div{margin-top:.4rem}.meta b{color:var(--ink)}
.mut{color:var(--mut)}
.scroll{overflow-x:auto}
table{width:100%;margin:.8rem 0}
@media print{body{max-width:none;padding:0}}
</style></head><body>${body}
</body></html>
`;
}

// ── fetching ───────────────────────────────────────────────────────────────────────────────
const SOURCES_SCHEMA = join(CW, 'schema', 'release-sources.schema.json');
const expandHome = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

export function loadSources(path = sourcesPath()) {
  let list;
  try { list = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { errors: [`${path}: ${e.message}`] }; }
  const { errors } = validateAgainstSchema(list, { path: SOURCES_SCHEMA });
  if (errors.length) return { errors: errors.map((e) => `${path}: ${e.replace(/^schema: /, '')}`) };
  return { sources: list.map((s) => ({ ...s, key: expandHome(s.key) })) };
}

const sshRun = (args) => new Promise((res) => {
  execFile('ssh', args, { timeout: SSH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
    (err, stdout, stderr) => res({ err, stdout, stderr }));
});

/** One source → {doc, text} or {error}. `run` is injectable so a test needs no ssh. */
export async function fetchSource(src, run = sshRun) {
  const { err, stdout, stderr } = await run(['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', src.key, src.ssh]);
  if (err) return { error: `${src.product}: ssh failed (${err.code ?? err.signal ?? 'error'}): ${String(stderr || err.message).trim().split('\n')[0]}` };
  const p = parseEvidence(stdout, `${src.product} (fetched)`);
  if (p.errors) return { error: p.errors.join('; ') };
  if (p.doc.product !== src.product) return { error: `${src.product}: the host sent a document for ${p.doc.product}` };
  return { doc: p.doc, text: stdout, warnings: p.warnings };
}

export function storeFetched(product, text, now) {
  const dir = join(releasesDir(), product);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${now.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.json`);
  writeAtomic(file, text);
  return file;
}

// ── output ─────────────────────────────────────────────────────────────────────────────────
function writeReport(rep, outBase) {
  const dir = join(outBase, rep.product);
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, 'index.html'), renderHtml(rep));
  writeAtomic(join(dir, 'report.json'), `${JSON.stringify(rep, null, 2)}\n`);
  return dir;
}

function parseArgs(argv) {
  const o = { evidence: [], fetch: false, json: false, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--evidence' || a === '--out') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--out') o.out = v; else o.evidence.push(v);
    } else if (a === '--fetch') o.fetch = true;
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  return o;
}

const USAGE = 'usage: release-report.mjs (--evidence <file> ... | --fetch) [--out <dir>] [--json]';

/** Returns the exit code. Output goes to `io`, so a test can capture it. */
export async function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }, run = sshRun) {
  const o = parseArgs(argv);
  if (o.error) { io.err(`${o.error}\n${USAGE}\n`); return 2; }
  if (o.help) { io.out(`${USAGE}\n`); return 0; }
  if (!o.evidence.length && !o.fetch) { io.err(`${USAGE}\n`); return 2; }

  const docs = [];
  const errors = [];
  for (const f of o.evidence) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch (e) { errors.push(`${f}: ${e.message}`); continue; }
    const p = parseEvidence(text, f);
    if (p.errors) errors.push(...p.errors); else docs.push(p);
  }
  if (errors.length) { io.err(`${errors.join('\n')}\nrefused: nothing written\n`); return 2; }

  let failed = 0;
  if (o.fetch) {
    const s = loadSources();
    if (s.errors) { io.err(`${s.errors.join('\n')}\nrefused: nothing fetched\n`); return 2; }
    let now;
    try { now = nowISO(); } catch (e) { io.err(`${e.message}\n`); return 2; }
    for (const src of s.sources) {
      const r = await fetchSource(src, run);
      if (r.error) { io.err(`fetch failed: ${r.error}\n`); failed++; continue; }
      const file = storeFetched(src.product, r.text, now);
      io.err(`fetched ${src.product} -> ${file}\n`);
      docs.push({ doc: r.doc, warnings: r.warnings });
    }
  }
  const seen = new Set();
  for (const d of docs) {
    if (seen.has(d.doc.product)) { io.err(`two documents for product ${d.doc.product}; pass one\nrefused: nothing written\n`); return 2; }
    seen.add(d.doc.product);
  }

  let now;
  let ctx;
  try { now = nowISO(); ctx = loadContext(now); } catch (e) { io.err(`${e.message}\nrefused: nothing written\n`); return 2; }
  const outBase = resolve(o.out || join(reportsRootFor(CW), 'releases'));
  const reps = [];
  let code = 0;
  for (const d of docs) {
    const rep = buildReport(d.doc, ctx, d.warnings);
    const dir = writeReport(rep, outBase);
    reps.push(rep);
    io.err(`${rep.product}: exit ${rep.exit.code}${rep.exit.reasons.length ? ` (${rep.exit.reasons.join('; ')})` : ''}; ${join(dir, 'index.html')}\n`);
    if (rep.exit.code === 1 || (rep.exit.code === 4 && code !== 1)) code = rep.exit.code;
  }
  if (o.json) io.out(`${JSON.stringify(reps.length === 1 ? reps[0] : reps, null, 2)}\n`);
  return failed ? 2 : code;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`${e.stack || e}\n`); process.exitCode = 2; });
}
