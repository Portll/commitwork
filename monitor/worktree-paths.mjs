// worktree-paths.mjs — findings that describe ANOTHER COPY of the repo being scanned.

// An agent worktree under `.claude/worktrees/<name>/` is this same repository checked out again, so
// a walker that descends into one reports every finding N+1 times: measured 2026-08-25, the
// minifiedCode lane published 8 rows for 2 files across 4 worktrees, 21% of that repo's table.
// Class C3, wrong population measured — real findings, none of them a second place to fix.

// THE RULE THIS FILE OBEYS, inherited from monitor/fixture-paths.mjs: classify, never drop. A row
// under a worktree path keeps its severity and gains the pattern that matched, leaves HEADLINE
// totals, and is counted separately — a reader sees "38 rows, 8 in agent worktrees", not either
// number alone.

// That is not neatness. An excluded finding that is still ENUMERABLE cannot silently satisfy an
// auto-close gate, and a scanner-scope change that REMOVES rows closes whatever tracked issues were
// keyed on them: the gate cannot tell "gone because fixed" from "gone because excluded"
// (taxonomy 1.68, 2026-08-25).

// ADOPTING THIS IN ANOTHER LANE IS NOT FREE. monitor/issues.json holds 10 OPEN issues keyed on
// `.claude/worktrees/` paths — shodh-memory and overwatch-layer, in the iac and actionsPosture lanes, 3 of
// them duplicate identities. They are safe only while their rows stay enumerable. Verify before
// wiring a new lane; do not assume this module makes the change inert.

// Env: CW_WORKTREE_PATHS=off disables classification entirely (everything counts); read at CALL time.

/** Agent worktree roots. A path is a copy only when a NAMED worktree directory sits beneath one of
 *  these, so `.claude/settings.json` — real config in the scanned repo — is never classified. */
export const WORKTREE_ROOTS = Object.freeze([
  { seg: '.claude/worktrees', why: 'a Claude Code agent worktree: this repository checked out again' },
  { seg: '.git/worktrees', why: 'git\'s own worktree administrative directory' },
]);

const norm = (u) => String(u || '')
  .replace(/^file:\/\/\/?/, '')
  .replace(/\\/g, '/')
  .replace(/^\.?\//, '');

export const enabled = () => process.env.CW_WORKTREE_PATHS !== 'off';

const NONE = Object.freeze({ worktree: false, pattern: null, why: null, name: null });

/**
 * Classify one path.
 * @returns {{worktree: boolean, pattern: string|null, why: string|null, name: string|null}}
 */
export function classifyWorktreePath(uri) {
  if (!enabled()) return NONE;
  const path = norm(uri);
  if (!path) return NONE;
  for (const { seg, why } of WORKTREE_ROOTS) {
    const i = path.indexOf(`${seg}/`);
    // Must be at the start or on a segment boundary — `vendor/x.claude/worktrees/` is not ours.
    if (i === -1 || (i > 0 && path[i - 1] !== '/')) continue;
    // A named worktree directory must follow, AND something must follow THAT: `.claude/worktrees/a`
    // is the worktree's own root, not a file inside a copy.
    const rest = path.slice(i + seg.length + 1).split('/').filter(Boolean);
    if (rest.length < 2) continue;
    return { worktree: true, pattern: seg, why, name: rest[0] };
  }
  return NONE;
}

/**
 * Split rows by worktree classification. Returns BOTH halves plus a report — the caller publishes
 * the report beside the count and can always recover what was set aside.
 * @param {Array} rows
 * @param {(row:any)=>string} pathOf
 */
export function partition(rows, pathOf = (r) => r.file || r.path || r.uri || '') {
  const kept = []; const worktrees = []; const byPattern = {}; const byName = {};
  for (const r of rows || []) {
    const c = classifyWorktreePath(pathOf(r));
    if (!c.worktree) { kept.push(r); continue; }
    worktrees.push({ ...r, worktree: true, worktreePattern: c.pattern, worktreeName: c.name });
    byPattern[c.pattern] = (byPattern[c.pattern] || 0) + 1;
    byName[c.name] = (byName[c.name] || 0) + 1;
  }
  const total = (rows || []).length;
  return {
    kept,
    worktrees,
    report: {
      enabled: enabled(),
      total,
      inWorktrees: worktrees.length,
      byPattern,
      byName,
      note: worktrees.length
        ? `${worktrees.length} of ${total} findings describe a copy of this repository under an agent worktree and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries worktree: true with the pattern that matched. Set CW_WORKTREE_PATHS=off to count them.`
        : 'no findings under an agent worktree path',
    },
  };
}
