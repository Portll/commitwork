// admin/lib/panel-auto-update.mjs — restarts the panel onto the code on disk without an operator.
// It restarts only when the changed code has stopped changing for the settle window, no job is
// running, and a successor built from that code passes preflight. A failed preflight blocks that
// exact code until the code changes again, so a broken tree is not retried on every tick.

import { spawn } from 'node:child_process';
import { join } from 'node:path';

// Read at call time so a test, or an operator, can turn it off after import.
export const autoUpdateEnabled = (env = process.env) => env.CW_PANEL_AUTO_UPDATE !== '0' && !env.NODE_TEST_CONTEXT;
export const settleMs = (env = process.env) => {
  const n = Number(env.CW_PANEL_AUTO_UPDATE_SETTLE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 90_000;
};

// The preflight imports every module in the closure, so it runs in its own process: importing new
// code into the live server would run it here before the restart had been decided.
export function runPreflight(adminDir, entry) {
  return new Promise((done) => {
    let err = '';
    const child = spawn(process.execPath, [join(adminDir, 'lib', 'panel-preflight.mjs'), entry], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('error', (e) => { clearTimeout(timer); done({ ok: false, error: `preflight could not start: ${e.message}` }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done(code === 0 ? { ok: true } : { ok: false, error: (err.trim() || `preflight exited ${code ?? signal}`).slice(0, 1200) });
    });
  });
}

export function createAutoUpdater({ codeHealth, busy, preflight, restart, settle = settleMs, now = Date.now }) {
  let seen = null, since = 0, blocked = null, ticking = false;
  let state = { state: 'current' };
  const set = (s) => { state = { ...s, at: new Date(now()).toISOString() }; return state; };

  async function tick() {
    if (ticking) return state;
    ticking = true;
    try {
      const h = codeHealth();
      if (!h.stale) { seen = null; blocked = null; return set({ state: 'current' }); }
      if (h.fingerprint !== seen) { seen = h.fingerprint; since = now(); }
      if (blocked && blocked.fingerprint === h.fingerprint) return set({ state: 'blocked', error: blocked.error });
      const waited = now() - since;
      if (waited < settle()) return set({ state: 'settling', changed: h.changed.length, readyInMs: settle() - waited });
      if (busy()) return set({ state: 'waiting', changed: h.changed.length, reason: 'a job is running' });
      set({ state: 'checking', changed: h.changed.length });
      const pf = await preflight();
      if (!pf.ok) {
        blocked = { fingerprint: h.fingerprint, error: pf.error };
        return set({ state: 'blocked', error: pf.error });
      }
      // The preflight takes seconds; what it approved must still be what is on disk and idle.
      const after = codeHealth();
      if (after.fingerprint !== h.fingerprint) { seen = after.fingerprint; since = now(); return set({ state: 'settling', changed: after.changed.length, readyInMs: settle() }); }
      if (busy()) return set({ state: 'waiting', changed: after.changed.length, reason: 'a job is running' });
      set({ state: 'updating', changed: after.changed.length });
      restart('automatic update');
      return state;
    } finally { ticking = false; }
  }

  return { tick, state: () => state };
}
