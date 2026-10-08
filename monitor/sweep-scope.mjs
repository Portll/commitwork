// Which AREAS a --all sweep fans out to, and how `--exclude` narrows that.
//
// This is a module rather than two expressions inside sweep.mjs because those two expressions
// already diverged once. On 2026-08-24 `--exclude` filtered the `repos` array; --dry read that
// array and printed "135 projects", while --all mapped `reg.areas` independently and spawned
// `sweep.mjs all clientA` — the excluded area — as its first child. The dry run and the real run
// disagreed about scope, and the dry run was the one that looked right.
//
// A test written against the printed output could not catch that: --dry exits before the fleet
// loop, so the two code paths were never compared. One exported function, called by both, is what
// makes divergence impossible instead of merely unlikely.

import { areaBySlug } from './registry.mjs';
import { areaSlugOf } from './project-scope.mjs';

/**
 * Resolve raw `--exclude` values to area slugs.
 * Values may be repeated and/or comma-separated: `--exclude a,b --exclude c`.
 *
 * Returns `{ areas: Set<string>, unresolved: string[] }`. Resolution is reported, never applied —
 * the caller decides what an unresolved value means. sweep.mjs refuses on any, because a typo
 * that quietly matched nothing would sweep exactly the area the operator meant to skip.
 */
export function resolveExcludedAreas(rawValues, reg) {
  const areas = new Set();
  const unresolved = [];
  const parts = (rawValues || [])
    .flatMap((v) => String(v ?? '').split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const raw of parts) {
    const slug = areaBySlug(raw, reg) ? raw : areaSlugOf(raw);
    if (slug && areaBySlug(slug, reg)) areas.add(slug);
    else unresolved.push(raw);
  }
  return { areas, unresolved };
}

/**
 * Areas the registry declares PAUSED, as `[{slug, since, reason}]`. Persistent, unlike `--exclude`:
 * that is run-scoped on purpose ("a run-scoped skip reported the same way would make a partial
 * sweep indistinguishable from a complete one"), and this is the standing form of the same fact.
 * Returned as data rather than filtered silently, because the caller has to SAY what it skipped.
 */
export function pausedAreas(reg) {
  return (reg?.areas || []).filter((a) => a && a.paused)
    .map((a) => ({ slug: a.slug, since: a.paused.since, reason: a.paused.reason }));
}

/**
 * The area slugs a `--all` sweep will fan out to, in registry order, minus excluded and paused.
 * THE single source for that list: the fleet loop and the --dry plan must both call this, or a
 * dry run can once again describe a scope the real run does not use.
 */
export function fleetAreaSlugs(reg, excludedAreas = new Set()) {
  const paused = new Set(pausedAreas(reg).map((p) => p.slug));
  return (reg?.areas || []).map((a) => a.slug).filter((s) => !excludedAreas.has(s) && !paused.has(s));
}

/**
 * The area whose report directory a `--all` sweep writes its FLEET-LEVEL artefacts to.
 *
 * `--all` used to take this from `primaryArea(reg)` directly, which is computed before `--exclude`
 * is parsed and therefore could name the very area the run was told to skip. Measured symptom: with
 * `--exclude clientA`, fleet artefacts landed in `reports/clientA-monorepo` while that area's own
 * scan went stale — fresh files under a directory nobody swept, which reads as a current result.
 * Per-area children were unaffected because they write their own dirs, so the scan data was right
 * and only its ADDRESS was wrong, which is why nothing caught it.
 *
 * Derived from `fleetAreaSlugs` for the same reason that list exists at all: the destination must
 * come from the same source as the fan-out, or the two can disagree again. Returns null when every
 * area is excluded or paused — the caller refuses rather than inventing a destination.
 */
export function allScopeArea(reg, excludedAreas = new Set()) {
  const fleet = fleetAreaSlugs(reg, excludedAreas);
  if (!fleet.length) return null;
  const primary = (reg?.areas || []).find((a) => a && a.primary)?.slug
    || (reg?.areas || [])[0]?.slug || null;
  return primary && fleet.includes(primary) ? primary : fleet[0];
}
