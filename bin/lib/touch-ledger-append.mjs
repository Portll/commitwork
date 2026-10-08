// THE one writer for the touch ledger. Both producers go through here.
//
// Extracted 2026-08-30, and the extraction IS the fix: there was no writer to reuse. The append
// lived inline in the PostToolUse hook and was exported nowhere, so bin/commit-phase.mjs — which
// lands via commit-tree + update-ref and therefore never trips commitShaFrom() — wrote no rows at
// all.
//
// fact: 41 via:'commit' rows existed that day for sessions using a bare `git commit` and ZERO for the tool that exists to make committing safe on an eight-session index / the SAFE path was the invisible one, which is the incentive pointing exactly the wrong way (expiry: never, prev: broken)
// fact: gate-tests reported "of 159 files committed since the floor, YOU touched 0" about 14c9d09, whose four files the reporting session had authored ninety seconds earlier (expiry: never, prev: broken)
//
// A SECOND writer would have been the wrong fix for the same reason a second parser was: two
// producers of one record type drift apart, and a row's worth is that it means one thing.

import { tmpdir } from 'node:os';
import { resolve, relative, isAbsolute } from 'node:path';
import { touchLedger, treeId, realTouchLedger } from './store-paths.mjs';
import { chainedAppend } from './touch-chain.mjs';

/**
 * A scratch repo may not write to the tracked ledger.
 *
 * Every leak of this kind has come from `mkdtempSync(join(tmpdir(), …))`, and a real checkout —
 * including the sibling worktrees CLAUDE.md tells sessions to prefer — is never under the OS temp
 * directory. So the rule is precise rather than heuristic, and a worktree keeps its attribution.
 *
 * Scoped to the REAL ledger deliberately: a test that sets CW_TOUCH_LEDGER is asserting on its own
 * scratch store and must still get its rows. This only refuses the combination that is never
 * legitimate — a temp tree writing into the one file the repository tracks.
 *
 * Why a guard and not another fix at the call site: this was fixed at two call sites on
 * 2026-08-30 and recurred at two more, measured 2026-09-02 at 1,523 rows (33% of the live
 * ledger). The third round of grep is the wrong instrument.
 */
export const isScratchWriteToRealLedger = (repo, ledger) => {
  try {
    if (resolve(ledger) !== realTouchLedger()) return false;
    const r = relative(resolve(tmpdir()), resolve(repo));
    return Boolean(r) && !r.startsWith('..') && !isAbsolute(r);
  } catch { return false; }
};

// The ledger must be reached through a DIRECTORY symlink, never a file one: the rotation below
// renames, and rename onto a file symlink replaces the link and orphans the target while appends
// keep succeeding. Moved here with the rotation it warns about.

/** CALL time, never module load — a test setting this after import must still win. */
const maxBytes = () => Number(process.env.CW_LEDGER_MAX_BYTES) || 2_000_000;

/**
 * Bind {session, repo, at} once; return append(rec) -> 1 written, 0 not.
 *
 * With no session id this returns a NO-OP appender rather than inventing one. The hook's rule is
 * that an unowned touch reads as somebody's, and that rule does not weaken because the caller
 * changed — so it lives here, where every caller inherits it, instead of in each caller's branch.
 *
 * mkdir and rotation are LAZY: a caller that records nothing must not shift a generation.
 */
export function touchAppender({ session, repo, at = new Date().toISOString(), ledger = touchLedger() } = {}) {
  if (!session || !repo) return () => 0;
  if (isScratchWriteToRealLedger(repo, ledger)) return () => 0;
  const s = String(session).slice(0, 8);
  // C-2 · `s` IS NOT AN IDENTITY, IN EITHER DIRECTION. Measured 2026-08-27 on 37 live sessions:
  //   · two live PROCESSES shared one sessionId — `--resume` forks it — so their rows merge under
  //     one `s` and two sessions read as one;
  //   · and one process CHANGED sessionId while running (pid 55569 took a new id on a
  //     /clear), so one session's rows split across two `s` values and read as two.
  // The harness exports CLAUDE_PID into every session and its hook children, so the process is
  // recordable for the cost of an env read. `p` is ADDITIVE: `s` keeps its exact meaning and the
  // ~40 readers that key on it are untouched — a new record type must not redefine an old field,
  // which is this writer's own stated doctrine.
  //
  // ABSENT WHEN UNKNOWN, never zero and never a guess: a row with no `p` means the writer could not
  // observe one, which is a different fact from a row whose process is known.
  // A pid still recycles; `p` narrows identity, it does not settle it. Pairing it with the process
  // start time would, and costs a stat per touch — not paid here, and named so nobody assumes it.
  const pidRaw = Number(process.env.CLAUDE_PID);
  const p = Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : null;
  const r = treeId(repo);
  return (rec) => {
    try {
      const result = chainedAppend(ledger, { s, r, ...(p === null ? {} : { p }), at, ...rec }, { maxBytes: maxBytes() });
      return result.ok ? 1 : 0;
    } catch { return 0; }   // losing a record is a nuisance; breaking an edit or a commit is not
  };
}
