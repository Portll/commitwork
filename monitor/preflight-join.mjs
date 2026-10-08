// monitor/preflight-join.mjs — why a dependency lane found nothing to scan.
//
// osv-scanner exits 128 "no package sources found" for two states that are not the same thing:
// a repo whose manifests declare no dependencies (brave-browser: package.json, no deps) and a repo
// whose dependency set exists but is unresolved (RxJava: build.gradle, no gradle.lockfile). The
// lane cannot tell them apart — it only knows it indexed nothing — so its honest reason is
// "artifact present but empty", which is true and tells the reader nothing.
//
// preflight.json knows. This joins the two, HERE rather than in the runner, because the runner has
// only one repo in hand and preflight is written per sweep. Rules:
//   · the join names its source and never overwrites the lane's own reason, it appends to it
//   · a preflight from a DIFFERENT run says so — a CLI scan between sweeps would otherwise read a
//     stale verdict as current (a repo that gained a lockfile yesterday would still read blind)
//   · absent preflight ⇒ 'unknown', never silence and never an assumed state
//   · the wording is preflight's own `why`, reused verbatim: one phrasing per fact
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** ENOENT ⇒ null. Anything else is an unreadable prober, which is its own fact. */
export function readPreflight(outDir) {
  try { return JSON.parse(readFileSync(join(outDir, 'preflight.json'), 'utf8')); }
  catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return { unreadable: `preflight.json unreadable (${(e && e.code) || 'error'})`, repos: [] };
  }
}

/**
 * @param {object|null} preflight  parsed preflight.json, or null
 * @param {string} repoName
 * @param {string|null} batchStartedAt ISO — the batch this rollup describes
 * @returns {string} a clause to append, always non-empty, never asserting a state it cannot support
 */
export function preflightClause(preflight, repoName, batchStartedAt = null) {
  if (!preflight) return ' — preflight: unknown (no preflight.json for this area)';
  if (preflight.unreadable) return ` — preflight: unknown (${preflight.unreadable})`;
  const v = (preflight.repos || []).find((r) => r.name === repoName);
  if (!v) return ' — preflight: unknown (this repo carries no preflight verdict)';

  // Run identity: preflight is written once per sweep, at the END of it. A verdict generated
  // BEFORE this batch started describes a tree that may since have changed.
  const pfAt = Date.parse(preflight.generated || '');
  const batchAt = Date.parse(batchStartedAt || '');
  const stale = Number.isFinite(pfAt) && Number.isFinite(batchAt) && pfAt < batchAt;
  const from = stale ? ` (from an earlier run, ${preflight.generated})` : '';

  const blind = (v.ecosystems || []).filter((e) => e.state === 'blind');
  const detail = v.state === 'blind' && blind.length
    ? `blind — ${blind.map((b) => `${b.eco}: ${b.why}`).join(' · ')}`
    : v.state === 'subtree-only'
      ? `subtree-only — ${v.note || 'manifests exist below the root but not at it'}`
      : v.state === 'no-surface'
        ? `no-surface — ${v.note || 'no dependency manifest of any known ecosystem'}`
        : v.state === 'missing'
          ? 'missing — the repo is not on disk'
          : `${v.state} — preflight found a resolved dependency set here, so an empty scan is NOT explained by the tree's shape and is worth investigating`;
  return ` — preflight${from}: ${detail}`;
}
