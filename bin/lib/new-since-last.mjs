// bin/lib/new-since-last.mjs — which failures are NEW since the previous measurement.
//
// WHY. The gate prints a list of failing test names every turn. With 6-13 standing failures on a
// shared tree, that list is read past: a reader who classified the block once carries the
// classification forward, and a name that JOINS the set inherits a verdict nobody made about it.
// Measured 2026-09-06 by a peer session — their own defect sat inside such a block, named in the
// gate's own output, for hours.
//
// The remedy is to compute membership rather than remember it. A diff against the previous run
// turns "the usual failures" into a set the reader cannot have pre-classified, because it did not
// exist last turn.
//
// FLEET-WIDE, NOT PER-SESSION, AND DELIBERATELY SO. The store is shared, so "since the last run"
// means the last run by ANY session on this tree. That is the honest scope: the tree is shared, and
// a failure that appeared between two measurements appeared, whoever caused it. Attribution is a
// different question and `regressionVerdict` already answers it.
//
// UNKNOWN IS NOT EMPTY. No previous record means no comparison, not "everything is new" — a first
// run would otherwise report the entire standing set as fresh breakage. Populations that differ
// mean no comparison either: a targeted or truncated run did not look at the same things.

// POPULATION IS AN ASYMMETRIC PROBLEM, AND TREATING IT SYMMETRICALLY MAKES THIS INERT.
//
// The first cut required prevTests === tests before comparing anything. On this fleet the case
// count changes between nearly every run — 7325, 7494, 7541, 7636, 7644, 7673 were all observed on
// 2026-09-06 — so that guard would have refused to compare essentially always, and the feature
// would have reported "unknown" forever while looking implemented. Form satisfied, nothing fed.
//
// The two directions do not carry the same risk:
//   APPEARED (failing now, not before) is unsafe only when the PREVIOUS run covered FEWER cases,
//     because the name might not have run then. Even so it is newly OBSERVED and worth a reader's
//     attention, so it is reported WITH that caveat rather than withheld.
//   CLEARED (failing before, not now) is unsafe when THIS run covered FEWER cases, because the name
//     may simply not have run. A false "cleared" tells someone a break is fixed when nobody looked,
//     which is the one claim here that could stop work. It is withheld.
/**
 * @param {string[]|null} previous  failing names from the last recorded run, or null if none
 * @param {string[]} current        failing names from this run
 * @param {{prevTests?: number|null, tests?: number|null}} opts  case counts, for the asymmetry above
 */
export function newSinceLast(previous, current, { prevTests = null, tests = null } = {}) {
  const now = [...new Set((current ?? []).filter((n) => typeof n === 'string' && n.trim()))];
  if (!Array.isArray(previous)) {
    return { status: 'no-baseline', appeared: [], cleared: [], clearedUnknown: [], persisting: now, grew: false, shrank: false };
  }
  const known = typeof prevTests === 'number' && typeof tests === 'number';
  const grew = known && tests > prevTests;      // this run covered MORE than the last
  const shrank = known && tests < prevTests;    // this run covered LESS than the last
  const before = new Set(previous);
  const after = new Set(now);
  const clearedRaw = [...before].filter((n) => !after.has(n)).sort();
  return {
    status: 'compared',
    appeared: now.filter((n) => !before.has(n)),
    cleared: shrank ? [] : clearedRaw,
    clearedUnknown: shrank ? clearedRaw : [],
    persisting: now.filter((n) => before.has(n)),
    grew,
    shrank,
    delta: known ? tests - prevTests : null,
  };
}

/** The block the gate prints. Empty string when there is nothing a reader must act on, so a quiet
 *  turn stays quiet — an unconditional block is the wallpaper this exists to avoid becoming. */
export function newSinceLastBlock(diff, { limit = 20 } = {}) {
  if (!diff) return '';
  if (diff.status === 'no-baseline') {
    return diff.persisting.length
      ? `\n  NEW SINCE LAST RUN: unknown — no previous run is recorded for this tree, so none of the ${diff.persisting.length} current failure(s) can be called new or old.`
      : '';
  }
  if (!diff.appeared.length && !diff.cleared.length && !diff.clearedUnknown?.length) return '';
  const lines = [];
  if (diff.appeared.length) {
    lines.push(`\n  NEW SINCE LAST RUN (${diff.appeared.length}) — these were not failing at the previous measurement:`);
    for (const n of diff.appeared.slice(0, limit)) lines.push(`    ✖ ${n}`);
    if (diff.appeared.length > limit) lines.push(`    …and ${diff.appeared.length - limit} more`);
    if (diff.grew) {
      lines.push(`    (this run covered ${diff.delta} more case(s) than the last, so some of these may be newly RUN rather than newly broken)`);
    }
  }
  if (diff.cleared.length) lines.push(`  CLEARED SINCE LAST RUN (${diff.cleared.length}).`);
  if (diff.clearedUnknown?.length) {
    lines.push(`  ${diff.clearedUnknown.length} previously-failing name(s) are absent, but this run covered ${Math.abs(diff.delta)} FEWER case(s) — absent is not fixed, and they are not reported as cleared.`);
  }
  if (diff.persisting.length) lines.push(`  ${diff.persisting.length} failure(s) were already failing last run.`);
  return lines.join('\n');
}
