// bin/lib/single-flight.mjs — one suite run at a time, and a refusal that is GREY, never a pass.
//
// WHY. The Stop hook ran `npm test` with no mutual exclusion, fired by every session on every stop.
// Measured 2026-09-06 18:35-18:37: 22 -> 25 -> 27 concurrent `npm test` wrappers, 64 `node --test`
// processes, load average 58/64/63, ages 17s to 26m53s. They contend for the same fixtures, ports
// and gitignored stores, so each run slows the others and each dies on its own timeout before it
// prints a tally. Every "could not read a pass/fail tally" the fleet saw that hour was this.
//
// The treadmill it produced is worth naming, because the local decision was correct each time:
// contention lengthened runs -> the timeout was raised 900_000 -> 1_800_000 so that "still running"
// stopped being reported as failure -> a longer timeout means more overlap -> longer runs.
//
// LIVENESS IS TWO FIELDS, NEVER `pid` ALONE. `kern.maxproc` is 12000 on this box, so pids wrap and
// a bare `kill(pid, 0)` eventually answers about a stranger. The pair (pid, pid_start) separates
// them: `pid_start` is milliseconds, and `pid_start / 1000` equals `ps -o lstart=` rendered as an
// epoch. Verified on this session's own row 2026-09-06 (1788677533409 -> 1788677533, matching ps).
//
// AND THE TIMEZONE TRAP THAT SITS NEXT TO IT: a stored `procStart` string is UTC while `ps -o
// lstart=` prints LOCAL. Subtracting them is clean and silent and yields a plausible number — one
// session read a +0930 offset as a 9.5-hour process restart. Compare EPOCHS, never rendered strings.
//
// FAIL-CLOSED DIRECTION. When liveness cannot be decided, treat the holder as ALIVE. The cost of
// that error is one skipped run, reported grey. The cost of the opposite error is the stampede this
// module exists to end.

/** Is the lock holder still running? `io.exists(pid)` -> bool, `io.startedAt(pid)` -> epoch seconds
 *  or null. Unknown is ALIVE: we decline to steal a lock we cannot prove is abandoned. */
export function holderAlive(holder, io) {
  if (!holder || !Number.isInteger(holder.pid) || holder.pid <= 0) return false;
  if (!io.exists(holder.pid)) return false;              // only ESRCH proves absence
  if (!Number.isFinite(holder.pidStart)) return true;    // no start recorded — cannot refute
  const started = io.startedAt(holder.pid);
  if (started == null) return true;                      // cannot measure — cannot refute
  // ONE SECOND OF TOLERANCE, and the asymmetry is the whole argument. The holder's own figure comes
  // from `Date.now() - process.uptime()*1000` while ours comes from `ps`, whole seconds; measured
  // six times on this box they floor identically, but a process starting either side of a second
  // boundary can round apart by one. Costs: a false MISMATCH declares a live holder dead and
  // restores the 27-way stampede; a false MATCH requires a recycled pid to land within one second
  // of the original's start, which needs 12000 pids to wrap in that second. Tolerate.
  return Math.abs(Math.floor(holder.pidStart / 1000) - started) <= 1;
}

/** Parse a lock file's contents. A corrupt lock is NOT an absent lock: it returns a holder that
 *  cannot be proven dead, so the caller defers rather than stampeding on unreadable state. */
export function readHolder(text) {
  try {
    const h = JSON.parse(String(text));
    return (h && typeof h === 'object') ? h : { corrupt: true };
  } catch { return { corrupt: true }; }
}

/**
 * Try to take the lock. `io` supplies: writeNew(path, text) -> true | 'EEXIST' | throws,
 * read(path) -> string | null, remove(path) -> void, exists(pid), startedAt(pid).
 * Returns { ok, holder, stolen, reason }.
 */
export function acquire(path, self, io) {
  const body = JSON.stringify(self);
  const first = io.writeNew(path, body);
  if (first === true) return { ok: true, stolen: false };

  const holder = readHolder(io.read(path));
  if (holder.corrupt) return { ok: false, holder, reason: 'lock file is unreadable — deferring rather than assuming it is free' };
  if (holderAlive(holder, io)) return { ok: false, holder, reason: 'another run holds the lock and its process is alive' };

  // Provably abandoned: the pid is gone, or it is a different process wearing a recycled pid.
  io.remove(path);
  const second = io.writeNew(path, body);
  // Lost a race to a third party between remove and write — defer; do not loop.
  if (second !== true) return { ok: false, holder: readHolder(io.read(path)), reason: 'lost the lock race after clearing an abandoned holder' };
  return { ok: true, stolen: true, holder };
}

/** Release only if we still hold it. Another run may have judged us dead and taken it. */
export function release(path, self, io) {
  const holder = readHolder(io.read(path));
  if (holder.corrupt) return false;
  if (holder.pid !== self.pid || holder.pidStart !== self.pidStart) return false;
  io.remove(path);
  return true;
}
