// cra/taint-frontier.mjs — untrusted data entering external calls that no taint route in the scan ends at.
//
// bin/codeql-frontier.mjs runs CodeQL's untrusted-data-to-external-api query beside each CodeQL lane
// and writes codeql-frontier-<language>.sarif with a record (.json) of how that went. This reads them
// for one sweep and answers: where does untrusted data enter library code, and which of those calls
// did no taint query report as a sink?
//
//   claimed    a taint route in the same scan (codeql*.sarif in the same directory) ends at exactly
//              this call: the finding is already in the lane, and this row adds nothing
//   unclaimed  no route ends here: the library is not modelled as a sink, or a sanitiser or barrier
//              stopped the query. Either way the lane's silence about this call is NOT a clean
//              result, and the call is where a model (bin/codeql-model-pack.mjs) would make it one.
//
// Neither is a finding. An unclaimed call is a statement about what the analysis could see, and it
// is reported apart from the severity buckets, as every unmeasured result is.
//
// THE JOIN. A frontier result and a taint sink in the same scan name the same region: measured on
// the fixture in bin/codeql-frontier.mjs's header, both are app.js 10:13-57. So the join is file,
// line and both columns, exact, and file and line where an engine gave no columns. Lines are fine
// here because both sides come from one scan of one revision; nothing here is an identity across
// scans. Aggregation across scans keys on repo|api|file, never the line.
//
// Fails closed: an artifact the reader could not use is counted by state, a record that says the
// query failed is counted as failed, and a CodeQL lane with no frontier record at all is `not-run` —
// three different reasons for having no frontier, none of them an empty one.

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readSarif } from '../monitor/sarif-read.mjs';
import { findingFileOf } from './dataflow-evidence.mjs';

const FRONTIER_RECORD = /^codeql-frontier-([a-z-]+)\.json$/;
const LANE_ARTIFACT = /^codeql(?:-([a-z]+))?\.sarif$/;
const MAX_TEXT = 240;
const cut = (s) => String(s == null ? '' : s).slice(0, MAX_TEXT);

/** The lane language of a CodeQL lane artifact: codeql.sarif is javascript-typescript. */
const languageOfLane = (name) => {
  const m = LANE_ARTIFACT.exec(name);
  return m ? (m[1] || 'javascript-typescript') : null;
};

const regionKey = (file, region) => {
  if (!file || !region || !Number.isInteger(region.startLine)) return null;
  const cols = Number.isInteger(region.startColumn) && Number.isInteger(region.endColumn) ? `${region.startColumn}-${region.endColumn}` : '';
  return { exact: `${file}|${region.startLine}|${cols}`, line: `${file}|${region.startLine}` };
};

/**
 * "Call to <api> [param N] with untrusted data from [<source>](1)." -> { api, param, source }.
 * The query's own select text, the same shape in every language checked; the brackets arrive
 * markdown-escaped (`\[param 0\]`). A message that does not have the shape is returned as null and
 * counted `unparsed`, never guessed at.
 */
export function parseFrontierMessage(text) {
  const t = String(text || '').replace(/\\([[\]])/g, '$1');
  const m = /^Call to (.+?) with untrusted data from \[(.*)\]\(\d+\)\.?\s*$/s.exec(t);
  if (!m) return null;
  const p = /^(.*?)\s*\[(param [^\]]+|qualifier|receiver|this|[^\]]+)\]$/.exec(m[1]);
  return { api: cut(p ? p[1] : m[1]), param: p ? cut(p[2]) : null, source: cut(m[2]) };
}

/** The sink sites of every taint route in one CodeQL artifact's results: Set of region keys (exact and line-only). */
export function sinkSitesOf(results) {
  const exact = new Set();
  const line = new Set();
  for (const r of results || []) {
    for (const cf of Array.isArray(r?.codeFlows) ? r.codeFlows : []) {
      for (const tf of Array.isArray(cf?.threadFlows) ? cf.threadFlows : []) {
        const locs = Array.isArray(tf?.locations) ? tf.locations : [];
        if (!locs.length) continue;
        const pl = locs[locs.length - 1]?.location?.physicalLocation;
        const k = regionKey(findingFileOf(pl?.artifactLocation?.uri), pl?.region);
        if (k) { exact.add(k.exact); line.add(k.line); }
      }
    }
  }
  return { exact, line };
}

/** One frontier SARIF result -> a call, classified against the scan's sink sites. */
export function frontierCall(result, sinks) {
  const pl = result?.locations?.[0]?.physicalLocation;
  const file = findingFileOf(pl?.artifactLocation?.uri) || null;
  const k = regionKey(file, pl?.region);
  const parsed = parseFrontierMessage(result?.message?.text);
  const hasCols = !!(k && !k.exact.endsWith('|'));
  const claimed = !!k && (hasCols ? sinks.exact.has(k.exact) : sinks.line.has(k.line));
  // The message abbreviates the source (`globalT ... .search`); the related location its link names
  // says exactly where the untrusted value comes from, which is the line a reviewer has to read.
  const linkId = /\]\((\d+)\)\.?\s*$/.exec(String(result?.message?.text || ''));
  const rel = linkId ? (result?.relatedLocations || []).find((l) => l && l.id === Number(linkId[1])) : null;
  const rpl = rel?.physicalLocation;
  const sourceFile = rpl ? findingFileOf(rpl.artifactLocation?.uri) || null : null;
  return {
    file,
    line: Number.isInteger(pl?.region?.startLine) ? pl.region.startLine : null,
    api: parsed ? parsed.api : null,
    param: parsed ? parsed.param : null,
    source: parsed ? parsed.source : null,
    sourceAt: sourceFile ? { file: sourceFile, line: Number.isInteger(rpl.region?.startLine) ? rpl.region.startLine : null } : null,
    ...(parsed ? {} : { message: cut(result?.message?.text) }),
    claimed,
  };
}

/** List a directory: entries, or the error — only the caller decides what ENOENT means. */
const list = (d) => { try { return { entries: readdirSync(d, { withFileTypes: true }) }; } catch (e) { return { error: e }; } };
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The frontier of one sweep directory: repos at any depth up to `maxDepth`, a repo being the
 * directory that holds CodeQL lane artifacts or frontier records.
 * -> { state, reason, repos: { [repo]: { languages: { [lang]: { state, reason?, calls, claimed, unclaimed, unparsed } }, calls: [...] } }, totals, apis, unreadable }
 */
export function buildFrontier({ dir, maxDepth = 6 } = {}) {
  const repos = {};
  const totals = { calls: 0, claimed: 0, unclaimed: 0, unparsed: 0, byState: {} };
  const unreadable = [];

  const visit = (d, entries) => {
    const files = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
    const lanes = files.map((n) => [n, languageOfLane(n)]).filter(([, l]) => l);
    const records = files.map((n) => [n, FRONTIER_RECORD.exec(n)]).filter(([, m]) => m).map(([n, m]) => [n, m[1]]);
    if (!lanes.length && !records.length) return;
    const repo = basename(d);
    const out = repos[repo] || (repos[repo] = { languages: {}, calls: [] });
    // the scan's sink sites, from every CodeQL lane artifact beside the frontier
    const sinks = { exact: new Set(), line: new Set() };
    for (const [name] of lanes) {
      const rec = readSarif(join(d, name));
      if (rec.state !== 'ok') continue;
      const s = sinkSitesOf(rec.results);
      for (const k of s.exact) sinks.exact.add(k);
      for (const k of s.line) sinks.line.add(k);
    }
    const seen = new Set();
    for (const [name, lang] of records) {
      seen.add(lang);
      const row = { state: null, calls: 0, claimed: 0, unclaimed: 0, unparsed: 0 };
      out.languages[lang] = row;
      let record;
      try { record = JSON.parse(readFileSync(join(d, name), 'utf8')); } catch (e) {
        row.state = 'unreadable'; row.reason = `${name}: ${e.code || e.message}`;
        continue;
      }
      if (record.state !== 'ran') {
        row.state = record.state || 'unknown';
        if (record.reason) row.reason = cut(record.reason);
        continue;
      }
      const sarifName = typeof record.sarif === 'string' && /^codeql-frontier-[a-z-]+\.sarif$/.test(record.sarif) ? record.sarif : `codeql-frontier-${lang}.sarif`;
      const rec = readSarif(join(d, sarifName));
      if (rec.state !== 'ok') { row.state = `sarif-${rec.state}`; row.reason = cut(rec.reason); continue; }
      row.state = 'ran';
      for (const r of rec.results) {
        const call = frontierCall(r, sinks);
        row.calls++;
        if (call.claimed) row.claimed++; else row.unclaimed++;
        if (!call.api) row.unparsed++;
        out.calls.push({ language: lang, ...call });
      }
    }
    // a CodeQL lane that ran here with no frontier record: the sweep did not run the frontier
    for (const [, lang] of lanes) {
      if (seen.has(lang) || out.languages[lang]) continue;
      out.languages[lang] = { state: 'not-run', reason: 'no frontier record beside this CodeQL lane (a sweep from before bin/codeql-frontier.mjs, or a lane run without it)', calls: 0, claimed: 0, unclaimed: 0, unparsed: 0 };
    }
  };

  const walk = (d, depth) => {
    if (depth > maxDepth) return;
    const { entries, error } = list(d);
    if (error) { if (unreadable.length < 20) unreadable.push(`${d}: ${error.code || error.message}`); totals.unreadableDirs = (totals.unreadableDirs || 0) + 1; return; }
    entries.sort(byName);
    visit(d, entries);
    for (const e of entries) if (e.isDirectory()) walk(join(d, e.name), depth + 1);
  };

  if (!dir) return { state: 'absent', reason: 'no sweep directory given', repos, totals, apis: [], unreadable };
  const root = list(dir);
  if (root.error) {
    return { state: root.error.code === 'ENOENT' ? 'absent' : 'unreadable', reason: `${dir}: ${root.error.code || root.error.message}`, repos, totals, apis: [], unreadable };
  }
  walk(dir, 0);

  // fleet roll-up, keyed repo|api|file for counting and api for the table — never the line
  const apis = new Map();
  for (const [repo, r] of Object.entries(repos)) {
    r.calls.sort((a, b) => String(a.file).localeCompare(String(b.file)) || (a.line ?? 0) - (b.line ?? 0) || String(a.api).localeCompare(String(b.api)));
    for (const lang of Object.values(r.languages)) {
      totals.byState[lang.state] = (totals.byState[lang.state] || 0) + 1;
      totals.calls += lang.calls; totals.claimed += lang.claimed; totals.unclaimed += lang.unclaimed; totals.unparsed += lang.unparsed;
    }
    for (const c of r.calls) {
      if (!c.api) continue;
      const a = apis.get(c.api) || { api: c.api, calls: 0, unclaimed: 0, repos: new Set(), places: new Set() };
      a.calls++;
      if (!c.claimed) a.unclaimed++;
      a.repos.add(repo);
      a.places.add(`${repo}|${c.file}`);
      apis.set(c.api, a);
    }
  }
  const table = [...apis.values()]
    .map((a) => ({ api: a.api, calls: a.calls, unclaimed: a.unclaimed, repos: a.repos.size, files: a.places.size }))
    .sort((x, y) => y.unclaimed - x.unclaimed || y.calls - x.calls || x.api.localeCompare(y.api));
  return { state: 'ok', reason: null, repos, totals, apis: table, unreadable };
}

/**
 * What a reader of the fleet needs from buildFrontier: totals, the APIs with the most unclaimed
 * calls (up to `top`, the cut stated), and per repo the count and the state of each language — never
 * the call list, which belongs to a drill-down. Deterministic: repos sorted by name.
 */
export function frontierSummary(f, { top = 25 } = {}) {
  const byRepo = {};
  for (const repo of Object.keys(f.repos || {}).sort()) {
    const r = f.repos[repo];
    const langs = {};
    for (const lang of Object.keys(r.languages).sort()) {
      const l = r.languages[lang];
      langs[lang] = { state: l.state, calls: l.calls, unclaimed: l.unclaimed, ...(l.reason ? { reason: l.reason } : {}) };
    }
    byRepo[repo] = { calls: r.calls.length, unclaimed: r.calls.filter((c) => !c.claimed).length, languages: langs };
  }
  const apis = f.apis || [];
  return {
    state: f.state, reason: f.reason || null, totals: f.totals,
    apis: apis.slice(0, top), apisCut: apis.length > top ? { shown: top, of: apis.length } : null,
    byRepo,
    ...(f.unreadable && f.unreadable.length ? { unreadable: f.unreadable } : {}),
  };
}
