// commitwork — the one cross-process mutex primitive, plus crash-safe writes.
// Locks are directories carrying an owner token; acquisition and removal both go through rename(2)
// so every break/release is an atomic compare-and-delete, never an rmdir of the live lock path.
// A stale lock is taken over loudly; acquisition stamps mtime so a takeover reads fresh.
// Residual: the `.breaking` guard clears unconditionally past a short grace — worst case is two
// concurrent breakers, which requires a crash inside a microsecond-long critical section.

import { chmodSync, mkdirSync, rmdirSync, rmSync, renameSync, statSync, readFileSync, writeFileSync, unlinkSync, utimesSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname, basename } from 'node:path';

export const REPORTS_LOCK = '.reports.lock';
// The per-area slice-writer lock rollup.mjs holds inline. Exported so a second per-area writer
// converges onto the identical path — two differently-named locks over one directory is no mutex.
export const ROLLUP_LOCK = '.rollup.lock';
const DEFAULT_STALE_MS = 30 * 60 * 1000;

// The owner token file — load-bearing: it is the lock's identity for the compare-and-delete.
const OWNER = 'owner.json';

// ── observation ────────────────────────────────────────────────────────────────────────────────
// One read of everything that identifies a lock. Returns null when the lock is not held.
export function observeLock(lockPath) {
  const owner = readOwner(lockPath);
  let mtimeMs;
  try { mtimeMs = statSync(lockPath).mtimeMs; } catch { return null; }
  const now = Date.now();
  // Age from the token's own stamp when present; mtime is the fallback for a lock we never wrote.
  // BOTH are plausibility-checked, not merely finite — see plausibleStamp. When neither can be
  // believed the age is UNKNOWN (`null`), which is a third state and not a very large number.
  const at = plausibleStamp(owner && owner.at, now) ? owner.at
    : plausibleStamp(mtimeMs, now) ? mtimeMs
      : null;
  return { path: lockPath, owner, mtimeMs, at, ageMs: at === null ? null : Math.max(0, now - at) };
}

// Tolerance for a stamp that reads slightly ahead of us — clock skew between two machines writing
// to one shared filesystem is ordinary and must not make a live lock unreadable.
const MAX_SKEW_MS = 5 * 60 * 1000;

// Could this number plausibly BE an acquisition time? `Number.isFinite` is not that test, and the
// gap was load-bearing: it admits 0, so a zeroed stamp produced `Date.now() - 0` — an age of ~57
// years, instantly past any staleMs, so a LIVE lock read as abandoned and was taken over on the
// spot. Measured 2026-08-29 in a sibling subsystem as a hold age of 29,800,962 minutes, which is
// exactly Date.now() expressed as a delta from zero. A zeroed field is a MISSING field, not an
// ancient one. Negatives and far-future values are rejected for the same reason: they are not
// times, and the mirror defect is just as real — a stamp in the future yields a negative age that
// can never reach staleMs, so the lock becomes permanently unbreakable.
function plausibleStamp(v, now) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= now + MAX_SKEW_MS;
}

function readOwner(lockPath) {
  try {
    const t = JSON.parse(readFileSync(join(lockPath, OWNER), 'utf8'));
    return t && typeof t === 'object' && typeof t.nonce === 'string' ? t : null;
  } catch { return null; }
}

// Same lock? The nonce is the identity when either side has a token; mtime only when neither does.
function sameLock(observed, current) {
  if (!observed || !current) return false;
  if (observed.owner || current.owner) {
    return !!(observed.owner && current.owner && observed.owner.nonce === current.owner.nonce);
  }
  return observed.mtimeMs === current.mtimeMs;
}

// ── the removal guard ──────────────────────────────────────────────────────────────────────────
// Removals are serialised (acquisitions are not — they can only land on a free path): a removal
// briefly frees the lock path, and a second remover on an older observation would rename away
// whatever got in. Held across pre-check → rename → verify → delete; microseconds.
const GUARD_SUFFIX = '.breaking';
const GUARD_GRACE_MS = 5_000;
const GUARD_ATTEMPTS = 25;

function takeGuard(guard) {
  for (let i = 0; i < GUARD_ATTEMPTS; i++) {
    try { mkdirSync(guard); return true; } catch { /* somebody is removing */ }
    // The one unguarded remove: anything past the grace is a corpse, and worst case is two
    // concurrent breakers.
    let age = Infinity;
    try { age = Date.now() - statSync(guard).mtimeMs; } catch { /* it just vanished */ }
    if (age >= GUARD_GRACE_MS) { try { rmdirSync(guard); } catch { /* another process cleared it */ } continue; }
    spin(2);
  }
  return false;
}

// ── the compare-and-delete ─────────────────────────────────────────────────────────────────────
// Remove the lock at `lockPath` ONLY if it is still the lock `observed` describes. The one removal
// path — stale takeover and ordinary release both go through it.
//
// Returns one of:
//   'broken'    the observed lock was removed (the normal outcome)
//   'moved'     it had already changed hands before we touched it — nothing removed
//   'busy'      another process is removing this lock right now — nothing removed
//   'lost'      the lock vanished between the check and the rename — nothing removed
//   'restored'  we moved a lock that was NOT the observed one and put it back where it was
//   'displaced' as 'restored', but the lock path had been re-taken so the moved copy was dropped
export function breakStaleLock(lockPath, observed) {
  const guard = `${lockPath}${GUARD_SUFFIX}`;
  if (!takeGuard(guard)) return 'busy';
  try { return removeObservedLock(lockPath, observed); }
  finally { try { rmdirSync(guard); } catch { /* already cleared */ } }
}

function removeObservedLock(lockPath, observed) {
  // Under the guard this is a real check: nothing can change the lock path before the rename.
  if (!sameLock(observed, observeLock(lockPath))) return 'moved';

  // A unique staging name, so the rename can only fail because the SOURCE is gone.
  const staged = `${lockPath}.break-${process.pid}-${randomBytes(6).toString('hex')}`;
  try { renameSync(lockPath, staged); } catch { return 'lost'; }

  // `staged` is unreachable by any acquirer — the delete targets a path nobody can acquire.
  if (!sameLock(observed, observeLock(staged))) {
    // Unreachable while the guard holds; kept for the degraded case — restore, never delete a live holder's.
    try { renameSync(staged, lockPath); return 'restored'; } catch { /* lockPath was re-taken */ }
    removeLockDir(staged);
    return 'displaced';
  }
  removeLockDir(staged);
  return 'broken';
}

// Only ever called on a path NOBODY CAN ACQUIRE — a `.break-*` stage, or a failed `.new-*` staging
// dir. The live lock path is never deleted in place: removeObservedLock() renames it under the
// guard first, which is what makes release an atomic compare-and-delete.
//
// maxRetries on the recursive fallback is the NTFS lingering-handle window: rmdirSync right after
// unlinkSync can report ENOTEMPTY while the unlinked file's handle is still closing. The debris is
// under a name no claimer is waiting on, so retrying costs nobody anything.
function removeLockDir(p) {
  try { unlinkSync(join(p, OWNER)); } catch { /* absent */ }
  try { rmdirSync(p); return true; } catch { /* gone already, or debris inside */ }
  // A hand-made lock dir may hold more than owner.json; bounded to the `<lock>.break-*` staging path.
  try { rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); return true; } catch { return false; }
}

// ── acquisition ────────────────────────────────────────────────────────────────────────────────
// Synchronous throughout (`attempts > 1` = busy-wait retry, for synchronous request handlers).
// Returns { ok:true, path, token, release } or { ok:false, path, heldFor, holder }; never exits.
export function acquireLock(lockPath, {
  staleMs = DEFAULT_STALE_MS,
  label = 'writer',
  attempts = 1,           // 1 = single shot (abort/skip callers); >1 = synchronous busy-wait
  spinMs = 20,
  releaseOnExit = false,  // process-lifetime holders only — a per-call holder would leak listeners
  onStale = null,         // (ageMs, holder, path) => void; the caller owns how loud a takeover is
} = {}) {
  const rounds = Math.max(1, attempts | 0);
  let heldFor = 0;
  let holder = null;

  for (let round = 0; round < rounds; round++) {
    const got = claim(lockPath, label, releaseOnExit);
    if (got) return got;

    const observed = observeLock(lockPath);
    if (!observed) continue; // released between our failed claim and our stat — go straight round again

    // `ageMs === null` is an age we could not read, and it is NOT a takeover licence. Stealing a
    // live lock puts two writers in the critical section and corrupts the store it guards; refusing
    // to steal a dead one costs a skipped cycle that says so out loud and that
    // `forceReleaseLock()` clears. Only one of those is recoverable, so unknown fails closed.
    if (observed.ageMs !== null && observed.ageMs >= staleMs) {
      if (onStale) onStale(observed.ageMs, observed.owner, lockPath);
      breakStaleLock(lockPath, observed);
      const after = claim(lockPath, label, releaseOnExit); // the takeover IS the acquisition
      if (after) return after;
      const now = observeLock(lockPath); // somebody else won the lock we freed
      heldFor = now ? now.ageMs : 0;
      holder = now ? now.owner : null;
    } else {
      heldFor = observed.ageMs; // may be null — an unreadable age, which callers must render as such
      holder = observed.owner;
    }
    if (round + 1 < rounds) spin(spinMs);
  }
  return { ok: false, path: lockPath, heldFor, holder };
}

// Assemble the lock in a private staging path, swap in with ONE rename — the rename is the
// test-and-set (ENOTEMPTY against a populated lock), and the lock is never seen half-built or
// momentarily empty (an empty dir is tokenless AND a legal rename target).
function claim(lockPath, label, releaseOnExit) {
  const token = { pid: process.pid, nonce: randomBytes(12).toString('hex'), at: Date.now(), label };
  const staging = `${lockPath}.new-${process.pid}-${randomBytes(6).toString('hex')}`;
  try { mkdirSync(dirname(lockPath), { recursive: true }); } catch { /* already there, or unwritable — the mkdir below reports it */ }
  mkdirSync(staging);
  try {
    writeFileSync(join(staging, OWNER), JSON.stringify(token));
    // Mtime refresh on acquisition — stamped explicitly so a taken-over lock reads fresh.
    const s = token.at / 1000;
    try { utimesSync(staging, s, s); } catch { /* best effort: the token carries `at` regardless */ }
    renameSync(staging, lockPath);
  } catch (e) {
    removeLockDir(staging);
    // WINDOWS CONTENTION ARRIVES AS EPERM, AND ERRNO CANNOT SEPARATE IT FROM A WRITE REFUSAL.
    //
    // Measured 2026-09-04: renaming a staging directory onto a POPULATED lock directory returns
    // ENOTEMPTY on POSIX and **EPERM** on Windows. EPERM was not in this set, so every CONTENDED
    // acquisition threw instead of returning null — and callers read null as contention, so
    // contention became a crash. 18 tests were failing on it (`503 !== 409`, and several that
    // killed their child outright).
    //
    // The obvious repair — add EPERM/EACCES to the accepted set — is WRONG, and
    // lock-timestamp-plausibility.test.mjs catches it: a read-only parent directory yields those
    // same codes, and reporting that as `busy` tells an operator to "try again" about a condition
    // retrying cannot clear. That test exists precisely to keep the two apart, and it caught this.
    //
    // So the discriminator is not errno, which is ambiguous here, but the FILESYSTEM, which is not:
    // contention means the lock directory EXISTS because somebody installed it. A write refusal
    // means it does not exist and we were not permitted to create it. Checked at the moment of
    // failure, which is the only moment the answer is meaningful.
    const contended = e && (e.code === 'ENOTEMPTY' || e.code === 'EEXIST' || existsSync(lockPath));
    if (!contended) throw e;  // a real filesystem failure — unavailable, not busy
    return null;              // someone else holds it
  }
  return handle(lockPath, token, releaseOnExit);
}

function handle(lockPath, token, releaseOnExit) {
  // The identity presented at release — from the installed token, never re-read from disk.
  const mine = { path: lockPath, owner: token, mtimeMs: null, at: token.at, ageMs: 0 };
  let released = false;
  let onExit = null;
  const release = () => {
    if (released) return;
    released = true;
    if (onExit) { try { process.off('exit', onExit); } catch { /* nothing registered */ } }
    // Identity-checked release — a taken-over holder must not delete its successor's lock.
    breakStaleLock(lockPath, mine);
  };
  if (releaseOnExit) { onExit = () => { try { release(); } catch { /* exiting anyway */ } }; process.on('exit', onExit); }
  return { ok: true, path: lockPath, token, release };
}

// Synchronous busy-wait, deliberate: the callers are synchronous, nothing to await. Keep it short.
//
// ATOMICS.WAIT WAS TRIED HERE ON 2026-09-04 AND REVERTED, which is worth recording so the next
// reader does not spend the afternoon rediscovering it. The argument for it is good: this burn pins
// a core for the whole wait, every process waiting on the lock does it at once, and
// `Atomics.wait(buf, 0, 0, ms)` is a synchronous sleep that consumes nothing — monitor/images.mjs
// already sleeps exactly that way.
//
// It HANGS bin/test/touch-chain.test.mjs, reproducibly: 29 passing with the burn, a >100 s timeout
// with the sleep, and the difference bisected to this one function. The cause was not chased
// further because the result is decisive on its own, and a lock primitive is the wrong place to
// carry an unexplained behaviour. Atomics.wait is also coarse here — a 50 ms request measured 64 ms
// — so its precision is no better than the burn's at these durations.
//
// If this is revisited, the thing to explain FIRST is why touch-chain hangs, not why the sleep is
// nicer. It is nicer.
function spin(ms) { const until = Date.now() + ms; while (Date.now() < until) { /* spin */ } }

// One rendering of a hold age, so no caller has to decide on its own what to say about an age it
// does not have. `null` is not zero: an operator told "0s old" about an unreadable stamp has been
// told a measurement that was never taken.
export function describeAge(ms) {
  return (ms === null || ms === undefined) ? 'age unknown' : `${Math.round(ms / 1000)}s old`;
}

// ── the three-outcome acquire ───────────────────────────────────────────────────────────────────
// acquireLock THROWS on a real filesystem failure (ENOSPC, EACCES, EROFS) instead of reporting the
// lock busy — see claim()'s rethrow — and that is the right direction: a full disk is not
// contention, and a {ok:false} there would invite a caller to retry forever against a condition no
// amount of retrying clears. But a request handler still has to answer, and the handlers that call
// this were all written for exactly two outcomes, so the throw skipped straight past the branch
// that renders contention and escaped the handler.
//
// This adds the missing THIRD outcome rather than folding it into the second. `unavailable` is not
// `busy`: a caller that renders them the same way tells an operator to "try again" about a disk
// that will be just as full next time. The distinction is the whole point — collapsing it would
// reintroduce the defect one layer up.
export function acquireLockOrReason(lockPath, opts) {
  try {
    const got = acquireLock(lockPath, opts);
    if (got.ok) return { ok: true, lock: got };
    return { ok: false, reason: 'busy', holder: got.holder, heldFor: got.heldFor };
  } catch (e) {
    // Deliberately NOT swallowed into a boolean — the code is what tells an operator whether to
    // free disk, fix a mount, or look at permissions.
    return { ok: false, reason: 'unavailable', code: (e && e.code) || null, message: (e && e.message) || String(e) };
  }
}

// ── operator surface ───────────────────────────────────────────────────────────────────────────
// Read-only. `stale` uses the same threshold acquisition does, so what an operator is told matches
// what the next acquirer will actually do.
export function inspectLock(lockPath, { staleMs = DEFAULT_STALE_MS } = {}) {
  const o = observeLock(lockPath);
  if (!o) return { held: false, path: lockPath, ageMs: null, ageKnown: true, stale: false, holder: null };
  // `ageKnown:false` separates "not held" from "held, age unreadable" — both carry ageMs null, and
  // an operator told "0s old" for the second would be told something we did not measure.
  return {
    held: true, path: lockPath, ageMs: o.ageMs, ageKnown: o.ageMs !== null,
    stale: o.ageMs !== null && o.ageMs >= staleMs, holder: o.owner,
  };
}

// Break a lock regardless of age — the impatient operator path. Still a compare-and-delete: it
// removes the lock it just observed, never "whatever is at that path by now".
export function forceReleaseLock(lockPath) {
  const o = observeLock(lockPath);
  if (!o) return { released: false, path: lockPath, reason: 'no lock present' };
  const outcome = breakStaleLock(lockPath, o);
  if (outcome === 'broken' || outcome === 'displaced') return { released: true, path: lockPath };
  return { released: false, path: lockPath, reason: `the lock changed hands while it was being released (${outcome})` };
}

// ── the root-wide reports lock (policy layer) ──────────────────────────────────────────────────
// Single shot (contention = skip this cycle), held for the life of the process. `lockName` lets a
// per-area caller converge onto ROLLUP_LOCK instead of a second lock rollup never checks.
export function takeReportsLock(reportsRoot, { staleMs = DEFAULT_STALE_MS, label = 'writer', lockName = REPORTS_LOCK } = {}) {
  const path = join(reportsRoot, lockName);
  return acquireLock(path, {
    staleMs, label, releaseOnExit: true,
    onStale: (ageMs) => console.error(`[lock] taking over a stale reports lock (${Math.round(ageMs / 60000)} min old) at ${path}`),
  });
}

// Crash-safe write: sibling temp file + rename — a reader sees the whole old file or the whole new one.
// `mode` is applied to the temp file before the rename (create-time mode is umask-masked), so the
// target never exists with the wrong mode — a git hook briefly non-executable is silently skipped.
export function writeAtomic(path, data, { mkdir = false, mode } = {}) {
  if (mkdir) mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  try {
    writeFileSync(tmp, data);
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch (cleanup) { e.cleanup = cleanup; }
    throw e;
  }
}
