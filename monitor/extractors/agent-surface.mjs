// monitor/extractors/agent-surface.mjs — the files a coding agent in the scanned repository obeys
// and acts through.
//
// Two readers, grouped by what they read as every part is; LANE_KINDS gives them different kinds:
//   - agent instructions (bin/agent-instructions.mjs, agentInstructions, vulnerability): hidden
//     characters and injected directives in the files an agent reads as instructions;
//   - agent configuration (bin/agent-config.mjs, agentConfig, posture): MCP servers, hooks,
//     permission grants and credentials in env blocks.
//
// monitor/extractors.mjs re-exports every public name here, so its importers see no change.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _zero, _detailFor, capMessage, _wtBucket, _setAsideWorktree, _worktreesOf } from './core.mjs';

// bin/agent-instructions.mjs — hidden characters and injected directives in the files an agent
// reads as instructions. Severity is per rule and read from the row; a row with no legal sev is
// counted under `undetermined`. filesScanned === 0 is a void the scanner states in summary.void.
export function _agentInstructionsCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'agent-instructions' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) {
    const v = { ..._zero(), ran: true, nosrc: true };
    if (j.summary.void) v.void = String(j.summary.void).slice(0, 240);
    return v;
  }
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const rule = String(f.rule || '');
    const sev = ['crit', 'high', 'med', 'low'].includes(f.sev) ? f.sev : '';
    const row = { rule, file: String(f.path || ''), sev, cwe: String(f.cwe || ''), message: capMessage(String(f.detail || '')) };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev]++; c.total++; } else undetermined++;
    byRule[rule] = byRule[rule] || { count: 0, sev };
    byRule[rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.byRule = byRule;
  if (Array.isArray(j.summary.filesSkipped) && j.summary.filesSkipped.length) c.filesSkipped = j.summary.filesSkipped.length;
  return { ...c, ..._detailFor('agentInstructions', rows) };
}

// bin/agent-config.mjs — the target's MCP servers, hooks, permission grants and inline env secrets.
// Severity is the row's own (the scanner pins one per rule) and `cwe` rides along for the panel.
// Files the scanner could not parse are counted and NAMED as a partial void rather than dropped.
// filesScanned === 0 is a VOID: a target with no agent configuration was not examined.
export function _agentConfigCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'agent-config' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const bucket = { crit: 'crit', critical: 'crit', high: 'high', med: 'med', medium: 'med', low: 'low' };
  const rows = [];
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f) continue;
    const sev = bucket[String(f.sev || '').toLowerCase()] || '';
    const row = { rule: f.rule, file: f.path, key: f.key, sev, cwe: f.cwe, message: capMessage(f.detail || '') };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev] += 1; c.total += 1; } else c.undetermined = (c.undetermined || 0) + 1;
    rows.push(row);
  }
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + (c.undetermined || 0) + wt.total, file);
  const bad = Number(j.summary.unparseable) || 0;
  if (bad) {
    c.unparseableFiles = bad;
    c.unparseableNote = `${bad} agent-config file(s) could not be parsed and were not judged: ${(Array.isArray(j.summary.unparseableFiles) ? j.summary.unparseableFiles : []).join(', ')}. A partial read is not a clean read.`;
  }
  // includes that escaped the tree, were missing, unreadable or past a limit: what was found stands, a zero does not
  if (j.summary.partial === true) {
    const reasons = Array.isArray(j.summary.partialReasons) ? j.summary.partialReasons.map(String) : [];
    c.partial = true;
    c.partialNote = capMessage(`agent-config read only part of the configuration${reasons.length ? ` (${reasons.join(', ')})` : ''}. ${c.total ? 'The findings stand; more may be unread.' : 'Zero findings here is not a clean result.'}`);
  }
  return { ...c, ..._detailFor('agentConfig', rows) };
}
