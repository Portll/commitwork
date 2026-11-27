// repo-scan-freshness.mjs — per-repo freshness of the SCHEDULED sweep, read from an area's verdict
// journal. Pure: no file access, no clock of its own.
//
// An area's rollup.json is whichever slice published last, so a one-repo re-scan or a `fast` pass
// re-stamps the whole area as current while its other repos, and its slower lanes, go unscanned.
// The journal records which repo each sweep actually ran and under which group; that is the only
// place the difference survives.

import { classifyFreshness } from './freshness.mjs';

// The group install-agents.mjs schedules for every area. `fast`, `deep` and single-lane sweeps run
// a subset of its lanes and cannot stand in for it.
export const SCHEDULED_GROUP = 'all';

const scansOf = (rec) => (rec && rec.repos && Array.isArray(rec.repos.scans) ? rec.repos.scans : null);
const later = (a, b) => (a && (!b || a > b) ? a : b);

/**
 * -> { measured, group, reference, repos: [{ name, sliceId, never, state, ageHours }], overdue, worst }
 *
 * `measured: false` when the journal holds no published sweep of the scheduled group that names
 * its repos: there is nothing to compare against, and no claim is made.
 *
 * The repos checked are those of the newest sweep that covered more than one (the newest sweep of
 * all for an area that only ever has one), so a repo that left the area stops being asked about at
 * the next area-wide sweep. A repo never scanned under the scheduled group ages from the first
 * sweep that named it.
 */
export function repoScanFreshness(records, nowMs, threshold = {}) {
  const named = (Array.isArray(records) ? records : []).filter((r) => scansOf(r) && typeof r.sliceId === 'string');
  const full = named.filter((r) => r.group === SCHEDULED_GROUP && r.rollup === 'published');
  if (!full.length) return { measured: false, group: SCHEDULED_GROUP, reference: null, repos: [], overdue: [], worst: null };

  const newest = (rows) => rows.reduce((best, r) => (!best || r.sliceId > best.sliceId ? r : best), null);
  const reference = newest(named.filter((r) => scansOf(r).length > 1)) || newest(named);

  const lastFull = new Map();
  const firstSeen = new Map();
  for (const r of named) {
    for (const s of scansOf(r)) {
      if (!s || typeof s.name !== 'string') continue;
      const seen = firstSeen.get(s.name);
      if (!seen || r.sliceId < seen) firstSeen.set(s.name, r.sliceId);
      if (s.ran === true && r.group === SCHEDULED_GROUP && r.rollup === 'published') {
        lastFull.set(s.name, later(r.sliceId, lastFull.get(s.name)));
      }
    }
  }

  const { cadenceMs, graceMs, expireMs } = threshold;
  const repos = [...new Set(scansOf(reference).map((s) => s && s.name).filter((n) => typeof n === 'string'))]
    .sort()
    .map((name) => {
      const sliceId = lastFull.get(name) ?? null;
      const f = classifyFreshness(null, nowMs, {
        ...(cadenceMs != null ? { cadenceMs } : {}),
        ...(graceMs != null ? { graceMs } : {}),
        ...(expireMs != null ? { expireMs } : {}),
        sliceId: sliceId ?? firstSeen.get(name) ?? null,
      });
      return { name, sliceId, never: sliceId === null, state: f.state, ageHours: f.ageHours };
    });

  const overdue = repos.filter((r) => r.state !== 'fresh');
  const worst = overdue.some((r) => r.state !== 'stale') ? 'expired' : overdue.length ? 'stale' : null;
  return { measured: true, group: SCHEDULED_GROUP, reference: reference.sliceId, repos, overdue, worst };
}

/** One clause naming the overdue repos, oldest first; '' when none are. */
export function overdueNote(result, { max = 6 } = {}) {
  if (!result || !result.overdue.length) return '';
  const rows = [...result.overdue].sort((a, b) => (b.ageHours ?? Infinity) - (a.ageHours ?? Infinity));
  const shown = rows.slice(0, max).map((r) => (r.never
    ? `${r.name} (never, known ${r.ageHours ?? '?'}h)`
    : `${r.name} (${r.sliceId}, ${r.ageHours ?? '?'}h ago)`));
  return `${rows.length} of ${result.repos.length} repo(s) have no completed \`${result.group}\` sweep inside the freshness window: `
    + `${shown.join(', ')}${rows.length > max ? ` … +${rows.length - max} more` : ''}`;
}
