#!/usr/bin/env node
// bin/advisory-index.mjs — distils GitHub's advisory database into an id → CVSS index.
//
// OSV ships v4 vectors without scores and v4 is a lookup table, so the score must come from data.
// Vendored like monitor/data/{kev,epss}.json: offline, deterministic, off a rate limit.
//
// usage:
//   node bin/advisory-index.mjs --from-reports    index the advisories the fleet has actually seen
//   node bin/advisory-index.mjs --ids A,B,C       index named advisories
//   node bin/advisory-index.mjs --pages N|all     broad sweep, checkpointed every 25 pages
//   node bin/advisory-index.mjs --fill-nvd        NVD by CVE alias for advisories with no CVSS
//
// env: CW_ADVISORY_INDEX · CW_GITHUB_API · CW_GITHUB_TOKEN/GITHUB_TOKEN · CW_NVD_API · CW_NVD_KEY
//      CW_REPORTS_DIR · CW_NOW

import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..');

// Read env at CALL time — a module-level capture defeats the override for any test that sets it after.
export const indexPath = () => process.env.CW_ADVISORY_INDEX || join(CW, 'monitor', 'data', 'advisory-cvss.json');
const apiBase = () => process.env.CW_GITHUB_API || 'https://api.github.com';
const token = () => process.env.CW_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
const reportsDir = () => process.env.CW_REPORTS_DIR || join(CW, 'reports');

export const EMPTY = { source: 'github-advisory-database', generated: null, count: 0, advisories: {} };

/** ENOENT is the only absence; a parse failure is a broken index, never an empty one. */
export function loadIndex(p = indexPath()) {
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { ...EMPTY, advisories: {} };
    throw e;
  }
  const j = JSON.parse(raw);   // unguarded on purpose: a corrupt index must stop the run
  if (!j || typeof j.advisories !== 'object' || !j.advisories) {
    throw new Error(`advisory index at ${p} has no advisories map`);
  }
  return j;
}

/** GitHub's shape → the fields a grade needs. Null fields are omitted, not stored as zero. */
export function distil(a) {
  if (!a || !a.ghsa_id) return null;
  // CWE rides on 100% of advisories where CVSS reaches 91.9%, and it is the only real TAXONOMY of
  // the two. Ids only — names dedupe into the index's cweNames map rather than 34k times over.
  const cwe = (a.cwes || []).map((c) => c && c.cwe_id).filter(Boolean).sort();
  const names = Object.fromEntries((a.cwes || []).filter((c) => c && c.cwe_id && c.name)
    .map((c) => [c.cwe_id, c.name]));
  const s = a.cvss_severities || {};
  const v3 = (s.cvss_v3 && s.cvss_v3.vector_string) || (a.cvss && a.cvss.vector_string) || null;
  const s3 = (s.cvss_v3 && s.cvss_v3.score) || (a.cvss && a.cvss.score) || null;
  const v4 = (s.cvss_v4 && s.cvss_v4.vector_string) || null;
  const s4 = (s.cvss_v4 && s.cvss_v4.score) || null;
  const cve = a.cve_id || null;
  const label = a.severity ? String(a.severity).toLowerCase() : null;
  const out = {};
  if (label) out.label = label;
  if (cve) out.cve = cve;
  if (v3) { out.v3 = v3; if (s3) out.s3 = s3; }
  if (v4) { out.v4 = v4; if (s4) out.s4 = s4; }
  if (cwe.length) out.cwe = cwe;
  // Still indexed when GitHub cannot score it: asked-and-got-nothing differs from never-asked.
  return { id: a.ghsa_id, entry: out, names };
}

async function gh(pathname) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'commitwork' };
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  const r = await fetch(`${apiBase()}${pathname}`, { headers, signal: AbortSignal.timeout(30000) });
  if (r.status === 403 || r.status === 429) {
    throw new Error(`rate limited (${r.status}) — set CW_GITHUB_TOKEN for 5000/hr`);
  }
  if (!r.ok) throw new Error(`GitHub ${r.status} for ${pathname}`);
  return { body: await r.json(), link: r.headers.get('link') || '' };
}

// Decoded on capture: the Link header's cursor is already percent-encoded, and re-encoding it on
// use turns %3D into %253D, which GitHub answers with a 400.
const nextCursor = (link) => {
  const m = link.match(/[?&]after=([^&>]+)[^>]*>;\s*rel="next"/);
  return m ? decodeURIComponent(m[1]) : null;
};

/** Advisory ids the fleet has seen — the self-maintaining seed. */
export function idsFromReports(dir = reportsDir()) {
  const ids = new Set();
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'vendor-scan.json') {
        try {
          const j = JSON.parse(readFileSync(p, 'utf8'));
          for (const f of j.findings || []) if (f && f.id) ids.add(String(f.id));
        } catch { /* one unreadable artifact must not zero the rest */ }
      }
    }
  };
  walk(dir);
  return [...ids].sort();
}

// Per-ENTRY merge, not per-id replace. A GitHub re-fetch carries no v2 — GitHub has none — so
// replacing the entry would silently drop the v2 that --fill-nvd went to NVD for. Fresh keys still
// win where they exist, so a corrected label or a newly published vector still lands.
export function merge(existing, fresh, names = {}) {
  const advisories = { ...(existing.advisories || {}) };
  for (const [id, entry] of Object.entries(fresh)) advisories[id] = { ...(advisories[id] || {}), ...entry };
  return {
    ...EMPTY,
    generated: nowISO(),
    count: Object.keys(advisories).length,
    cweNames: { ...(existing.cweNames || {}), ...names },
    advisories,
  };
}

/** Sorted keys, stable field order: same inputs ⇒ byte-identical file. */
export function serialise(index) {
  const ids = Object.keys(index.advisories).sort();
  const advisories = {};
  for (const id of ids) {
    const e = index.advisories[id];
    const o = {};
    for (const k of ['label', 'cve', 'cwe', 'nvd', 'v2', 's2', 'v3', 's3', 'v4', 's4']) if (e[k] !== undefined) o[k] = e[k];
    advisories[id] = o;
  }
  const cweNames = Object.fromEntries(Object.keys(index.cweNames || {}).sort()
    .map((k) => [k, index.cweNames[k]]));
  return `${JSON.stringify({ ...index, count: ids.length, cweNames, advisories }, null, 2)}\n`;
}

export function write(index, p = indexPath()) {
  writeAtomic(p, serialise(index));
  return p;
}

export async function fetchIds(ids) {
  const out = {};
  const names = {};
  for (const id of ids) {
    const { body } = await gh(`/advisories/${encodeURIComponent(id)}`);
    const d = distil(body);
    if (d) { out[d.id] = d.entry; Object.assign(names, d.names); }
  }
  return { out, names };
}

// onPage checkpoints: a 250-page sweep that dies at page 240 must not lose 239 pages of work.
// Merging only ever adds, so an early write is safe.
export async function fetchPages(pages, after = null, onPage = null) {
  const out = {};
  const names = {};
  let cursor = after;
  let n = 0;
  for (let i = 0; i < pages; i += 1) {
    const q = `/advisories?per_page=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`;
    const { body, link } = await gh(q);
    if (!Array.isArray(body) || !body.length) break;
    for (const a of body) { const d = distil(a); if (d) { out[d.id] = d.entry; Object.assign(names, d.names); } }
    n += 1;
    cursor = nextCursor(link);
    if (onPage) onPage({ page: n, total: Object.keys(out).length, cursor, out, names });
    if (!cursor) break;
  }
  return { out, cursor, pagesRead: n, names };
}

// NVD, keyed by CVE alias — the ONLY source of v2, and OSV/GitHub carry none. Old advisories with a
// CVE but no CVSS are exactly the gap this closes.
export async function fetchNvd(cve) {
  const key = process.env.CW_NVD_KEY || '';
  const headers = { 'user-agent': 'commitwork', ...(key ? { apiKey: key } : {}) };
  const url = `${process.env.CW_NVD_API || 'https://services.nvd.nist.gov/rest/json/cves/2.0'}?cveId=${encodeURIComponent(cve)}`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (r.status === 403 || r.status === 429) throw new Error(`NVD rate limited (${r.status}) — set CW_NVD_KEY`);
  if (!r.ok) throw new Error(`NVD ${r.status} for ${cve}`);
  const j = await r.json();
  const m = (((j.vulnerabilities || [])[0] || {}).cve || {}).metrics || {};
  const pick = (fam) => {
    const d = ((m[fam] || [])[0] || {}).cvssData;
    return d && d.vectorString ? { vector: d.vectorString, score: d.baseScore } : null;
  };
  return {
    v3: pick('cvssMetricV31') || pick('cvssMetricV30'),
    v2: pick('cvssMetricV2'),
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : null; };
  const p = indexPath();
  const existing = loadIndex(p);
  let fresh = {};
  let cweNames = {};
  try {
    if (args.includes('--from-reports')) {
      const seen = idsFromReports();
      // Only unknown ids; re-fetch deliberately with --ids.
      const want = seen.filter((id) => !existing.advisories[id]);
      process.stdout.write(`advisories seen: ${seen.length} · already indexed: ${seen.length - want.length} · fetching: ${want.length}\n`);
      ({ out: fresh, names: cweNames } = await fetchIds(want));
    } else if (val('--ids')) {
      ({ out: fresh, names: cweNames } = await fetchIds(val('--ids').split(',').map((s) => s.trim()).filter(Boolean)));
    } else if (val('--pages')) {
      const want = val('--pages') === 'all' ? 100000 : (Number(val('--pages')) || 1);
      const r = await fetchPages(want, val('--after'), (pg) => {
        if (pg.page % 25) return;
        write(merge(loadIndex(indexPath()), pg.out, pg.names), indexPath());
        process.stdout.write(`  page ${pg.page} · ${pg.total} advisories · checkpointed\n`);
      });
      fresh = r.out; cweNames = r.names;
      if (r.cursor) process.stdout.write(`more remain — resume with: --pages all --after ${r.cursor}\n`);
    } else if (args.includes('--fill-nvd')) {
      // Only advisories with a CVE and no CVSS at all: everything else already grades.
      const seen = new Set(idsFromReports());
      const gaps = Object.entries(existing.advisories)
        .filter(([, e]) => e.cve && !e.v3 && !e.v4 && !e.v2 && e.nvd !== 'none').map(([id, e]) => [id, e.cve])
        // fleet-seen first, so a bounded run buys coverage where it is actually read
        .sort((a, b) => (seen.has(b[0]) ? 1 : 0) - (seen.has(a[0]) ? 1 : 0) || a[0].localeCompare(b[0]));
      const limit = Number(val('--limit')) || gaps.length;
      const pause = process.env.CW_NVD_KEY ? 700 : 6500;   // NVD: 5 req/30s open, 50/30s with a key
      process.stdout.write(`ungraded with a CVE alias: ${gaps.length} · fetching ${Math.min(limit, gaps.length)} · ~${Math.round(Math.min(limit, gaps.length) * pause / 60000)} min\n`);
      let n = 0;
      let skipped = 0;
      for (const [id, cve] of gaps.slice(0, limit)) {
        if (n) await new Promise((r) => { setTimeout(r, pause); });
        let got;
        try {
          got = await fetchNvd(cve);
        } catch (e) {
          // One flaky CVE must not end a 1,500-request run — the first attempt died on a single
          // 30s timeout after 698 fills. A RATE LIMIT is different: continuing there makes it worse,
          // so that one still stops the run.
          if (/rate limited/.test(e.message)) throw e;
          skipped += 1;
          process.stdout.write(`  ${id} ${cve} — SKIPPED (${e.message})\n`);
          continue;
        }
        const e2 = { ...existing.advisories[id] };
        if (got.v3) { e2.v3 = got.v3.vector; e2.s3 = got.v3.score; }
        if (got.v2) { e2.v2 = got.v2.vector; e2.s2 = got.v2.score; }
        // Asked and got nothing differs from never-asked — the same rule distil() already applies to
        // GitHub. Without it every empty CVE is re-queried on every run: 85 lookups produced 55
        // gaps because ~30 were asked twice across two runs.
        if (!got.v3 && !got.v2) e2.nvd = 'none';
        fresh[id] = e2;
        n += 1;
        process.stdout.write(`  ${id} ${cve} → ${[got.v3 && 'v3', got.v2 && 'v2'].filter(Boolean).join('+') || 'nothing'}\n`);
        if (n % 25 === 0) write(merge(loadIndex(p), fresh, cweNames), p);
      }
      // A silent skip count is a shrunken denominator; state it even when zero.
      process.stdout.write(`fetched ${n} · skipped ${skipped}\n`);
    } else {
      process.stdout.write('usage: --from-reports | --ids A,B | --pages N|all [--after cursor] | --fill-nvd\n');
      process.exit(2);
    }
  } catch (e) {
    // A partial fetch must not truncate a good index — nothing is written on failure.
    process.stderr.write(`advisory-index: ${e.message}\n`);
    process.exit(1);
  }
  const merged = merge(existing, fresh, cweNames);
  write(merged, p);
  const graded = Object.values(merged.advisories).filter((e) => e.v2 || e.v3 || e.v4).length;
  const classed = Object.values(merged.advisories).filter((e) => e.cwe).length;
  process.stdout.write(`wrote ${p} — ${merged.count} advisories, ${graded} with a CVSS vector, ${classed} with a CWE\n`);
}
