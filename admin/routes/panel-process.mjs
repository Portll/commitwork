// admin/routes/panel-process.mjs — GET /api/panel/health and POST /api/panel/restart: whether the
// running panel is the code on disk, and the operator restart that hands the ports to a successor.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ADMIN } from '../lib/core.mjs';

// fact: bound once at boot by initPanelProcessRoutes
let BOOT_AT = '';
let codeHealth = () => { throw new Error('panel-process.mjs used before initPanelProcessRoutes'); };
let restartPanel = () => { throw new Error('panel-process.mjs used before initPanelProcessRoutes'); };
let successorEntry; // serve.mjs never passes it; tests point it at a fixture

// contract: run once at boot, before the first request
export function initPanelProcessRoutes(deps) {
  ({ BOOT_AT, codeHealth, restartPanel, successorEntry = join(ADMIN, 'serve.mjs') } = deps);
}

export const routes = [
  // ── panel process health + operator restart ──────────────────────────────────────────────────
  // GET /api/panel/health: pid, uptime, memory, and the code-staleness verdict (codeHealth()) —
  // the panel's own answer to "am I the process the code on disk describes?".
  { method: 'GET', path: '/api/panel/health', handle: ({ send }) => {
    const mem = process.memoryUsage();
    return send(200, { ok: true, pid: process.pid, node: process.version, startedAt: BOOT_AT,
      uptimeSecs: Math.round(process.uptime()), memory: { rss: mem.rss, heapUsed: mem.heapUsed },
      // supervised = launchd (KeepAlive) owns relaunching; the restart route then exits instead
      // of spawning its own successor, so two supervisors never fight over the ports
      supervised: !!process.env.CW_PANEL_SUPERVISED,
      code: codeHealth() });
  } },
  // POST /api/panel/restart: close both listeners, spawn a successor from the code on disk with
  // THIS process's env (CW_OAUTH_LIVE_EXCHANGE and friends travel — a bare relaunch silently
  // dropping them is a named failure mode), then exit. PRE-FLIGHT: the serve.mjs on disk must
  // link and must boot on scratch ports and stores, or the restart is refused — killing the only
  // panel with no viable successor is worse than running stale. Sits below the login gate + CSRF
  // like every other trigger.
  { method: 'POST', path: '/api/panel/restart', handle: ({ send }) => {
    // guard: successor must load and boot, not only parse
    const chk = spawnSync(process.execPath, [join(ADMIN, 'lib', 'panel-preflight.mjs'), successorEntry], { encoding: 'utf8', timeout: 60_000 });
    if (chk.status !== 0) return send(409, { ok: false, error: 'refused: the panel code on disk does not load or boot — restarting now would kill the panel with no successor', detail: String(chk.stderr || chk.error?.message || '').slice(0, 1200) });
    send(200, { ok: true, restarting: true, pid: process.pid, log: 'reports/panel-restart.log', note: 'listeners are closing; a successor takes the ports and this pid exits' });
    return restartPanel();
  } },
];
