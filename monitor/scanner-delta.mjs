// monitor/scanner-delta.mjs — scanner-lane lifecycle diff: new/fixed/carried per category, between
// two slices. "Fixed" means SCAN-ABSENT — a weaker tier than ledger-verified, labelled as such.
// Identity is the place (repo|category|identity tuple), never the line. A category compares only
// when its scanner ran in BOTH slices and both sides conserve; refusals name their reason and
// counters go null, never 0. Pure and deterministic: no clock, no fs, no env; sorted output.

import { identityFor } from './detail-schema.mjs';
import { TOTALS_EXCLUDE } from './extractors.mjs';

// Cap on per-category place detail lists. No silent caps: overflow is counted in `truncated` —
// the count stays exact, only the roster is clipped.
export const PLACE_DETAIL_CAP = 200;

const SEV_ORDER = { crit: 4, high: 3, med: 2, low: 1 };

/** The line-free place key for one row of `category`, or null when the category has no schema. */
export function scannerPlaceKey(category, row) {
  const id = identityFor(category);
  if (!id) return null;
  return [String(row.repo ?? ''), category, ...id.map((f) => String(row[f] ?? ''))].join('|');
}

// Aggregate one slice's rows for a category into places. Returns Map key -> place.
function placesOf(category, rows, idFields) {
  const places = new Map();
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    const key = [String(row.repo ?? ''), category, ...idFields.map((f) => String(row[f] ?? ''))].join('|');
    let p = places.get(key);
    if (!p) {
      p = { repo: String(row.repo ?? ''), sub: String(row[idFields[0]] ?? ''), rows: 0, openRows: 0, sev: '' };
      for (const f of idFields) p[f] = String(row[f] ?? '');
      places.set(key, p);
    }
    p.rows += 1;
    if (!row.annotation) p.openRows += 1;
    const s = String(row.sev ?? '');
    if ((SEV_ORDER[s] || 0) > (SEV_ORDER[p.sev] || 0)) p.sev = s;
  }
  return places;
}

const ranThisSlice = (sc) => !!sc && (sc.ran || 0) > 0 && !sc.carried;

const sevBuckets = () => ({ crit: 0, high: 0, med: 0, low: 0, unknown: 0 });
const bumpSev = (b, sev) => { b[SEV_ORDER[sev] ? sev : 'unknown'] += 1; };

// A place, as published in the newPlaces/fixedPlaces detail lists.
const placeView = (p) => {
  const { openRows, ...rest } = p; // openRows is an internal for the accepted count
  return rest;
};

/**
 * Diff scanner findings between two slices ({ scanners, scannerFindings, scope: { repos } } — the
 * history/<stamp>.json shape; prevSlice null when no comparable previous slice exists).
 * `detailCap` bounds the DISPLAY lists only. `curConservation`/`prevConservation` are conserve.mjs
 * checkConservation results — a category in either's violations refuses instead of comparing.
 * Returns { comparable, byCategory, totals, totalsAll, notCompared }; `totals` excludes the
 * TOTALS_EXCLUDE hygiene lanes and is null when nothing was comparable, never a fabricated 0.
 */
export function diffScannerFindings(prevSlice, curSlice, {
  detailCap = PLACE_DETAIL_CAP, curConservation = null, prevConservation = null,
} = {}) {
  const cur = curSlice || {};
  const prev = prevSlice || null;
  const curScanners = cur.scanners || {};
  const prevScanners = (prev && prev.scanners) || {};
  const curRepos = new Set((cur.scope && cur.scope.repos) || []);
  const excludeSet = new Set(TOTALS_EXCLUDE);
  // Absent (null) reads as "no known violations", never as "conforms"
  const curUnconserved = new Set(((curConservation && curConservation.violations) || []).map((v) => v.category));
  const prevUnconserved = new Set(((prevConservation && prevConservation.violations) || []).map((v) => v.category));

  const categories = [...new Set([...Object.keys(curScanners), ...Object.keys(prevScanners)])].sort();
  const byCategory = {};
  const notCompared = [];
  let comparedAny = false;
  const totals = { new: 0, fixed: 0 };
  const totalsAll = { new: 0, fixed: 0 };

  for (const cat of categories) {
    const refuse = (status) => {
      byCategory[cat] = { status, new: null, fixed: null, persisting: null, carriedPlaces: null, acceptedPlaces: null };
      notCompared.push(`${cat}:${status}`);
    };
    const idFields = identityFor(cat);
    if (!idFields) { refuse('no-identity'); continue; }
    if (!prev) { refuse('no-prev'); continue; }
    const curSc = curScanners[cat];
    if (!ranThisSlice(curSc)) { refuse(curSc && curSc.carried ? 'cur-carried' : 'cur-not-ran'); continue; }
    if (!ranThisSlice(prevScanners[cat])) { refuse(prevScanners[cat] && prevScanners[cat].carried ? 'prev-carried' : 'prev-not-ran'); continue; }
    // Conservation is a "fresh data untrustworthy" refusal, distinct from "no fresh data" above
    if (curUnconserved.has(cat)) { refuse('cur-unconserved'); continue; }
    if (prevUnconserved.has(cat)) { refuse('prev-unconserved'); continue; }

    const prevPlaces = placesOf(cat, (prev.scannerFindings || {})[cat], idFields);
    const curPlaces = placesOf(cat, (cur.scannerFindings || {})[cat], idFields);

    const newPlaces = [], fixedPlaces = [];
    let persisting = 0, carriedPlaces = 0, acceptedPlaces = 0;
    const newBySev = sevBuckets(), fixedBySev = sevBuckets();
    const byRule = new Map();
    const rule = (sub) => { let r = byRule.get(sub); if (!r) { r = { new: 0, fixed: 0 }; byRule.set(sub, r); } return r; };

    for (const [key, p] of [...prevPlaces.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (curPlaces.has(key)) { persisting += 1; continue; }
      if (!curRepos.has(p.repo)) { carriedPlaces += 1; continue; } // repo not scanned — unknown, never fixed
      fixedPlaces.push(placeView(p)); bumpSev(fixedBySev, p.sev); rule(p.sub).fixed += 1;
    }
    for (const [key, p] of [...curPlaces.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (p.rows > 0 && p.openRows === 0) acceptedPlaces += 1; // fully suppressed by authored judgments
      if (prevPlaces.has(key)) continue;
      newPlaces.push(placeView(p)); bumpSev(newBySev, p.sev); rule(p.sub).new += 1;
    }

    const truncated = {};
    if (newPlaces.length > detailCap) truncated.newPlaces = newPlaces.length - detailCap;
    if (fixedPlaces.length > detailCap) truncated.fixedPlaces = fixedPlaces.length - detailCap;

    byCategory[cat] = {
      status: 'compared',
      new: newPlaces.length, fixed: fixedPlaces.length, persisting, carriedPlaces, acceptedPlaces,
      newBySev, fixedBySev,
      byRule: Object.fromEntries([...byRule.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      newPlaces: newPlaces.slice(0, detailCap), fixedPlaces: fixedPlaces.slice(0, detailCap),
      ...(Object.keys(truncated).length ? { truncated } : {}),
    };
    comparedAny = true;
    totalsAll.new += newPlaces.length; totalsAll.fixed += fixedPlaces.length;
    if (!excludeSet.has(cat)) { totals.new += newPlaces.length; totals.fixed += fixedPlaces.length; }
  }

  notCompared.sort();
  return {
    comparable: comparedAny,
    prevSliceId: prev ? (prev.sliceId || prev.stamp || null) : null,
    byCategory,
    totals: comparedAny ? totals : { new: null, fixed: null },
    totalsAll: comparedAny ? totalsAll : { new: null, fixed: null },
    notCompared,
  };
}
