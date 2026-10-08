#!/usr/bin/env node
// remediation-source.mjs — turn a rollup slice's reachable dependency findings into the normalized
// advisories monitor/remediation-pr.mjs consumes. PURE core; all I/O behind injected seams.
//
// SCOPE, stated not smuggled. Only the `depsGo` lane, and only rows the govulncheck lane PROVED
// reachable (reachability === 'reachable', prover 'govulncheck'). JVM/npm/heuristic lanes do NOT
// carry compiler-callgraph reachability, so including them would propose fixes for rows we cannot
// prove reach the artifact — an unverified result presented as a finding. Everything not emitted is COUNTED in
// `dropped[]` with a reason and surfaced, never silently discarded (advisory-reach's rule), so a
// reader is never told "nothing to do" when a whole ecosystem was simply out of scope.
//
// TWO FACTS THE LANE DOES NOT CARRY, resolved through injected seams so the pure path is
// deterministic and offline-testable:
//   fixed version — depsGo has id+package+reachability but NO fixed version. `osvFixed(id, pkg)`
//                   supplies it (a PINNED OSV snapshot, not a live fetch: a network call would make
//                   output non-deterministic across days, which the determinism invariant forbids).
//                   No fixed -> advisory still emitted with fixed:'' so the engine skips it
//                   'no-fix-target' honestly, never a guessed version.
//   upstream slug — the finding's `repo` ('owner_repo' dir name) is AMBIGUOUS (underscores).
//                   `slugFor(repo) -> 'owner/name'|null` resolves it authoritatively (the clone's
//                   origin remote). Null -> dropped 'no-upstream-slug'; the owner_repo string is
//                   NEVER munged into a slash (renovate-dryrun's "no remote, no guess").

import { writeAtomic } from './lockfile.mjs';
import { readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';

const env = (k) => process.env[k];

// The reachability verdict that means "govulncheck traced a call path". Compared case- and
// whitespace-insensitively so a formatting change upstream cannot silently drop a real row.
const REACHABLE = 'reachable';
const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Dedup key — repo|id|package, the house dependency identity (never version, never line). */
export const advKey = (r) => `${r.repo}|${r.id}|${r.package}`;

/**
 * Normalize one depsGo finding into an advisory, or return { drop, reason }.
 * @param {{repo,id,package,reachability,prover}} row
 * @param {{ osvFixed:(id,pkg)=>string, slugFor:(repo)=>string|null }} seams
 */
export function advisoryFromRow(row, { osvFixed, slugFor }) {
  if (!row || typeof row !== 'object') return { drop: true, reason: 'malformed-row' };
  if (norm(row.reachability) !== REACHABLE) return { drop: true, reason: `not-reachable:${norm(row.reachability) || 'absent'}` };
  const slug = slugFor(row.repo);
  if (!slug) return { drop: true, reason: 'no-upstream-slug' };
  const fixed = osvFixed(row.id, row.package) || '';
  return {
    advisory: {
      id: row.id,
      package: row.package,
      ecosystem: 'Go',
      currentVersion: '',            // depsGo does not carry it; the probe/bump resolves the parent
      fixed,
      reachable: true,               // proven by the govulncheck lane
      bump: null,                    // direct-parent resolution is the probe step's job
      upstream: { repo: slug, defaultBranch: '' },
    },
  };
}

/**
 * Adapt a whole slice. Deterministic: dedups on repo|id|package, preserves first-seen order.
 * @returns {{ advisories:[], dropped:[], coverage:{ scannedRepos:number, goRows:number, emitted:number,
 *             droppedByReason:object, ecosystemsNotCovered:string[] } }}
 */
export function advisoriesFromSlice(slice, seams) {
  const sf = (slice && slice.scannerFindings) || {};
  const goRows = Array.isArray(sf.depsGo) ? sf.depsGo : [];
  const advisories = [], dropped = [], seen = new Set();
  const droppedByReason = {};
  for (const row of goRows) {
    const key = advKey(row || {});
    if (seen.has(key)) { dropped.push({ key, reason: 'duplicate' }); droppedByReason.duplicate = (droppedByReason.duplicate || 0) + 1; continue; }
    seen.add(key);
    const r = advisoryFromRow(row, seams);
    if (r.drop) { dropped.push({ key, reason: r.reason }); droppedByReason[r.reason] = (droppedByReason[r.reason] || 0) + 1; continue; }
    advisories.push(r.advisory);
  }
  // Which dep lanes carried findings but are out of this Go-only increment — named, so their
  // silence is not read as "no work". (explicit uncertainty.)
  const OTHER_DEP_LANES = ['depsJvm', 'depsGradleDeclared', 'depsRetire', 'maliciousPackages', 'supplyChainHeuristic', 'supplyChainPosture', 'vendorAssets'];
  const ecosystemsNotCovered = OTHER_DEP_LANES.filter((l) => Array.isArray(sf[l]) && sf[l].length > 0);
  const scannedRepos = Array.isArray(slice?.scanned) ? slice.scanned.length : (slice?.scanned || 0);
  return {
    advisories,
    dropped,
    coverage: { scannedRepos, goRows: goRows.length, emitted: advisories.length, droppedByReason, ecosystemsNotCovered },
  };
}

// ── default live seams (injectable; the pure functions above never call these) ──────────────────

/** OSV snapshot lookup. Reads a pinned map { "<id>": { "<module>": "<fixed>" } } — NOT the network,
 *  so runs are reproducible. Path via CW_OSV_FIXED; absent file -> every lookup is '' (fail closed
 *  to no-fix-target, never a guess). */
export function osvFixedFromSnapshot(path = env('CW_OSV_FIXED')) {
  let map = {};
  if (path) { try { map = JSON.parse(readFileSync(path, 'utf8')); } catch { map = {}; } }
  return (id, pkg) => {
    const byId = map[id];
    if (!byId) return '';
    if (typeof byId === 'string') return byId;
    return byId[pkg] || byId['*'] || '';
  };
}

// ── CLI: read a slice, emit normalized advisories + a coverage report. No network in this path
//    unless CW_OSV_FIXED points at a snapshot. Never proposes or applies anything.
function main(argv) {
  const slicePath = env('CW_SLICE') || argv.find((a) => !a.startsWith('--'));
  if (!slicePath) { process.stderr.write('usage: remediation-source.mjs <slice.json> [--write]\n'); process.exit(2); }
  let slice;
  try { slice = JSON.parse(readFileSync(slicePath, 'utf8')); }
  catch (e) { process.stderr.write(`cannot read ${slicePath}: ${e.message}\n`); process.exit(2); }

  // slugFor default: caller must supply a resolver via CW_SLUG_MAP (a pinned repo->slug JSON), else
  // every row drops 'no-upstream-slug' — safe, and visible in the coverage report.
  let slugMap = {};
  const smp = env('CW_SLUG_MAP');
  if (smp) { try { slugMap = JSON.parse(readFileSync(smp, 'utf8')); } catch { slugMap = {}; } }
  const seams = { osvFixed: osvFixedFromSnapshot(), slugFor: (repo) => slugMap[repo] || null };

  const out = advisoriesFromSlice(slice, seams);
  const doc = JSON.stringify(out, null, 2);
  if (argv.includes('--write')) {
    const dest = env('CW_REMEDIATION_SOURCE_OUT') || 'reports/remediation-advisories.json';
    writeAtomic(dest, doc + '\n', { mkdir: true });
    process.stderr.write(`wrote ${dest}\n`);
  } else {
    process.stdout.write(doc + '\n');
  }
  const c = out.coverage;
  process.stderr.write(`emitted=${c.emitted} goRows=${c.goRows} dropped=${JSON.stringify(c.droppedByReason)} notCovered=${c.ecosystemsNotCovered.join(',') || 'none'}\n`);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
