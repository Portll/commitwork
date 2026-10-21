// monitor/dwell.mjs — vulnerability dwell-time computation. Two honest denominators:
//   blindExposureDays    = squashed - introduced   (only when an explicit bugIntroducedDate exists)
//   knowableExposureDays = squashed - initialReport (the window we are accountable for)
// Never parse a slice-id or raw stamp as a date — resolve slice-id -> the history-row `generated`
// ISO, falling back to null. bornSlice is DISCOVERY, not introduction. Pure; no I/O.

const DAY_MS = 86400000;

/** Build slice-id -> ISO map from history/index.json rows. Uses `generated` (clean ISO),
 *  never `stamp`. Rows without sliceId are keyed by their stamp-as-fallback ONLY for lookup,
 *  never parsed as a date. */
export function buildSliceTimeIndex(historyRows) {
  const idx = new Map();
  for (const r of historyRows || []) {
    const iso = r?.generated;
    if (!iso) continue;
    if (r.sliceId) idx.set(r.sliceId, iso);
    if (r.stamp) idx.set(String(r.stamp), iso); // fallback key; value is still the ISO
  }
  return idx;
}

/** Resolve any slice reference (sliceId string, or a bare stamp) to a clean ISO via the index.
 *  Returns null when unresolvable — we do NOT parse the slice string itself. */
export function sliceToIso(sliceRef, sliceTimeIndex) {
  if (!sliceRef) return null;
  if (sliceTimeIndex && sliceTimeIndex.has(sliceRef)) return sliceTimeIndex.get(sliceRef);
  // A slice ref like "sweep-YYYYMMDDHHMMSS" whose row we lack: derive the embedded stamp and
  // look THAT up; still never Date.parse the raw string.
  const m = /(\d{14})/.exec(String(sliceRef));
  if (m && sliceTimeIndex && sliceTimeIndex.has(m[1])) return sliceTimeIndex.get(m[1]);
  return null;
}

function isoToMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function daysBetween(aIso, bIso) {
  const a = isoToMs(aIso), b = isoToMs(bIso);
  if (a == null || b == null) return null;
  return Math.round(((b - a) / DAY_MS) * 10) / 10;
}

/**
 * Compute the dwell block for one lifecycle record.
 * @param {object} rec  a lifecycle record (may carry explicit date fields or only slices)
 * @param {Map}    sliceTimeIndex  from buildSliceTimeIndex
 * @param {string} nowIso  caller-supplied "now" ISO (Date.now() is banned in some contexts;
 *                         the caller stamps it) — open findings age to this.
 * @returns {{blindExposureDays:?number, knowableExposureDays:?number, openAgeDays:?number, computedFrom:string}}
 */
export function computeDwell(rec, sliceTimeIndex, nowIso) {
  // Introduced: explicit date only (C24). Slices are discovery, not introduction — never used here.
  const introducedIso = rec.bugIntroducedDate || null;

  // Initial report: explicit immutable field (min(OSV.published, first-observing-slice)); else
  // resolve bornSlice -> its generated ISO as the first-observed proxy.
  const reportIso = rec.bugInitialReport || sliceToIso(rec.bornSlice, sliceTimeIndex);

  // Squashed: explicit frozen field preferred; else resolvedSlice's generated ISO (detection-bounded).
  let squashedIso = rec.bugSquashedOn || null;
  let squashedSource = rec.bugSquashedOn ? 'dates' : null;
  if (!squashedIso && rec.resolvedSlice) {
    squashedIso = sliceToIso(rec.resolvedSlice, sliceTimeIndex);
    squashedSource = squashedIso ? 'detection-bounded' : null;
  }
  const isOpen = !squashedIso;
  const endIso = squashedIso || nowIso;

  const blind = introducedIso ? daysBetween(introducedIso, endIso) : null; // null unless C24 gives introduced
  const knowable = reportIso ? daysBetween(reportIso, endIso) : null;
  const openAge = isOpen && reportIso ? daysBetween(reportIso, nowIso) : (isOpen ? null : 0);

  let computedFrom;
  if (isOpen) computedFrom = 'slices';                 // aging an open finding off report/discovery
  else computedFrom = squashedSource || 'slices';      // detection-bounded unless an explicit squashed date

  return {
    blindExposureDays: blind,
    knowableExposureDays: knowable,
    openAgeDays: openAge,
    computedFrom,
  };
}

/** Fleet aggregates over an array of records that already have .dwell + .severity + .escalation. */
export function dwellAggregates(records) {
  const bySev = {};
  const openAges = [];
  let slaBreach = 0;
  for (const r of records || []) {
    const k = r.dwell?.knowableExposureDays;
    if (typeof k === 'number') (bySev[r.severity] ||= []).push(k);
    if (typeof r.dwell?.openAgeDays === 'number') openAges.push(r.dwell.openAgeDays);
    if (r.escalation?.slaBreached) slaBreach++;
  }
  const mean = a => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
  const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
  const buckets = { '0-7': 0, '8-30': 0, '31-90': 0, '91-180': 0, '180+': 0 };
  for (const a of openAges) {
    if (a <= 7) buckets['0-7']++; else if (a <= 30) buckets['8-30']++; else if (a <= 90) buckets['31-90']++; else if (a <= 180) buckets['91-180']++; else buckets['180+']++;
  }
  return {
    meanKnowableBySeverity: Object.fromEntries(Object.entries(bySev).map(([s, a]) => [s, mean(a)])),
    p50: pct(openAges, 50), p90: pct(openAges, 90), p95: pct(openAges, 95),
    openAgeHistogram: buckets,
    slaBreachCount: slaBreach,
  };
}
