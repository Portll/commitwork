// monitor/extractors/core.mjs — what every scanner extractor is built out of.
//
// Every part module imports from here, never from the barrel: a part importing its own barrel is
// the cycle bin/module-seams.mjs screens for.
//
// Three groups, together because they answer one question — what shape does a finding leave an
// extractor in:
//   - `_zero`, the empty count block every lane starts from;
//   - the DETAIL cap and row builders, which bound and whitelist every drill-down row;
//   - `capMessage` and `stampUnknown`, which bound third-party text and stamp the shared unknown
//     predicate BESIDE a lane's own word for it rather than over the top of it.
//
// Beside them, two helpers every lane shares: `_emptyArtifact`, which reads an empty artifact
// through its exit sidecar, and the agent-worktree set-aside (`_wtBucket`, `_setAsideWorktree`,
// `_worktreesOf`).
//
// monitor/extractors.mjs re-exports every public name here.

import { readFileSync } from 'node:fs';
import { rowsFor } from '../detail-schema.mjs';
import { unknownReasonOf } from '../unknown.mjs'; // ONE predicate; lanes name a reason, not a new adjective
import { ecosystemOf } from '../advisory-reach.mjs'; // a name collision is not an installed package
import { classifyWorktreePath } from '../worktree-paths.mjs'; // an agent worktree is this repo counted twice

export const _zero = () => ({ crit: 0, high: 0, med: 0, low: 0, total: 0 });
// fact: an empty artifact beside an exit above 1 is a tool that died before writing, not a repo with nothing to scan / otherwise a tool that cannot start publishes no-subject on a repo holding a lockfile (expiry: never, prev: wrong)
export function _emptyArtifact(p) {
  let exit = 0;
  try { exit = parseInt(readFileSync(`${p}.exit`, 'utf8').trim(), 10) || 0; } catch (e) { if (e.code !== 'ENOENT') return { ..._zero(), ran: true, unparseable: true }; }
  return exit > 1 ? { ..._zero(), ran: true, toolfailed: true } : { ..._zero(), ran: true, nosrc: true };
}

// ── per-finding detail (the drill-down behind the scanner tabs) ────────────────────────────────
// secrets / maliciousPackages / supplyChainHeuristic / the SARIF categories / dast return a bounded
// `findings` array. Fields are WHITELISTED — each row is constructed field-by-field, which holds
// even against a gitleaks artifact carrying live secret material in Secret/Match (redaction is
// manifest policy, not a format guarantee, and rollup.json is served over the published tunnel).
// The cap is per repo per category and RECORDED (`truncated` = rows dropped), never a silent slice.
// Rows are sorted so a re-roll of the same batch stays byte-identical (rerollup-identical gate).
//
// The cap exists because a vendored key directory can yield six figures of rows, and rollup.json is
// parsed whole by consumers that want none of this detail. It bounds drill-down, not arithmetic:
// totals and openTotals come from the aggregates, so no published number moves. The structural fix
// is a per-tab detail artifact, not a higher cap.
export const DETAIL_CAP = 10000;
export const _cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const _cap = (rows) => (rows.length > DETAIL_CAP
  ? { findings: rows.slice(0, DETAIL_CAP), truncated: rows.length - DETAIL_CAP }
  : { findings: rows });
export const _detail = (rows, cmp) => { rows.sort(cmp); return _cap(rows); };
// SCHEMA-DRIVEN detail: rows are BUILT by monitor/detail-schema.mjs from a declared field list, so
// an undeclared key is never read rather than read-then-filtered. These artifacts carry live
// credential material (trufflehog Raw/RawV2, gitleaks Secret/Match) and a filter can be outrun by a
// format change; a construction cannot. Sorting comes from the schema, so byte-identity holds
// without per-extractor comparators. No schema returns {} — counts only: say less, never guess.
export const _detailFor = (key, items) => { const rows = rowsFor(key, items); return rows ? _cap(rows) : {}; };

// The set-aside _minifyCounts does, shared by every lane: severity kept, enumerable, out of the totals.
export const _wtBucket = () => ({ crit: 0, high: 0, med: 0, low: 0, total: 0, byPattern: {}, byName: {}, rows: [] });
export function _setAsideWorktree(wt, row) {
  const cls = classifyWorktreePath(row.file);
  if (!cls.worktree) return false;
  if (['crit', 'high', 'med', 'low'].includes(row.sev)) wt[row.sev]++;
  wt.total++;
  wt.byPattern[cls.pattern] = (wt.byPattern[cls.pattern] || 0) + 1;
  wt.byName[cls.name] = (wt.byName[cls.name] || 0) + 1;
  wt.rows.push({ ...row, pattern: cls.pattern, name: cls.name, why: cls.why });
  return true;
}
export const _worktreesOf = (wt, of, artifact) => ({ ...wt, of, note: `${wt.total} of ${of} rows are the same files re-scanned through an agent worktree under .claude/worktrees/ and are excluded from these counts. They remain in ${artifact} on disk. Set CW_WORKTREE_PATHS=off to count them.` });
// ecosystem is DERIVED from the manifest the record points at (a package-lock.json IS npm) —
// osv.sarif itself declares no ecosystem field. Unknown manifests stay '', never a guess.
// One map, in advisory-reach.mjs, because the reachability rule is GATED on it: a second copy
// here would let the two drift and quietly change which rows the npm-only rule applies to.
export const _ecosystemOf = ecosystemOf;

// Semgrep / CodeQL / trivy-config all emit SARIF; drill-down rows are rebuilt field-by-field —
// rule / file / line / sev / message and NOTHING else. A SARIF `message.text` can carry matched
// source, so the copy is bounded (capMessage) and snippets, code flows and related locations never
// cross — these rows leave the box over the published tunnel. `sev` is the same bucket the counts
// used, so a row can never disagree with the tally above it.
//
// capMessage is 4000: a Semgrep or CodeQL message spends its first few hundred characters naming
// the rule and tracing the taint path, and the part that says what to do comes after. Still
// bounded: third-party text in a JSON the panel loads whole is a render-and-memory hazard. The
// ellipsis keeps the truncation visible.
export const MESSAGE_CAP = 4000;
export const capMessage = (s) => {
  const t = String(s ?? '');
  return t.length <= MESSAGE_CAP ? t : `${t.slice(0, MESSAGE_CAP)}… [truncated at ${MESSAGE_CAP} chars — see the SARIF for the full text]`;
};

// Stamp the SHARED unknown predicate onto a category block built by any lane.
//
// Additive on purpose: the lane's own word (nosrc/noscan/norules/unparseable/undetermined/...) stays
// exactly where it is, and `unknown`/`unknownReason` appear beside it, so how much of what was
// published is unknown, and why, is answerable without changing any reader of the lane words.
export function stampUnknown(block) {
  if (!block || typeof block !== 'object' || block.unknown === true) return block;
  const reason = unknownReasonOf(block);
  return reason ? { ...block, unknown: true, unknownReason: reason } : block;
}

