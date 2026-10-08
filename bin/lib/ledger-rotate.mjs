// Rotation for append-only JSONL stores: shift the generations, never overwrite one.
//
// The touch and spine ledgers rotated with a bare `renameSync(f, f + '.1')`. rename(2) replaces an
// existing destination silently, so every rotation destroyed the previous generation — one
// generation of history, permanently, with no error and no record. Measured 2026-08-29: `.1` held
// 10,806 rows and the live file stood at 79.9% of the 2 MB threshold, so the loss was days away.
//
// verdict-journal.mjs already did this correctly and privately. That is the whole defect in
// miniature — one repo, two rotations, one of them right — so the implementation lives here and
// both callers import it.
//
// READERS FIRST. A writer that produces `.2` while readers still open `[f.1, f]` preserves the data
// and hides it, which reads as fixed and is not. `generations()` is the reader half and must land
// before or with the writer half.

import { existsSync, renameSync, statSync } from 'node:fs';
import { acquireLock } from '../../monitor/lockfile.mjs';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';

/** `{n, path}` for every `<file>.<digits>` beside the given file, ascending. `.1` is the newest. */
export function archiveGenerations(filePath) {
  const dir = dirname(filePath);
  const base = `${filePath.slice(dir.length + 1)}.`;
  let names = [];
  try { names = readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return names
    .filter((n) => n.startsWith(base) && /^\d+$/.test(n.slice(base.length)))
    .map((n) => ({ n: Number(n.slice(base.length)), path: join(dir, n) }))
    .sort((a, b) => a.n - b.n);
}

/**
 * Every generation plus the live file, OLDEST FIRST — the order a reader must concatenate in.
 * Enumerated, never a fixed window: the previous readers hard-coded `[f.1, f]`, so a third
 * generation would have been unreachable and the ledger would have looked complete.
 */
export function generations(filePath) {
  const older = archiveGenerations(filePath).sort((a, b) => b.n - a.n).map((g) => g.path);
  return [...older, filePath].filter((f) => existsSync(f));
}

/**
 * THE lock path for a ledger. One critical section, one name.
 *
 * There were two. This file took `<ledger>.rotate.lock` and bin/lib/touch-chain.mjs took
 * `<ledger>.lock`, both to guard rotation of the same file — two mutexes over one critical section
 * is no mutual exclusion at all, and each implementation's own header argues carefully for a
 * safety it did not have against the other.
 *
 * Latent when found (2026-09-02): only chainedAppend has ever rotated the only file that rotates,
 * and the spine ledger rotateIfLarge guards has never reached the threshold. It arms the moment
 * anything calls rotateIfLarge on the touch ledger — which is one import away and reads as safe.
 *
 * `.lock` and not `.rotate.lock`: chainedAppend's lock covers append AND rotation, which is the
 * wider section. Narrowing to rotation alone would let an append land mid-rotation.
 */
export const ledgerLockPath = (filePath) => `${filePath}.lock`;

/** Shift every generation down one, OLDEST first so no rename lands on a still-wanted file. */
export function shiftArchives(filePath) {
  for (const gen of archiveGenerations(filePath).reverse()) {
    try { renameSync(gen.path, `${filePath}.${gen.n + 1}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

/**
 * Rotate when the file exceeds `maxBytes`. Returns true if it rotated.
 *
 * LOCKED, and the concurrency behaviour is now MEASURED rather than argued. The previous header said
 * this was untested and that an earlier version of it had asserted "a redundant shift, not a lost
 * file" — reasoning presented as a result. The measurement, once somebody wrote it
 * (bin/test/ledger-rotate-concurrent.test.mjs): three producers appending and rotating together took
 * a 250-row chain to 79 rows. Not a redundant shift. Two thirds of the ledger, destroyed, silently.
 *
 * THE MECHANISM. shiftArchives enumerates the generations, then renames them. Between those two
 * steps another rotation can complete, so the second caller's enumeration is stale and it renames a
 * path whose content has already moved — landing on a generation that is still wanted. That both
 * duplicates one generation and destroys another, which is why the live chain showed 45,647 rows of
 * which 18,088 were unique, with two generations byte-identical.
 *
 * THE STAT IS INSIDE THE LOCK, deliberately. Locking only the rename would leave stat-then-rename
 * non-atomic against another rotator, which is the same race one step smaller. It is still not
 * atomic against a concurrent APPENDER, and that is fine and unchanged: O_APPEND of a small record
 * is atomic, so an append landing mid-rotation lands in one generation or the next, never split.
 *
 * A BUSY LOCK RETURNS FALSE, not an error. Another process is rotating this very file; the next
 * append re-checks the size and rotates then. Skipping is the correct response to "somebody else is
 * already doing it", and treating it as a failure would make a healthy race look like a fault.
 */
export function rotateIfLarge(filePath, maxBytes) {
  let lock;
  try {
    lock = acquireLock(ledgerLockPath(filePath), {
      label: 'ledger rotate', attempts: 40, spinMs: 15, staleMs: 30_000,
    });
  } catch { return false; }              // cannot even attempt the lock: leave the file alone
  if (!lock.ok) return false;            // somebody else is rotating this file right now
  try {
    let size;
    try { size = statSync(filePath).size; }
    catch (e) { if (e.code === 'ENOENT') return false; throw e; }   // absent is not a rotation
    if (size <= maxBytes) return false;
    shiftArchives(filePath);
    renameSync(filePath, `${filePath}.1`);
    return true;
  } finally {
    try { lock.release(); } catch { /* released or broken as stale; the next caller re-claims */ }
  }
}
