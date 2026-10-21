// commitwork monitor — ADMISSION CONTROL for concurrent sweeps.
//
// install-agents.mjs staggers areas 15 minutes apart, assuming a sweep fits its slot. When many
// areas overlap, contention multiplies every sweep's duration. This module is not rationing a
// scarce resource, it is preventing a stampede that multiplies the fleet's own cost. A wider
// stagger cannot do it — durations are load-dependent, so any constant guesses at a number that
// only exists once the bound is enforced.
//
// A deferred area is LOUD and is not swept, so its freshness goes stale and says so.

import { join } from 'node:path';
import { acquireLock } from './lockfile.mjs';

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
 * -> { ok: true, slot, waitedMs, release() } | { ok: false, waitedMs, slots, reason }
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
} = {}) {
  const started = now();
  const n = Math.max(1, slots | 0);
  let announced = false;

  for (;;) {
    for (let i = 0; i < n; i++) {
      const path = join(reportsRoot, slotName(i, prefix));
      // attempts:1 — never busy-wait INSIDE a slot probe, or the loop cannot see the other slots.
      // The waiting happens between full passes, so a freed slot anywhere is picked up next round.
      const got = acquireLock(path, { label, attempts: 1, releaseOnExit: true });
      // `got.ok === true`, never `if (got)`: acquireLock returns {ok:false,…} on failure, and an
      // object is truthy — the bare check would take every contended slot as acquired and hand out
      // unlimited permits, which is the exact defect this module exists to prevent.
      if (got.ok === true) {
        return {
          ok: true, slot: i, waitedMs: now() - started,
          release: () => { try { got.release(); } catch { /* releaseOnExit is the backstop */ } },
        };
      }
    }

    const waited = now() - started;
    if (waited >= deadlineMs) {
      return { ok: false, waitedMs: waited, slots: n,
        reason: `all ${n} sweep slots held for ${Math.round(waited / 60000)} min` };
    }
    if (!announced && onWait) { onWait(n, deadlineMs); announced = true; }
    if (!sleep) return { ok: false, waitedMs: waited, slots: n, reason: 'no sleep function supplied' };
    sleep(Math.min(POLL_MS, deadlineMs - waited));
  }
}
