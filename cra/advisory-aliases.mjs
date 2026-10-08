// cra/advisory-aliases.mjs — the missing plumbing: GO-2026-xxxx ↔ CVE-xxxx.
//
// THE PROBLEM IT SOLVES, MEASURED. govulncheck proves reachability against Go vulnerability
// database ids (GO-2026-4479). The dependency lane records findings against CVEs — 82% of 11,430
// fleet-wide. The join rate between them was 0.31% (36 of 11,430), so 61 proven-reachable and 148
// analysed-with-no-path rows never reached a document, and the reachability axis would have read
// `unknown` almost everywhere. Surfacing that number would have been honest and useless.
//
// NO THIRD PARTY, NO NETWORK, NO LICENCE QUESTION. govulncheck's own JSON stream interleaves
// `{osv:…}` advisory records with the `{finding:…}` rows, and every OSV record carries `aliases`.
// The data has been on disk in every sweep the whole time — monitor/extractors.mjs parses only
// `o.finding` and discards `o.osv`, so it was thrown away at the door. 354 of 355 records in a
// single artifact carry aliases; 10,030 records across the fleet yield 497 distinct CVEs.
//
// Building it from the artifact rather than from GitHub's advisory database is a deliberate choice
// and not only a licensing one (GHSA is CC-BY-4.0 and would be fine to vendor): a network lookup
// would make the join non-deterministic across offline runs, which the house determinism rule
// forbids for anything that reaches a signed document.
//
// TWO HAZARDS, BOTH MEASURED BEFORE THIS WAS WRITTEN:
//   · FAN-OUT is real — 880 GO ids alias to more than one CVE (GO-2021-0159 covers CVE-2015-5739,
//     -5740 and -5741). One Go advisory genuinely does describe several CVEs of the same defect, so
//     a proof propagates to all of them; the DEGREE is recorded so a reader can see it happened.
//   · COLLISION is not — 497 CVEs, each claimed by exactly one GO id, zero collisions. The index
//     still refuses to resolve one rather than pick, because "none today" is not "none ever".
//
// Zero deps. Deterministic: same artifacts ⇒ same index.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const reportsDir = () => process.env.CW_REPORTS_DIR || join(CW, 'reports');

const isAdvisoryId = (s) => /^(CVE|GHSA|GO|RUSTSEC|PYSEC|MAL)-/i.test(String(s || ''));
const up = (s) => String(s || '').toUpperCase();

/**
 * Pull {id, aliases[]} out of one govulncheck JSON stream.
 * The stream is concatenated pretty-printed objects, NOT one per line — split on the top-level
 * brace boundary exactly as monitor/extractors.mjs does, so the two readers cannot disagree.
 */
export function aliasesFromGovulncheck(raw) {
  const out = [];
  for (const chunk of String(raw || '').split(/\n(?=\{)/)) {
    const t = chunk.trim();
    if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    const osv = o && o.osv;
    if (!osv || !osv.id) continue;
    const aliases = (Array.isArray(osv.aliases) ? osv.aliases : []).filter(isAdvisoryId).map(up);
    out.push({ id: up(osv.id), aliases: [...new Set(aliases)].sort() });
  }
  return out;
}

/**
 * Walk reports/ for govulncheck artifacts and build the index.
 * Returns {forward, reverse, collisions, stats} where forward maps an advisory id to every id that
 * names the same vulnerability (INCLUDING itself, so a lookup is total).
 */
export function buildAliasIndex({ dir = reportsDir(), maxDepth = 6 } = {}) {
  const forward = new Map();      // id -> Set(id)
  const seenRecords = { records: 0, withAliases: 0, artifacts: 0 };

  const link = (a, b) => {
    if (!forward.has(a)) forward.set(a, new Set([a]));
    forward.get(a).add(b);
  };

  const walk = (d, depth) => {
    if (depth > maxDepth) return;
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (e.name !== 'govulncheck.json') continue;
      let raw; try { raw = readFileSync(p, 'utf8'); } catch { continue; }
      seenRecords.artifacts++;
      for (const rec of aliasesFromGovulncheck(raw)) {
        seenRecords.records++;
        if (rec.aliases.length) seenRecords.withAliases++;
        // Every id in a record names the same vulnerability, so the group is fully connected.
        const group = [rec.id, ...rec.aliases];
        for (const a of group) for (const b of group) link(a, b);
      }
    }
  };
  if (existsSync(dir)) walk(dir, 0);

  // Reverse: for each non-GO id, which GO advisories claim it. A CVE claimed by two DIFFERENT GO
  // ids is a collision — recorded and REFUSED, never resolved by picking one. Measured zero on
  // 2026-08-23 across 10,030 records; recorded anyway, because none-today is not none-ever.
  const reverse = new Map();
  for (const [id, group] of forward) {
    if (!/^GO-/.test(id)) continue;
    for (const other of group) {
      if (other === id || /^GO-/.test(other)) continue;
      if (!reverse.has(other)) reverse.set(other, new Set());
      reverse.get(other).add(id);
    }
  }
  const collisions = [...reverse.entries()].filter(([, s]) => s.size > 1)
    .map(([id, s]) => ({ id, claimedBy: [...s].sort() }));

  return {
    forward,
    reverse,
    collisions,
    stats: {
      ...seenRecords,
      ids: forward.size,
      aliasedCves: [...reverse.keys()].filter((k) => k.startsWith('CVE-')).length,
      collisions: collisions.length,
    },
  };
}

/**
 * Every id naming the same vulnerability as `id`, itself included. Total: an unknown id resolves
 * to itself alone, so a caller never has to branch on "was it in the index".
 */
export function aliasesOf(index, id) {
  const k = up(id);
  const g = index.forward.get(k);
  return g ? [...g].sort() : [k];
}

/**
 * Resolve a lookup across aliases.
 * `lookup` is called with each candidate id and should return a hit or a falsy value.
 * Returns {hit, via, fanOut} — `via` names the id that actually matched, so a consumer can say
 * "reachability for CVE-X is carried by GO-Y" rather than presenting a proof from nowhere.
 * A COLLIDING id resolves to nothing: an ambiguous proof is refused, not guessed.
 */
export function resolveVia(index, id, lookup) {
  const k = up(id);
  const direct = lookup(k);
  if (direct) return { hit: direct, via: k, fanOut: 1, aliased: false };

  const claimants = index.reverse.get(k);
  if (claimants && claimants.size > 1) {
    return { hit: null, via: null, fanOut: 0, aliased: false, refused: 'ambiguous-alias', claimedBy: [...claimants].sort() };
  }
  const group = aliasesOf(index, k).filter((a) => a !== k);
  for (const a of group) {
    const hit = lookup(a);
    // fanOut is how many ids this vulnerability is known by — recorded so a proof that reached
    // three CVEs from one Go advisory is visible as that, not as three independent findings.
    if (hit) return { hit, via: a, fanOut: group.length + 1, aliased: true };
  }
  return { hit: null, via: null, fanOut: group.length + 1, aliased: false };
}
