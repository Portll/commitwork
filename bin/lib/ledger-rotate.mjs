// Rotation for append-only JSONL stores: shift the generations, never overwrite one.
//
// A bare `renameSync(f, f + '.1')` is not rotation: rename(2) replaces an existing destination
// silently, so every rotation would destroy the previous generation with no error and no record.
// One implementation lives here so every ledger rotates the same way.
//
// READERS FIRST. A writer that produces `.2` while readers still open `[f.1, f]` preserves the data
// and hides it. `generations()` is the reader half; every reader enumerates through it.

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
 * Enumerated, never a fixed window: with `[f.1, f]` hard-coded, a third generation would be
 * unreachable and the ledger would look complete.
 */
export function generations(filePath) {
  const older = archiveGenerations(filePath).sort((a, b) => b.n - a.n).map((g) => g.path);
  return [...older, filePath].filter((f) => existsSync(f));
}

/**
 * THE lock path for a ledger. One critical section, one name.
 *
 * This file and bin/lib/touch-chain.mjs both guard rotation of the same ledger, and two mutexes
 * over one critical section is no mutual exclusion at all, so both take this one path.
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
 * LOCKED. Unlocked, concurrent producers that append and rotate together lose most of the ledger
 * silently; bin/test/ledger-rotate-concurrent.test.mjs measures it.
 *
 * THE MECHANISM. shiftArchives enumerates the generations, then renames them. Between those two
 * steps another rotation can complete, so the second caller's enumeration is stale and it renames a
 * path whose content has already moved — landing on a generation that is still wanted. That both
 * duplicates one generation and destroys another.
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
