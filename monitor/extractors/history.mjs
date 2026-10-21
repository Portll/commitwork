// monitor/extractors/history.mjs — the lanes that read a repository's commit HISTORY, not its tree.
//
// Two readers over the object graph:
//   - commit provenance (bin/commit-provenance.mjs, commitProvenance): who made each commit, and
//     whether it is signed where signing is expected;
//   - commit velocity (bin/commit-velocity.mjs, commitVelocity): machine-speed commit, CI-file and
//     credential activity.
//
// TruffleHog reads history too and stays with the credential lanes in ./secrets.mjs: it answers a
// secrets question, and these two answer one about who wrote the history and how fast.
//
// monitor/extractors.mjs re-exports every public name here, so its importers see no change.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _zero, _detailFor, capMessage, _wtBucket, _setAsideWorktree, _worktreesOf } from './core.mjs';

// bin/commit-provenance.mjs — who made each of the last N commits. Severity is the lane's own per
// rule (high for an undeclared machine author, med for an unsigned commit on a branch expected
// signed or a bot merge with no human marker, low for an author/committer split). A row without a
// legal bucket is counted apart under `undetermined`, never dropped. commitsScanned === 0 is a
// VOID — a history nobody read has not been found clean.
export function _commitProvenanceCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'commit-provenance' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  if (j.summary.couldNotRun) return { ..._zero(), ran: true, noscan: true, noscanReason: String(j.summary.couldNotRun) };
  const scanned = Number(j.summary.commitsScanned ?? j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true };
  const bucket = { crit: 'crit', high: 'high', med: 'med', low: 'low' };
  const rows = [];
  const wt = _wtBucket();
  let undetermined = 0;
  for (const f of j.findings) {
    if (!f) continue;
    const sev = bucket[String(f.sev || '').toLowerCase()] || '';
    const row = { rule: f.rule, file: f.path, sha: f.sha, sev, cwe: f.cwe || '', message: capMessage(f.detail || '') };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev] += 1; c.total += 1; } else undetermined += 1;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.commitsScanned = scanned;
  if (Array.isArray(j.summary.rulesNotApplicable) && j.summary.rulesNotApplicable.length) c.rulesNotApplicable = j.summary.rulesNotApplicable;
  if (Array.isArray(j.summary.unmeasured) && j.summary.unmeasured.length) c.unmeasured = j.summary.unmeasured;
  return { ...c, ..._detailFor('commitProvenance', rows) };
}

export function _commitVelocityCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'commit-velocity' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  // fact: filesScanned is commitsScanned; 0 commits is a void, never a clean tree (expiry: never, prev: not built)
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const bucket = { crit: 'crit', critical: 'crit', high: 'high', med: 'med', medium: 'med', low: 'low' };
  const rows = [];
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f) continue;
    const sev = bucket[String(f.sev || '').toLowerCase()] || 'med';
    const row = { rule: f.rule, file: f.path, sev, cwe: f.cwe, message: capMessage(f.detail || '') };
    if (_setAsideWorktree(wt, row)) continue;
    c[sev] += 1; c.total += 1;
    rows.push(row);
  }
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + wt.total, file);
  return { ...c, ..._detailFor('commitVelocity', rows) };
}
