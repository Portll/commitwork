// Parse renovate's LOG_FORMAT=json output (one object per line) into the dry-run's inventory.

// Skip reasons where renovate never queried a datasource. A dependency carrying one has an
// UNKNOWN update state, not "no update": without a github.com token every GitHub Action is
// skipped this way, and the dry-run reported 11 pending where 37 were (measured 2026-10-07).
const LOOKUP_NOT_PERFORMED = new Set(['github-token-required']);

export function parseRenovateLog(stdout) {
  const updates = [];
  const notLookedUp = [];
  let repoProblems = [];
  for (const line of String(stdout || '').split('\n')) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.msg === 'repoProblems' && d.repoProblems) repoProblems = d.repoProblems;
    if (d.msg !== 'packageFiles with updates' || !d.config) continue;
    for (const [manager, files] of Object.entries(d.config)) {
      for (const f of files || []) {
        for (const dep of f.deps || []) {
          if (LOOKUP_NOT_PERFORMED.has(dep.skipReason)) {
            notLookedUp.push({ manager, packageFile: f.packageFile, depName: dep.depName, skipReason: dep.skipReason });
          }
          for (const u of dep.updates || []) {
            updates.push({
              manager,
              packageFile: f.packageFile,
              depName: dep.depName,
              currentValue: dep.currentValue ?? dep.currentVersion ?? null,
              newVersion: u.newVersion ?? u.newValue ?? null,
              updateType: u.updateType ?? null,
              branchName: u.branchName ?? null,
            });
          }
        }
      }
    }
  }
  return { updates, repoProblems, notLookedUp };
}
