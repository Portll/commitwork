// admin/lib/adjudication-triage.mjs — the human queue, ranked under the declared budget.
// fact: pure; the route reads rollup and ledger
// fact: rows are capped per lane upstream
// fact: adjudicated findingKeys leave the queue
import { budgetState } from '../../monitor/adjudication-budget.mjs';
import { identityFor } from '../../monitor/detail-schema.mjs';
import { findingKeyForDependency, findingKeyForScanner, TRUTHS } from '../../bin/lib/verdict-journal-core.mjs';

// fact: metric lanes never enter the queue
export const METRIC_LANES = Object.freeze(new Set(['stubs', 'minifiedCode']));
// fact: near-total undetermined is a lane defect
export const DEFECT_SHARE = 0.95;
export const DEFECT_MIN_ROWS = 20;
// fact: caps one lane's share of capacity
export const LANE_CAP_SHARE = 0.4;

export const TRIAGE_RULES = Object.freeze([
  { id: 'metric-lanes', text: `${[...METRIC_LANES].join(' and ')} are metrics, not findings (ruled 2026-08-13): their undetermined rows never enter the human queue` },
  { id: 'defect-signature', text: `a lane whose undetermined count is ≥${Math.round(DEFECT_SHARE * 100)}% of everything it reported, over ≥${DEFECT_MIN_ROWS} rows, is a grading defect in the lane — routed to the lane's owner, not to a person one row at a time` },
  { id: 'already-adjudicated', text: 'a row whose findingKey already carries a truth in the adjudications ledger has left the queue; it is counted as resolved, never re-asked' },
  { id: 'own-code-first', text: 'rows from repos in areas this fleet owns outrank the third-party corpus (P0: own code secure)' },
  { id: 'claimed-severity', text: 'crit > high > med > low > ungraded, by the severity the lane claimed BEFORE the row was demoted to undetermined' },
  { id: 'persisting-first', text: 'a row seen across more than one sweep outranks one seen once — it has already cost a cycle' },
  { id: 'lane-cap', text: `no lane may take more than ${Math.round(LANE_CAP_SHARE * 100)}% of one cycle's capacity while another lane still has rows waiting; capacity the cap would leave unused is filled from the held-back rows, in rank order` },
  { id: 'deferred-not-dropped', text: 'everything past capacity is DEFERRED with a count per lane; nothing is dropped and nothing is called clean' },
]);

const SEV_RANK = { crit: 0, critical: 0, high: 1, med: 2, medium: 2, low: 3 };
const sevRank = (s) => (s && SEV_RANK[String(s).toLowerCase()] != null ? SEV_RANK[String(s).toLowerCase()] : 4);
const str = (v, cap = 200) => (typeof v === 'string' ? v.slice(0, cap) : null);
// guard: unparseable bornSlice sorts last
const stampOf = (bornSlice) => { const m = /(\d{14})$/.exec(String(bornSlice || '')); return m ? m[1] : null; };

/** Every undetermined row the rollup carries, keyed the way the ledger keys them. */
export function collectUndetermined(rollup) {
  const rows = [];
  const skipped = { metricLanes: {}, unkeyed: {} };
  if (!rollup || typeof rollup !== 'object') return { rows, skipped };
  // fact: CVE rows carry undetermined:true
  for (const rep of Array.isArray(rollup.repos) ? rollup.repos : []) {
    const repo = rep && rep.name;
    for (const f of (rep && Array.isArray(rep.findings)) ? rep.findings : []) {
      if (!f || f.undetermined !== true || !repo || !f.id) continue;
      rows.push({
        findingKey: findingKeyForDependency(repo, f.id, f.package),
        category: 'cve', repo: str(repo, 120), source: 'cve',
        id: str(f.id, 80), package: str(f.package, 120),
        claimedSeverity: str(f.claimedSeverity, 16), code: str(f.undeterminedCode, 40) || 'undetermined',
        reason: str(f.undeterminedReason, 300), state: str(f.state, 24), bornSlice: str(f.bornSlice, 40),
        kev: f.kev === true,
      });
    }
  }
  // fact: sevless scanner rows are undetermined
  const sf = rollup.scannerFindings && typeof rollup.scannerFindings === 'object' ? rollup.scannerFindings : {};
  for (const [category, list] of Object.entries(sf)) {
    if (!Array.isArray(list)) continue;
    const sevless = list.filter((r) => r && typeof r === 'object' && !r.sev);
    if (!sevless.length) continue;
    if (METRIC_LANES.has(category)) { skipped.metricLanes[category] = sevless.length; continue; }
    const identity = identityFor(category);
    if (!identity) { skipped.unkeyed[category] = sevless.length; continue; }   // guard: no identity, no key
    for (const r of sevless) {
      if (!r.repo) { skipped.unkeyed[category] = (skipped.unkeyed[category] || 0) + 1; continue; }
      let findingKey;
      try { findingKey = findingKeyForScanner(category, r.repo, r); } catch { skipped.unkeyed[category] = (skipped.unkeyed[category] || 0) + 1; continue; }
      rows.push({
        findingKey, category: str(category, 40), repo: str(r.repo, 120), source: 'scanner',
        place: identity.map((f) => str(r[f], 160)).filter((v) => v != null).join(' · ') || null,
        claimedSeverity: null, code: 'ungraded',
        reason: category === 'secrets' || category === 'secretsHistory'
          ? 'no verifier could be asked, so the lane assigned no severity — a person decides whether this is live'
          : 'the lane reported this row without a severity',
        state: str(r.state, 24), bornSlice: str(r.bornSlice, 40), kev: false,
      });
    }
  }
  return { rows, skipped };
}

/** fact: lane counters decide defect signatures */
export function defectLanes(rollup) {
  const out = {};
  const sc = rollup && rollup.scanners && typeof rollup.scanners === 'object' ? rollup.scanners : {};
  for (const [lane, c] of Object.entries(sc)) {
    if (!c || typeof c !== 'object') continue;
    const undet = Number(c.undetermined) || 0;
    const total = Number(c.total) || 0;
    if (undet >= DEFECT_MIN_ROWS && total > 0 && undet / total >= DEFECT_SHARE) {
      out[lane] = { undetermined: undet, total, share: Math.round((undet / total) * 1000) / 1000 };
    }
  }
  return out;
}

/** findingKeys the ledger has already ruled on (any truth in TRUTHS). */
export function adjudicatedKeys(adjudicationRecords) {
  const done = new Set();
  for (const r of Array.isArray(adjudicationRecords) ? adjudicationRecords : []) {
    if (r && r.kind === 'finding-adjudication' && r.findingKey && TRUTHS.includes(r.truth)) done.add(r.findingKey);
  }
  return done;
}

/** The queue; ownRepos null ranks nobody */
export function buildQueue({ rollup, adjudicated = new Set(), ownRepos = null, capacityItems = null } = {}) {
  if (!rollup || typeof rollup !== 'object') return { state: 'no-rollup', rules: TRIAGE_RULES };
  const { rows: all, skipped } = collectUndetermined(rollup);
  const defects = defectLanes(rollup);

  // fact: population sums lane counters plus CVE rows
  const sc = rollup.scanners && typeof rollup.scanners === 'object' ? rollup.scanners : {};
  let population = 0;
  for (const c of Object.values(sc)) population += Number(c && c.undetermined) || 0;
  population += all.filter((r) => r.source === 'cve').length;

  let resolved = 0;
  const excludedDefect = {};
  const rows = [];
  for (const r of all) {
    if (adjudicated.has(r.findingKey)) { resolved++; continue; }
    if (defects[r.category]) { excludedDefect[r.category] = (excludedDefect[r.category] || 0) + 1; continue; }
    rows.push(r);
  }

  const own = (r) => (ownRepos ? (ownRepos.has(r.repo) ? 0 : 1) : 0);
  const persisting = (r) => (r.state === 'persisting' ? 0 : 1);
  rows.sort((a, b) => own(a) - own(b)
    || sevRank(a.claimedSeverity) - sevRank(b.claimedSeverity)
    || (b.kev ? 1 : 0) - (a.kev ? 1 : 0)
    || persisting(a) - persisting(b)
    || String(stampOf(a.bornSlice) || '99999999999999').localeCompare(String(stampOf(b.bornSlice) || '99999999999999'))
    || a.findingKey.localeCompare(b.findingKey));

  const budget = budgetState({ pending: rows.length });
  const cap = capacityItems != null ? Math.max(0, Math.floor(capacityItems)) : Math.floor(budget.capacityMinutes / budget.minutesPerItem);
  const laneCap = Math.max(1, Math.floor(cap * LANE_CAP_SHARE));
  // fact: lane cap binds only while others wait
  const admitted = [];
  const perLane = {};
  const heldBack = [];
  for (const r of rows) {
    const n = perLane[r.category] || 0;
    if (admitted.length < cap && n < laneCap) { admitted.push(r); perLane[r.category] = n + 1; }
    else heldBack.push(r);
  }
  const deferredByLane = {};
  for (const r of heldBack) {
    if (admitted.length < cap) admitted.push(r);
    else deferredByLane[r.category] = (deferredByLane[r.category] || 0) + 1;
  }
  admitted.forEach((r, i) => { r.rank = i + 1; r.own = own(r) === 0; });
  const deferred = Object.values(deferredByLane).reduce((a, b) => a + b, 0);

  return {
    state: 'ok',
    rules: TRIAGE_RULES,
    capacityItems: cap, laneCap,
    budget: { ...budget, pending: rows.length, overBy: cap > 0 ? Math.round((rows.length / cap) * 10) / 10 : null },
    population,
    rowsAvailable: all.length,
    // fact: rows below population is normal
    rowsCapped: all.length < population,
    pending: rows.length,
    admitted,
    deferred: { count: deferred, byLane: deferredByLane },
    excluded: {
      metricLanes: skipped.metricLanes,
      defectSignature: Object.fromEntries(Object.entries(defects).map(([k, v]) => [k, { ...v, rowsExcluded: excludedDefect[k] || 0 }])),
      unkeyed: skipped.unkeyed,
      adjudicated: resolved,
    },
  };
}
