// commitwork monitor — ADMISSION CONTROL for concurrent sweeps.
//
// install-agents.mjs staggers areas 15 minutes apart, assuming a sweep fits its slot. On 2026-08-21
// eleven ran at once: load 87, 1GB free of 48, throughput 2.6 -> 30 minutes per repo.
//
// The 335-minute figure first recorded here was contention, not cost — the SAME one-repo area took
// 5 minutes on a quiet box, a 67x difference. So the capacity claim that stood here is RETRACTED:
// 32 areas is 160 minutes sequentially, and there is no capacity gap. This module is not rationing
// a scarce resource, it is preventing a stampede that multiplies the fleet's own cost. A wider
// stagger cannot do it — durations are load-dependent, so any constant guesses at a number that
// only exists once the bound is enforced.
//
// A deferred area is LOUD and is not swept, so its freshness goes stale and says so.

import { join } from 'node:path';
import { acquireLock } from './lockfile.mjs';

// FOUR, MEASURED NOT CHOSEN. 18 cores / 48GB / NVMe, memory-layer as the fixed probe, 2026-08-22:
//
//   concurrent   memory-layer wall    vs alone    fleet throughput
//   1            309 s        —           1.0x
//   2            339 s        +10%        1.7x
//   4            371 s        +20%        3.0x
//   6            573 s        +85%        degrading — 2 of 6 unfinished at 580 s
//
// The knee is 4-6: 4 buys ~3x for a 20% penalty, 6 spends it back. Neither RAM nor CPU is the wall
// (78% free, load ~10 of 18 at every level) — past 4 it is contention among the scanners' own
// children. Disk is NOT the serialising resource, which is the intuitive answer and wrong here: four
// ran in 463 s against ~1411 s sequential, so NVMe parallelises. On spinning disk or a network mount
// this needs re-measuring — the method is the point, not the 4.
export const DEFAULT_SLOTS = 4;
// Long enough that a queued area genuinely waits for a turn, short enough that it does not sit
// until the next night's agent fires on top of it. Deliberately less than 24h for that reason.
export const DEFAULT_DEADLINE_MS = 4 * 60 * 60 * 1000;
const POLL_MS = 30_000;

export const slotName = (i) => `.sweep-slot-${i}.lock`;

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
  now = () => Date.now(),
  sleep = null,
  onWait = null,
} = {}) {
  const started = now();
  const n = Math.max(1, slots | 0);
  let announced = false;

  for (;;) {
    for (let i = 0; i < n; i++) {
      const path = join(reportsRoot, slotName(i));
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
