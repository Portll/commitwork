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
import { acquireLock, inspectLock, DEFAULT_STALE_MS } from './lockfile.mjs';
import { enqueue } from './sweep-queue.mjs';

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
 *
 * `queue` (default on) takes a ticket in `.<prefix>-queue/` before the first probe, and a waiter
 * probes the permits only while it is within the first `slots` places, so a permit that frees goes
 * to the longest waiter and a stampede admits in arrival order. A ticket already waiting under this
 * label is a sweep of the same scope, so the newcomer is refused as `coalesced` and scans nothing.
 * The result carries `queue: { position, ahead }` either way.
 */
export function acquireSweepSlot(reportsRoot, {
  slots = DEFAULT_SLOTS,
  deadlineMs = DEFAULT_DEADLINE_MS,
  label = 'sweep',
  prefix = 'sweep',
  queue = true,
  area = null, group = null,
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
  let place = { index: 0, ahead: [], total: 0 };

  const ticket = queue ? enqueue(reportsRoot, { prefix, label, area, group, deadlineMs, nowMs: started, kill, liveStart }) : null;
  if (ticket && ticket.ok !== true) {
    if (ticket.reason === 'coalesced') {
      const d = ticket.duplicate;
      return { ok: false, waitedMs: 0, slots: n, reason: `coalesced — ${label} is already queued as pid ${d.pid} (waiting ${Math.round(d.waitedMs / 60000)} min)`, coalesced: d, holders: [], holder: null, heldFor: null, holderAlive: null, queue: { position: null, ahead: [] } };
    }
    return { ok: false, waitedMs: 0, slots: n, reason: `queue unreadable (${ticket.error})`, holders: [], holder: null, heldFor: null, holderAlive: null, queue: { position: null, ahead: [] } };
  }
  const leave = () => { if (ticket) ticket.leave(); };
  const probeSlots = () => {
    if (!ticket) return true;
    ticket.touch(now());
    const p = ticket.position(now());
    place = { index: p.index, ahead: p.ahead, total: p.total };
    // guard: an unreadable queue admits nobody by position, so fall back to the bare permit race
    return !p.ok || p.index < n;
  };

  for (;;) {
    holders = [];
    const turn = probeSlots();
    for (let i = 0; turn && i < n; i++) {
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
        leave();
        return {
          ok: true, slot: i, waitedMs: now() - started, queue: { position: place.index, ahead: place.ahead },
          release: () => { try { got.release(); } catch { /* releaseOnExit is the backstop */ } },
          refresh: () => { try { return got.refresh(); } catch (e) { return { ok: false, reason: `refresh threw: ${(e && e.code) || e}` }; } },
        };
      }
      holders.push({ slot: i, holder: got.holder, heldFor: got.heldFor, holderAlive: got.holderAlive, holderMatches: got.holderMatches });
    }

    const waited = now() - started;
    const queued = place.index >= n;
    // A waiter that never probed still names the holders: the deferral line is read by whoever looks at what overran
    if (queued && holders.length === 0) {
      for (let i = 0; i < n; i++) {
        const o = inspectLock(join(reportsRoot, slotName(i, prefix)), { kill, liveStart });
        holders.push({ slot: i, holder: o.holder, heldFor: o.ageMs, holderAlive: o.holderAlive, holderMatches: o.holderMatches });
      }
    }
    const refusal = (reason) => {
      leave();
      return {
        ok: false, waitedMs: waited, slots: n, reason, holders, queue: { position: place.index, ahead: place.ahead },
        holder: holders[0]?.holder ?? null, heldFor: holders[0]?.heldFor ?? null, holderAlive: holders[0]?.holderAlive ?? null,
      };
    };
    if (waited >= deadlineMs) {
      return refusal(queued
        ? `queued behind ${place.index} sweep(s) for ${Math.round(waited / 60000)} min without reaching a turn at ${n} slot(s)`
        : `all ${n} sweep slots held for ${Math.round(waited / 60000)} min`);
    }
    if (!announced && onWait) { onWait(n, deadlineMs, place); announced = true; }
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
