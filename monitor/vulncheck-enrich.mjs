// monitor/vulncheck-enrich.mjs — is a finding's CVE actively exploited, per VulnCheck's KEV catalog?
//
// Free Community tier (vulncheck.com/community): KEV + NVD++ + XDB, one API key, no cost. This
// closes the exact gap external audits of this category (a Wiz "top 28 OSS tools" piece, read
// 2026-09-01) name correctly: OSS SAST/SCA tools report a vulnerability EXISTS, never whether it is
// being exploited right now. VulnCheck's KEV catalog is exactly that second fact, for free.
//
// TWO PHASES, like every other scanner lane in this tree: a FETCH step that talks to the live API
// and writes a cache artifact (the one place in monitor/ that calls this third party — never called
// implicitly from rollup, which makes no outbound network calls of its own), and a PURE enrichment
// step that reads the cache and annotates findings. `apiKey` is always a caller-supplied parameter,
// never resolved here — admin/integrations.mjs owns the credential store and monitor/ never imports
// from admin/ (the reverse is the house convention); a CLI run falls back to CW_VULNCHECK_KEY only
// because that is the same env var admin/integrations.mjs already treats as the override.
//
// Verified against the LIVE API 2026-09-01 (community tier, real key, per this repo's own rule that
// a parser is written against a real run, not documentation): GET /v3/index/vulncheck-kev?cve=<id>
// for a single lookup; paginates in units of `limit` (<=1000/page observed) for a bulk fetch, capped
// at max_pages=6 for this tier — the live catalog was 5,201 entries, which fits in 6 pages of 1000
// with room to spare. A CVE not in KEV returns {data:[], _meta:{total_documents:0}}, never an error.
// A bad/expired key returns HTTP 401 {error:true, errors:["unauthorized"]} — that is the ONE state
// this module treats as unknown rather than "nothing is exploited": a token rejection must never
// render as a clean scan.
//
// unknown, clean and finding kept apart: the same three-state discipline as engine-identity.mjs's probe/baseline states:
//   activelyExploited: true   the CVE IS in VulnCheck's KEV catalog — a real, sourced finding
//   activelyExploited: false  the catalog was fetched successfully and the CVE is NOT in it
//   activelyExploited: null   no key configured, the fetch failed, or no cache exists yet — UNKNOWN,
//                             never rendered as "not exploited"
//
// Env (read at call time): CW_VULNCHECK_KEV_CACHE, CW_NOW.
//
//   node monitor/vulncheck-enrich.mjs --refresh          fetch the full catalog, write the cache (needs CW_VULNCHECK_KEY)
//   node monitor/vulncheck-enrich.mjs --status [--json]  report cache age and entry count

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cachePath = () => process.env.CW_VULNCHECK_KEV_CACHE || join(REPO, '.claude', 'store', 'vulncheck-kev-cache.json');

const KEV_URL = 'https://api.vulncheck.com/v3/index/vulncheck-kev';
const PAGE_LIMIT = 1000;
const MAX_PAGES = 6; // observed cap on the community tier; page 7 returns data:[] rather than an error

/** One page of the KEV index. Never throws on a well-formed HTTP error — the caller classifies it. */
async function fetchPage({ apiKey, page, fetchImpl, timeoutMs }) {
  const url = `${KEV_URL}?limit=${PAGE_LIMIT}&page=${page}`;
  const res = await fetchImpl(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const CVE_ID_RE = /^CVE-\d{4}-\d{4,7}$/i;

/** One catalog entry, trimmed to what enrichment and a reader both need — not the full XDB payload. */
function trimEntry(e) {
  return {
    cve: Array.isArray(e.cve) ? e.cve.filter((c) => CVE_ID_RE.test(String(c))) : [],
    dateAdded: e.date_added || null,
    cisaDateAdded: e.cisa_date_added || null,
    knownRansomwareCampaignUse: e.knownRansomwareCampaignUse || null,
    vulnerabilityName: e.vulnerabilityName || null,
  };
}

/**
 * Fetch the full KEV catalog. Returns a typed state, never throws for an ordinary API failure —
 * only a genuinely unexpected error (a network layer bug) is allowed to throw.
 *
 * @returns {Promise<{state:'ok', entries:object[], fetchedAt:string}
 *   | {state:'no-key'}
 *   | {state:'auth-failed', detail:string}
 *   | {state:'fetch-failed', detail:string}>}
 */
export async function fetchKevCatalog({ apiKey, fetchImpl = fetch, timeoutMs = 15000, maxPages = MAX_PAGES } = {}) {
  if (!apiKey) return { state: 'no-key' };
  const entries = [];
  for (let page = 1; page <= maxPages; page++) {
    let r;
    try { r = await fetchPage({ apiKey, page, fetchImpl, timeoutMs }); }
    catch (e) { return { state: 'fetch-failed', detail: `${e && e.name}: ${e && e.message}` }; }
    if (r.status === 401 || r.status === 403) {
      return { state: 'auth-failed', detail: (r.body && Array.isArray(r.body.errors) && r.body.errors[0]) || `HTTP ${r.status}` };
    }
    if (r.status !== 200 || !r.body || !Array.isArray(r.body.data)) {
      return { state: 'fetch-failed', detail: `HTTP ${r.status}, unexpected body shape` };
    }
    for (const e of r.body.data) if (e && typeof e === 'object') entries.push(trimEntry(e));
    const totalPages = r.body._meta && Number(r.body._meta.total_pages);
    if (r.body.data.length < PAGE_LIMIT || (Number.isFinite(totalPages) && page >= totalPages)) break;
  }
  return { state: 'ok', entries, fetchedAt: nowISO() };
}

export function saveCatalogCache(result) {
  if (result.state !== 'ok') throw new Error(`refusing to cache a non-ok fetch state: ${result.state}`);
  writeAtomic(cachePath(), `${JSON.stringify({ fetchedAt: result.fetchedAt, entries: result.entries }, null, 2)}\n`);
  return { path: cachePath(), count: result.entries.length };
}

/** ENOENT is "no cache yet"; anything else THROWS — fail closed, per this repo's standing rule. */
export function loadCatalogCache() {
  let raw;
  try { raw = readFileSync(cachePath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const c = JSON.parse(raw);
  if (!c || !Array.isArray(c.entries) || typeof c.fetchedAt !== 'string') {
    throw new Error(`vulncheck KEV cache at ${cachePath()} is malformed`);
  }
  return c;
}

/** A lookup index over cached entries: CVE id -> the entry (there may be several CVEs per entry). */
function indexByCve(entries) {
  const byId = new Map();
  for (const e of entries) for (const c of e.cve) byId.set(c.toUpperCase(), e);
  return byId;
}

/**
 * Additive enrichment over finding rows, same discipline as corroborate.mjs: no row removed, no
 * identity field touched, only `activelyExploited` (+ `kevDateAdded` when true) set.
 *
 * @param {Array} findings rows carrying an `id` (advisory id — a CVE id or something else entirely)
 *   and/or an `aliases` array, matching the shape rollup.mjs already produces for osv/npm rows
 * @param {{entries:object[]}|null} cache from loadCatalogCache() — null means no cache exists, and
 *   every row gets `activelyExploited: null` rather than a guess
 */
export function enrichWithKev(findings, cache) {
  const rows = findings || [];
  if (!cache) { for (const f of rows) if (f) f.activelyExploited = null; return rows; }
  const byId = indexByCve(cache.entries);
  for (const f of rows) {
    if (!f) continue;
    const candidates = [f.id, ...(Array.isArray(f.aliases) ? f.aliases : [])].filter(Boolean).map((s) => String(s).toUpperCase());
    const hit = candidates.map((c) => byId.get(c)).find(Boolean);
    f.activelyExploited = Boolean(hit);
    if (hit) { f.kevDateAdded = hit.dateAdded; f.kevRansomware = hit.knownRansomwareCampaignUse === 'Known'; }
  }
  return rows;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('node monitor/vulncheck-enrich.mjs --refresh          fetch the full KEV catalog (needs CW_VULNCHECK_KEY), write the cache\n'
      + 'node monitor/vulncheck-enrich.mjs --status [--json]  report cache age and entry count\n'
      + 'exit 0 ok, 1 fetch failed, 2 no key / no cache');
    process.exit(0);
  }
  if (argv.includes('--refresh')) {
    const apiKey = process.env.CW_VULNCHECK_KEY;
    const r = await fetchKevCatalog({ apiKey });
    if (r.state === 'no-key') { console.error('vulncheck-enrich: CW_VULNCHECK_KEY is not set'); process.exit(2); }
    if (r.state !== 'ok') { console.error(`vulncheck-enrich: ${r.state} — ${r.detail}`); process.exit(1); }
    const saved = saveCatalogCache(r);
    console.log(`fetched ${saved.count} KEV entries -> ${saved.path}`);
    process.exit(0);
  }
  // default / --status
  let cache = null;
  try { cache = loadCatalogCache(); }
  catch (e) { console.error(`vulncheck-enrich: cache unreadable — ${e.message}`); process.exit(1); }
  const out = cache
    ? { state: 'cached', fetchedAt: cache.fetchedAt, entries: cache.entries.length }
    : { state: 'no-cache' };
  if (argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else console.log(cache ? `cached: ${out.entries} KEV entries, fetched ${out.fetchedAt}` : 'no cache yet — run --refresh');
  process.exit(cache ? 0 : 2);
}
