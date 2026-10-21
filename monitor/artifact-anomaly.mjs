#!/usr/bin/env node
// monitor/artifact-anomaly.mjs — byte-identical-husk detector: one tool writing one identical
// zero-finding artifact into enough unrelated repos that "all clean, same bytes" stops being
// plausible. One member with a real finding clears the whole group.
//
// usage: node monitor/artifact-anomaly.mjs [reportsDir]
//   reportsDir defaults to CW_ANOMALY_REPORTS_DIR, else the registry's reports root.
//   Pass a single sweep-* batch dir to scope the scan to one run.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './lockfile.mjs';
import { SCANNER_SPECS } from './extractors.mjs';
// The one declaration of which lanes need a live target; never re-derive it here.
import { RUNTIME_CATEGORIES } from './scanner-checks.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// One resolver for the sweep's write and the panel's read (admin/routes/correlations.mjs).
export const anomaliesPath = (reportsDir) => process.env.CW_ANOMALY_OUT || join(reportsDir, 'artifact-anomalies.json');

// ── the roster, derived from SCANNER_SPECS ───────────────────────────────────────────────────────
// The first single-quoted literal after the `d,` argument in each extractor closure IS the
// artifact filename — read from the closure source so there is no second filename list to drift.
const FILENAME_RE = /\(\s*d\s*,\s*'([^']+)'/;

// [{category, checkId, filename}], sorted by category.
export function artifactRoster(specs = SCANNER_SPECS) {
  const roster = [];
  for (const spec of specs || []) {
    const [category, checkId, fn] = spec;
    if (typeof fn !== 'function') continue;
    const m = fn.toString().match(FILENAME_RE);
    if (!m) continue; // an extractor with no on-disk filename literal — nothing to hash, not a guess
    roster.push({ category, checkId, filename: m[1] });
  }
  roster.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return roster;
}

export function sha256Bytes(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// ── discovery: accepts one batch dir or the whole reports root ──────────────────────────────────
function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

/** [{repo, dir, batch}] — batch is '' for a bare (non-`sweep-*`) repo dir. */
export function discoverRepoDirs(reportsDir) {
  let entries = [];
  try { entries = readdirSync(reportsDir); } catch { return []; }
  const out = [];
  for (const name of entries.sort()) {
    if (name.startsWith('.')) continue;
    const p = join(reportsDir, name);
    if (!isDir(p)) continue;
    if (name.startsWith('sweep-')) {
      let inner = [];
      try { inner = readdirSync(p); } catch { continue; }
      for (const r of inner.sort()) {
        if (r.startsWith('.') || r === 'history') continue;
        const rp = join(p, r);
        if (isDir(rp)) out.push({ repo: r, dir: rp, batch: name });
      }
    } else {
      out.push({ repo: name, dir: p, batch: '' });
    }
  }
  return out;
}

// How many findings does the ARTIFACT carry (vs the category's slice of it)? -> N | null.
// Shape-sniffed: SARIF runs[].results, bare JSON array, or JSONL. null = unknown, and unknown
// must never clear a group.
export function artifactFindingCount(buf) {
  let text; try { text = buf.toString('utf8'); } catch { return null; }
  const trimmed = text.trim();
  if (!trimmed) return 0;                                   // empty file carries nothing, definitively
  // Whole-document JSON first; JSONL only after that fails (a JSONL file starts with `{` too).
  let j = null, parsed = false;
  try { j = JSON.parse(trimmed); parsed = true; } catch { /* not one document — may still be JSONL */ }
  if (parsed) {
    if (Array.isArray(j)) return j.length;
    if (j && Array.isArray(j.runs)) return j.runs.reduce((n, r) => n + ((r && Array.isArray(r.results)) ? r.results.length : 0), 0);
    return null;                                             // a JSON object with no runs[] says nothing
  }
  // JSONL: every line must parse — a half-JSONL file is unknown, not a count.
  const lines = trimmed.split('\n').filter((l) => l.trim());
  for (const l of lines) { try { JSON.parse(l); } catch { return null; } }
  return lines.length;
}

// Per repo, the `rank`-th newest batch entry (0 = latest). Batch names sort lexicographically =
// chronologically; a bare dir sorts before every batch name. Exported for H1a.
export function chooseBatches(repoDirs, rank = 0) {
  const byRepo = new Map();
  for (const e of repoDirs || []) {
    if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
    byRepo.get(e.repo).push(e);
  }
  const out = [];
  for (const list of byRepo.values()) {
    list.sort((a, b) => (a.batch < b.batch ? 1 : a.batch > b.batch ? -1 : 0));   // newest first
    if (list[rank]) out.push(list[rank]);
  }
  return out;
}

export function collectSamples(reportsDir, roster = artifactRoster(), { rank = 0 } = {}) {
  const specByCategory = new Map(SCANNER_SPECS.map(([cat, , fn]) => [cat, fn]));
  const repoDirs = discoverRepoDirs(reportsDir);
  // One sample per (repo, category), most recent batch only — "spans N repos" must mean N repos.
  const chosen = chooseBatches(repoDirs, rank);
  const samples = [];
  for (const { repo, dir } of chosen) {
    for (const { category, filename } of roster) {
      const p = join(dir, filename);
      if (!existsSync(p)) continue;
      let buf; try { buf = readFileSync(p); } catch { continue; } // unreadable — nothing to hash, not a guess
      const fn = specByCategory.get(category);
      let counts = null;
      if (fn) { try { counts = fn(dir); } catch { counts = null; } }
      const total = (counts && Number.isFinite(Number(counts.total))) ? Number(counts.total) : null;
      // artifactTotal is what the FILE contains — the number the husk question turns on.
      samples.push({ category, repo, file: filename, hash: sha256Bytes(buf), bytes: buf.length, total, artifactTotal: artifactFindingCount(buf) });
    }
  }
  return samples;
}

// ── the pure computation ─────────────────────────────────────────────────────────────────────────
export const DEFAULT_MIN_REPOS = 5;
// No silent caps: `truncated` states dropped names; `repoCount` states true breadth.
export const DEFAULT_REPO_CAP = 200;
// Information floor: below this an artifact has no room to differ between repos, so byte-identity
// carries no information (`[]` is gitleaks' canonical clean result). CW_ANOMALY_MIN_BYTES overrides.
export const DEFAULT_MIN_BYTES = 512;

// Groups samples by (category, hash). Anomaly only when: spans >= minRepos distinct repos, at
// least minBytes, no sibling category reading the same (repo, file) reported a finding, and every
// member reports total === 0. A null total is "not a confirmed zero" and disqualifies the group.
export function findAnomalies(samples, opts) { return findAnomaliesDetailed(samples, opts).anomalies; }

// Same computation plus what it declined to report and why ('below-information-floor',
// 'artifact-carries-findings') — a suppressed group is not an anomaly, but must stay visible.
export function findAnomaliesDetailed(samples, { minRepos = DEFAULT_MIN_REPOS, repoCap = DEFAULT_REPO_CAP, minBytes = DEFAULT_MIN_BYTES } = {}) {
  // (repo, file) -> does that artifact carry real findings (itself, or via a sibling category)?
  const fileHasFindings = new Set();
  for (const s of samples || []) {
    if (!s || typeof s.file !== 'string' || !s.file) continue;
    if (Number(s.total) > 0 || Number(s.artifactTotal) > 0) fileHasFindings.add(`${s.repo} ${s.file}`);
  }
  const groups = new Map();
  for (const s of samples || []) {
    if (!s || typeof s.category !== 'string' || typeof s.hash !== 'string' || !s.hash || typeof s.repo !== 'string') continue;
    const key = `${s.category}\0${s.hash}`;
    let g = groups.get(key);
    if (!g) { g = { category: s.category, hash: s.hash, bytes: Number(s.bytes) || 0, repos: new Set(), allZero: true, sharedReal: false }; groups.set(key, g); }
    g.repos.add(s.repo);
    if (s.total !== 0) g.allZero = false; // covers both a real finding (>0) and an unconfirmed sample (null)
    if (typeof s.file === 'string' && s.file && fileHasFindings.has(`${s.repo} ${s.file}`)) g.sharedReal = true;
  }
  const floor = Math.max(1, Math.trunc(minRepos) || DEFAULT_MIN_REPOS);
  const cap = Math.max(0, Math.trunc(repoCap));
  const byteFloor = Math.max(0, Math.trunc(minBytes));
  const out = [];
  const suppressed = [];
  for (const g of groups.values()) {
    if (!g.allZero) continue;
    const repoCount = g.repos.size;
    if (repoCount < floor) continue;
    // Suppressions apply only to groups that would otherwise have been reported.
    if (g.sharedReal) {
      suppressed.push({ category: g.category, hash: g.hash, repoCount, bytes: g.bytes, reason: 'artifact-carries-findings' });
      continue;
    }
    if (g.bytes < byteFloor) {
      suppressed.push({ category: g.category, hash: g.hash, repoCount, bytes: g.bytes, reason: 'below-information-floor' });
      continue;
    }
    const sortedRepos = [...g.repos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // cap <= 0 reads as "no cap", never as an emptied repo list.
    const showAll = cap <= 0 || sortedRepos.length <= cap;
    out.push({
      category: g.category,
      hash: g.hash,
      repoCount,
      bytes: g.bytes,
      repos: showAll ? sortedRepos : sortedRepos.slice(0, cap),
      truncated: showAll ? 0 : sortedRepos.length - cap,
    });
  }
  const byCategoryThenHash = (a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0)
    || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
  out.sort(byCategoryThenHash);
  suppressed.sort(byCategoryThenHash);
  return { anomalies: out, suppressed };
}

// ── H1a: a lane that stopped emitting ─────────────────────────────────────────────────────────────
// A repo whose previous batch carried this category's artifact and whose latest does not has lost
// a lane; minRepos of them is the lane going dark fleet-wide. Kept in its own list — a husk is a
// wrong answer, this is a missing question.
export function findSilentLanes(now, prev, { minRepos = DEFAULT_MIN_REPOS } = {}) {
  const has = (rows) => {
    const s = new Set();
    for (const r of rows || []) if (r && typeof r.category === 'string' && typeof r.repo === 'string') s.add(`${r.repo} ${r.category}`);
    return s;
  };
  const nowSet = has(now), prevSet = has(prev);
  const lost = new Map();                          // category -> repos that had it and no longer do
  for (const key of prevSet) {
    if (nowSet.has(key)) continue;
    const sp = key.indexOf(' ');
    const repo = key.slice(0, sp), category = key.slice(sp + 1);
    if (!lost.has(category)) lost.set(category, []);
    lost.get(category).push(repo);
  }
  const floor = Math.max(1, Math.trunc(minRepos) || DEFAULT_MIN_REPOS);
  const out = [];
  for (const [category, repos] of lost) {
    if (repos.length < floor) continue;
    // A lane still emitting somewhere is being scoped, not going dark; the signal is NOWHERE.
    if ([...nowSet].some((k) => k.slice(k.indexOf(' ') + 1) === category)) continue;
    // Runtime lanes are quiet by design without a live target — labelled, still reported.
    out.push({ category, repoCount: repos.length, repos: repos.sort(), runtime: RUNTIME_CATEGORIES.includes(category) });
  }
  out.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return out;
}

// ── the write ─────────────────────────────────────────────────────────────────────────────────────
// Crash-safe: a reader never sees a torn artifact-anomalies.json.
export function writeAnomalies(outPath, anomalies) {
  writeAtomic(outPath, JSON.stringify(anomalies, null, 2));
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
const isMain = isMainModule(import.meta.url);

async function defaultReportsDir() {
  // Lazily imported: callers passing an explicit reportsDir never need a registry to exist.
  const { reportsRootDir } = await import('./area.mjs');
  return reportsRootDir();
}

async function main() {
  // Read env at call time — a const at import defeats test overrides.
  const minRepos = process.env.CW_ANOMALY_MIN_REPOS ? Number(process.env.CW_ANOMALY_MIN_REPOS) : DEFAULT_MIN_REPOS;
  const repoCap = process.env.CW_ANOMALY_REPO_CAP ? Number(process.env.CW_ANOMALY_REPO_CAP) : DEFAULT_REPO_CAP;
  const minBytes = process.env.CW_ANOMALY_MIN_BYTES ? Number(process.env.CW_ANOMALY_MIN_BYTES) : DEFAULT_MIN_BYTES;
  const reportsDir = process.argv[2] || process.env.CW_ANOMALY_REPORTS_DIR || await defaultReportsDir();
  const outPath = anomaliesPath(reportsDir);

  const roster = artifactRoster();
  const samples = collectSamples(reportsDir, roster);
  const { anomalies, suppressed } = findAnomaliesDetailed(samples, { minRepos, repoCap, minBytes });
  writeAnomalies(outPath, anomalies);

  const totalRepos = new Set(samples.map((s) => s.repo)).size;
  console.log(`artifact-anomaly: scanned ${totalRepos} repo(s) under ${reportsDir} across ${roster.length} categor${roster.length === 1 ? 'y' : 'ies'}`);
  if (anomalies.length) {
    for (const a of anomalies) {
      console.log(`  ANOMALY  ${a.category}  ${a.hash.slice(0, 12)}…  ${a.repoCount} repos, ${a.bytes} bytes each${a.truncated ? ` (showing ${a.repos.length}, ${a.truncated} more)` : ''}`);
    }
    console.log(`artifact-anomaly: ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'} — see ${outPath}`);
  } else {
    console.log(`artifact-anomaly: no byte-identical zero-finding groups spanning >= ${minRepos} repos — ${outPath}`);
  }
  // Printed, never in the written artifact — a suppressed group is not an anomaly.
  for (const s of suppressed) {
    console.log(`  suppressed  ${s.category}  ${s.hash.slice(0, 12)}…  ${s.repoCount} repos, ${s.bytes} bytes — ${s.reason}`);
  }
  // H1a — reported separately from anomalies on purpose.
  const prevSamples = collectSamples(reportsDir, roster, { rank: 1 });
  const silent = findSilentLanes(samples, prevSamples, { minRepos });
  for (const l of silent) {
    console.log(`  SILENT LANE  ${l.category}  emitted for ${l.repoCount} repo(s) last sweep and emits NOWHERE now`
      + `${l.runtime ? ' (RUNTIME lane — needs a live target; expected when nothing is up, but runtime coverage is zero)' : ''}`);
  }
  if (!silent.length) console.log(`artifact-anomaly: no lane went dark across >= ${minRepos} repos since the previous sweep`);
}

if (isMain) {
  main().catch((e) => { console.error(`artifact-anomaly: ${(e && e.stack) || e}`); process.exitCode = 1; });
}

// _test-only export for monitor/test/artifact-anomaly.test.mjs.
export const _internal = { FILENAME_RE, HERE };
