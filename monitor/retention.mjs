// commitwork monitor — retention POLICY, split from the compactor that acts on it. Pure: the caller
// joins each batch to its area and passes the pair in, so nothing here reads the disk and the whole
// policy is testable without a fixture tree. compact-reports.mjs remains the only thing that deletes.
//
// Two axes, and they UNION — never intersect. A batch is protected if it is among its area's newest
// `keepFullSweeps` OR younger than `keepDays`. Protection only ever adds, because the caller deletes:
// "the two rules disagree" must resolve to keeping, not to removing.

export const DEFAULT_KEEP_FULL_SWEEPS = 3;

// Declarable under a top-level `retention` or an area's own. `note` is prose for the operator.
export const RETENTION_KEYS = new Set(['keepFullSweeps', 'keepDays', 'dropDirPattern', 'protect', 'note']);
export const AREA_RETENTION_KEYS = new Set(['keepFullSweeps', 'keepDays', 'note']);

export function nowMs(now) {
  if (now !== undefined) return now instanceof Date ? now.getTime() : now;
  if (process.env.CW_NOW) {
    const t = Date.parse(process.env.CW_NOW);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

/**
 * Age a batch from its NAME, never its mtime. sweep.mjs stamps `sweep-YYYYMMDDHHMMSS[-area]` from
 * toISOString(), so the name is UTC and Date.UTC round-trips it exactly. mtime is the wrong clock
 * here for a specific reason: pruning REWRITES it, so an mtime-aged batch reads as freshly created
 * the moment it is compacted — the oldest batch would look like the newest and never age out again.
 * Returns null for anything that is not a batch name, or whose digits are not a real instant.
 */
export function batchStampMs(name) {
  const m = /^sweep-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[-.]|$)/.exec(`${name}`);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!Number.isFinite(t)) return null;
  // Reject a rolled-over date (month 13, day 99): Date.UTC absorbs those silently and would age the
  // batch against an instant nobody stamped.
  const iso = new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return iso === m.slice(1).join('') ? t : null;
}

const posInt = (v) => Number.isInteger(v) && v >= 0;
const posNum = (v) => Number.isFinite(v) && v > 0;

/**
 * The policy in force for one area, with provenance so the compactor can SAY why it kept something.
 * `globalKeep` is the resolved --keep / CW_RETENTION_KEEP / config value; an area that declares its
 * own `keepFullSweeps` wins for that area, which is what makes a per-area REDUCTION expressible.
 */
export function retentionFor(areaSlug, reg = {}, { globalKeep } = {}) {
  const g = reg.retention || {};
  const base = posInt(globalKeep) ? globalKeep
    : posInt(g.keepFullSweeps) ? g.keepFullSweeps
      : DEFAULT_KEEP_FULL_SWEEPS;
  const area = (reg.areas || []).find((a) => a && a.slug === areaSlug);
  const r = (area && area.retention) || {};
  const keepFullSweeps = posInt(r.keepFullSweeps) ? r.keepFullSweeps : base;
  const keepDays = posNum(r.keepDays) ? r.keepDays : (posNum(g.keepDays) ? g.keepDays : null);
  return {
    area: areaSlug,
    keepFullSweeps,
    keepDays,
    keepFrom: posInt(r.keepFullSweeps) ? `area '${areaSlug}'` : 'global',
    keepDaysFrom: posNum(r.keepDays) ? `area '${areaSlug}'` : (posNum(g.keepDays) ? 'global' : null),
    note: r.note || null,
  };
}

/**
 * Decide what survives. `batches` is [{name, area}] — area null/undefined means unscoped, which is
 * its own bucket rather than being folded into any declared area's quota.
 * Returns { protect:Set, why:Map(name->reason), byArea:Map(area->{policy,total,protected}) }.
 */
export function planProtection(batches, { reg = {}, globalKeep, now } = {}) {
  const t = nowMs(now);
  const protect = new Set();
  const why = new Map();
  const byArea = new Map();

  const groups = new Map();
  for (const b of batches) {
    const key = (b && b.area) || '(unscoped)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b.name);
  }

  for (const [area, names] of groups) {
    const policy = retentionFor(area === '(unscoped)' ? null : area, reg, { globalKeep });

    // Split before ranking. A name we cannot age is protected outright AND is kept out of the
    // newest-N quota: an unparseable stamp sorts wherever its digits fall — `sweep-20261399…` sorts
    // after every real stamp — so letting it compete would spend the quota slot that the genuine
    // newest batch needed. Unrecognised must never displace recognised.
    const dated = [];
    for (const n of names) {
      const ms = batchStampMs(n);
      if (ms === null) {
        protect.add(n);
        why.set(n, 'age unreadable from its name — protected rather than assumed old');
      } else dated.push({ n, ms });
    }
    dated.sort((a, b) => a.ms - b.ms || (a.n < b.n ? -1 : 1));

    if (policy.keepFullSweeps > 0) for (const { n } of dated.slice(-policy.keepFullSweeps)) {
      protect.add(n);
      why.set(n, `among the newest ${policy.keepFullSweeps} of ${policy.keepFrom}`);
    }
    if (policy.keepDays !== null) {
      const floor = t - policy.keepDays * 86400000;
      for (const { n, ms } of dated) {
        if (ms < floor) continue;
        protect.add(n);
        if (!why.has(n)) why.set(n, `${((t - ms) / 86400000).toFixed(1)}d old, inside the ${policy.keepDays}d floor of ${policy.keepDaysFrom}`);
      }
    }
    byArea.set(area, { policy, total: names.length, protected: names.filter((n) => protect.has(n)).length });
  }
  return { protect, why, byArea };
}
