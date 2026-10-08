// commitwork — the exposure view's verdict, and the four rules that keep it honest:
//   1. no rollup ⟹ not-scanned, never worst:'none'
//   2. a hostname no area declares is 'unmapped', never silently attributed
//   3. an empty findings list is only "clean" if something actually LOOKED (noscan ⟹ no evidence)
//   4. age INVALIDATES an absence-of-findings verdict — but real findings stay reported when old

export const SEVERITIES = ['crit', 'high', 'med', 'low'];

// A rollup is stale once it can no longer be assumed to describe what is deployed now.
export const DEFAULT_STALE_HOURS = 24;

// Two independent signals because the rollup writers disagree: `noscan` (sweep count) and
// `worst:'na'` (per-repo verdict) — either means the repo did not scan
export const repoDidNotScan = (repo) => !!(repo && (repo.noscan || repo.worst === 'na'));

/**
 * Decide an area's exposure verdict from its rollup.
 *
 * @param {object}  o
 * @param {object}  o.findings   severity counts already tallied from the rollup, e.g. {crit,high,med,low,kev}
 * @param {Array}   o.repos      the rollup's repos[] entries
 * @param {?number} o.ageHours   how old the rollup is, or null when it carries no timestamp
 * @param {number}  [o.staleHours]
 * @returns {{worst:string, verdictBasis:string, noscanRepos:number, scannedRepos:number, stale:?boolean}}
 */
export function exposureVerdict({ findings = {}, repos = [], ageHours = null, staleHours = DEFAULT_STALE_HOURS } = {}) {
  const noscanRepos = repos.filter(repoDidNotScan).length;
  const scannedRepos = repos.length - noscanRepos;
  // Unknown age reads stale, never fresh — "cannot be shown recent" is not "recent"
  const stale = ageHours === null ? null : ageHours > staleHours;
  const unknownAge = ageHours === null;

  const sev = SEVERITIES.find((s) => (findings[s] || 0) > 0);

  // Findings first, and unconditionally: see the asymmetry note above.
  if (sev) {
    return { worst: sev, noscanRepos, scannedRepos, stale,
      verdictBasis: `${findings[sev]} ${sev} finding(s)${stale ? `, from a scan ${ageHours}h old` : ''}` };
  }
  if (repos.length === 0 || scannedRepos === 0) {
    return { worst: 'not-scanned', noscanRepos, scannedRepos, stale,
      verdictBasis: repos.length === 0 ? 'the rollup lists no repos' : 'no repo in this area was scanned' };
  }
  if (noscanRepos > 0) {
    return { worst: 'partial', noscanRepos, scannedRepos, stale,
      verdictBasis: `${noscanRepos} of ${repos.length} repo(s) were not scanned — no findings is not a clean result here` };
  }
  if (unknownAge) {
    return { worst: 'stale', noscanRepos, scannedRepos, stale,
      verdictBasis: 'no findings, but the rollup carries no timestamp so its age cannot be established' };
  }
  if (stale) {
    return { worst: 'stale', noscanRepos, scannedRepos, stale,
      verdictBasis: `no findings, but the scan is ${ageHours}h old (> ${staleHours}h) and may not describe what is deployed now` };
  }
  return { worst: 'none', noscanRepos, scannedRepos, stale,
    verdictBasis: `every repo scanned (${scannedRepos}), ${ageHours}h ago` };
}

// Verdicts that must never read as "clean" — exported so consumers share one definition
export const NOT_A_CLEAN_RESULT = new Set(['not-scanned', 'partial', 'stale', 'unmapped']);
export const isConfidentClean = (worst) => worst === 'none';
