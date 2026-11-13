// commitwork monitor — ADMISSION CONTROL for concurrent sweeps.
//
// install-agents.mjs staggers areas 15 minutes apart, assuming a sweep fits its slot. When many
// areas overlap, contention multiplies every sweep's duration. This module is not rationing a
// scarce resource, it is preventing a stampede that multiplies the fleet's own cost. A wider
// stagger cannot do it — durations are load-dependent, so any constant guesses at a number that
// only exists once the bound is enforced.
//
// A deferred area is LOUD and is not swept, so its freshness goes stale and says so.
//
// A permit is a lockfile.mjs lock, so its token names the holder (pid, label, host, startedAt)
// and the lock decides from pid liveness as well as stamp age: a dead or reused pid frees the
// slot at once, 'unknown' keeps the stamp rule. A sweep runs for hours against a 30-minute stamp,
// so the holder refreshes it every SLOT_REFRESH_MS; a holder that stops refreshing is hung for
// all anyone can tell and is taken over, which `onStale` reports with the previous holder named.

import { join } from 'node:path';
import { acquireLock, DEFAULT_STALE_MS } from './lockfile.mjs';

// A third of the stale bound: two missed refreshes are still inside it, one hung holder is not.
export const SLOT_REFRESH_MS = Math.floor(DEFAULT_STALE_MS / 3);

// FOUR, MEASURED NOT CHOSEN, on an 18-core / 48GB / NVMe host with one fixed probe repository:
// four concurrent sweeps bought ~3x throughput for a ~20% per-sweep penalty, and six spent it back.
// Neither RAM, CPU nor disk is the wall — past 4 it is contention among the scanners' own children.
// On spinning disk or a network mount this needs re-measuring — the method is the point, not the 4.
export const DEFAULT_SLOTS = 4;
// Long enough that a queued area genuinely waits for a turn, short enough that it does not sit
// until the next night's agent fires on top of it. Deliberately less than 24h for that reason.
export const DEFAULT_DEADLINE_MS = 4 * 60 * 60 * 1000;
const POLL_MS = 30_000;

// `prefix` names a SEPARATE permit set. The post-commit self-sweep of this checkout's own area
// used to take a fleet permit: with the shared cap at one, a commit's sweep held it for hours
// while the scheduled areas queued behind it and were deferred.
export const slotName = (i, prefix = 'sweep') => `.${prefix}-slot-${i}.lock`;

/**
 * Take one of `slots` concurrent sweep permits, waiting until `deadlineMs` for one to free.
 * -> { ok: true, slot, waitedMs, release(), refresh() }
 *  | { ok: false, waitedMs, slots, reason, holders, holder, heldFor, holderAlive }
 *    `holders` is one entry per slot from the last pass ({ slot, holder, heldFor, holderAlive,
 *    holderMatches }); `holder`/`heldFor`/`holderAlive` are slot 0's, so a one-slot caller reads
 *    them flat. A refusal names what it was refused by; the disk is not the only place that does.
 *
 * `onStale(info)` fires once per takeover with { slot, path, ageMs, holder, holderAlive,
 * holderMatches } — the previous holder, named, so a takeover is never silent.
 *
 * `now` and `sleep` are injected so a test can drive the deadline without wall-clock time — this
 * is a waiting loop, and a waiting loop tested against the real clock is a slow test that also
 * cannot exercise the timeout branch, which is the branch that matters.
 */
export function acquireSweepSlot(reportsRoot, {
  slots = DEFAULT_SLOTS,
  deadlineMs = DEFAULT_DEADLINE_MS,
  label = 'sweep',
  prefix = 'sweep',
  now = () => Date.now(),
  sleep = null,
  onWait = null,
  onStale = null,
  kill, liveStart, // probe seams, passed through to the lock; tests only
} = {}) {
  const started = now();
  const n = Math.max(1, slots | 0);
  let announced = false;
  let holders = [];

  for (;;) {
    holders = [];
    for (let i = 0; i < n; i++) {
      const path = join(reportsRoot, slotName(i, prefix));
      // attempts:1 — never busy-wait INSIDE a slot probe, or the loop cannot see the other slots.
      // The waiting happens between full passes, so a freed slot anywhere is picked up next round.
      const got = acquireLock(path, {
        label, attempts: 1, releaseOnExit: true, kill, liveStart,
        onStale: onStale ? (ageMs, holder, p, o) => onStale({ slot: i, path: p, ageMs, holder, holderAlive: o.holderAlive, holderMatches: o.holderMatches }) : null,
      });
      // `got.ok === true`, never `if (got)`: acquireLock returns {ok:false,…} on failure, and an
      // object is truthy — the bare check would take every contended slot as acquired and hand out
      // unlimited permits, which is the exact defect this module exists to prevent.
      if (got.ok === true) {
        return {
          ok: true, slot: i, waitedMs: now() - started,
          release: () => { try { got.release(); } catch { /* releaseOnExit is the backstop */ } },
          refresh: () => { try { return got.refresh(); } catch (e) { return { ok: false, reason: `refresh threw: ${(e && e.code) || e}` }; } },
        };
      }
      holders.push({ slot: i, holder: got.holder, heldFor: got.heldFor, holderAlive: got.holderAlive, holderMatches: got.holderMatches });
    }

    const waited = now() - started;
    const refusal = (reason) => ({
      ok: false, waitedMs: waited, slots: n, reason, holders,
      holder: holders[0].holder, heldFor: holders[0].heldFor, holderAlive: holders[0].holderAlive,
    });
    if (waited >= deadlineMs) return refusal(`all ${n} sweep slots held for ${Math.round(waited / 60000)} min`);
    if (!announced && onWait) { onWait(n, deadlineMs); announced = true; }
    if (!sleep) return refusal('no sleep function supplied');
    sleep(Math.min(POLL_MS, deadlineMs - waited));
  }
}

/**
 * Hold a permit for the life of a long process: re-stamp it every `refreshMs` and release it on
 * SIGINT/SIGTERM, which skip the 'exit' event the lock's own releaseOnExit relies on. The timer is
 * unref'd so it never keeps a finished process alive. The signal is re-raised only when no other
 * handler remains (area-child.mjs forwards signals to its children and re-raises itself), so the
 * exit status is still the signal's whichever handler was installed first.
 * `onRefreshFailed(r)` hears { reason: 'lost' | 'busy' | 'released' }; 'lost' means another
 * process took the permit over and two are running. -> stop(): clears the timer and the handlers.
 */
export function keepSweepSlot(held, { refreshMs = SLOT_REFRESH_MS, onRefreshFailed = null, signals = ['SIGINT', 'SIGTERM'] } = {}) {
  const timer = setInterval(() => {
    const r = held.refresh();
    if (!r.ok && onRefreshFailed) onRefreshFailed(r);
  }, refreshMs);
  timer.unref();
  const handlers = new Map();
  const stop = () => { clearInterval(timer); for (const [sig, h] of handlers) process.off(sig, h); };
  for (const sig of signals) {
    const h = () => {
      stop();
      held.release();
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    };
    handlers.set(sig, h);
    process.once(sig, h);
  }
  return stop;
}
