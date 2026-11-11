// lib/update/scheduler.mjs — the panel's daily release check (portll-update@1), driven by a tick
// the caller runs on an interval. It checks a few minutes after start, then once a day, each time
// with jitter so a fleet of installs does not ask at the same instant.
//
// With update.auto = install it installs only when idle: no panel job running and no sweep in
// flight (`busy`). A busy tick leaves the check due, so the next idle tick runs it. Installing
// replaces the tree on disk; the panel's own auto-updater (admin/lib/panel-auto-update.mjs) then
// sees the code change and restarts onto it at its next idle point. This module says so in the log
// and in its state, which the panel health line shows. It never restarts anything itself.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const JITTER_MS = 60 * 60 * 1000;
export const START_JITTER_MS = 10 * 60 * 1000;
const START_DELAY_MS = 2 * 60 * 1000;

/**
 * @param {object} o
 * @param {() => string} o.mode            update.auto, read at each tick: install | notify | off
 * @param {(mode: 'install'|'check') => Promise<object>} o.run   lib/update/run.mjs runUpdate, bound
 * @param {() => string|null} o.busy        a reason the process is busy, or null when idle
 */
export function createUpdateScheduler({ mode, run, busy, log = () => {}, now = Date.now, random = Math.random, intervalMs = DAY_MS, jitterMs = JITTER_MS }) {
  let nextAt = now() + START_DELAY_MS + Math.floor(random() * START_JITTER_MS);
  let ticking = false;
  let state = { state: 'scheduled', nextAt: new Date(nextAt).toISOString() };
  const set = (s) => { state = { ...s, at: new Date(now()).toISOString(), nextAt: new Date(nextAt).toISOString() }; return state; };

  async function tick() {
    const m = mode();
    if (m === 'off') return set({ state: 'off' });
    if (ticking || now() < nextAt) return state;
    const why = m === 'install' ? busy() : null;
    if (why) return set({ state: 'waiting', reason: why });
    ticking = true;
    try {
      let r;
      try { r = await run(m === 'install' ? 'install' : 'check'); }
      catch (e) { r = { outcome: 'error', detail: e.message }; }
      nextAt = now() + intervalMs + Math.floor(random() * jitterMs);
      const facts = { outcome: r.outcome, installed: r.installed, version: r.version, source: r.source, keyId: r.keyId };
      if (r.outcome === 'installed') {
        log(`[update] commitwork ${r.version} installed from ${r.source} (signed ${r.keyId}); the panel restarts onto it at its next idle point, when no job is running`);
        return set({ state: 'installed', ...facts, note: `commitwork ${r.version} is installed; the panel restarts onto it at its next idle point` });
      }
      if (r.outcome === 'available') {
        log(`[update] commitwork ${r.version} is available (installed ${r.installed})${r.detail ? `: ${r.detail}` : ''}`);
        return set({ state: 'available', ...facts, note: r.detail || `run commitwork update to install ${r.version}` });
      }
      if (r.outcome === 'current') return set({ state: 'current', ...facts });
      log(`[update] daily check: ${r.outcome}${r.detail ? `: ${r.detail}` : ''}`);
      return set({ state: 'failed', ...facts, detail: r.detail || null });
    } finally { ticking = false; }
  }

  return { tick, state: () => state };
}

/**
 * A reason no install may start now, or null. `jobs` is the panel's running map; `markers` is
 * monitor/sweep-health.mjs readMarkers' result. A sweep marker whose pid is alive, or cannot be
 * probed, holds the install; so does a reports tree that cannot be read (fail closed).
 */
export function busyReason({ jobs = {}, markers = { ok: true, markers: [] }, pidAlive }) {
  const job = Object.entries(jobs).find(([, on]) => on);
  if (job) return `the ${job[0]} job is running`;
  if (!markers.ok) return 'the sweep in-flight markers could not all be read';
  for (const mk of markers.markers || []) {
    let alive;
    try { alive = Number.isInteger(mk.pid) && mk.pid > 0 ? pidAlive(mk.pid) : true; }
    catch { alive = true; }
    if (alive) return `a sweep of ${mk.area} is in flight`;
  }
  return null;
}
