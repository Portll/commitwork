// admin/routes/packages.mjs — the Packages section: what is installed on THIS BOX and what is behind.
//
// Two tiers gated on isLoopbackReq — a full inventory is a machine fingerprint; the published port
// gets counts and freshness only. Applying is operator-port only: an upgrade endpoint reachable
// through the tunnel would be remote code execution on the laptop. Apply spawns a detached job and
// returns an id; busy is only claimed for jobs this panel started, never guessed from foreign processes.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inventory, publishedView, isUnknown } from '../../monitor/package-inventory.mjs';

const TTL_MS = 60_000;   // an inventory does not change on a page refresh; the age is reported
let _cache = { at: 0, inv: null };

// Read at CALL time (house rule), so a test can point the logs somewhere disposable.
const jobDir = () => process.env.CW_PACKAGE_JOB_DIR || join(tmpdir(), 'cw-package-jobs');

// ── WHAT MAY BE APPLIED ─────────────────────────────────────────────────────────────────────────
// Explicit allowlist of manager -> argv; the request names a MANAGER only, spawned without a shell.
export const APPLY = {
  brew: { bin: 'brew', args: ['upgrade'], label: 'brew upgrade' },
  'npm-global': { bin: 'npm', args: ['-g', 'update'], label: 'npm -g update' },
};
export const NOT_APPLYABLE = {
  softwareupdate: 'an OS update can force a reboot — applying it is a human act taken at the machine, so no endpoint exists',
  toolchain: 'there is no single safe upgrade for a system interpreter; the page reports the version and the EOL status and stops there',
};

const jobs = new Map();   // id -> { id, manager, startedAt, pid, log, state, exit, endedAt }

function readInventory({ nowMs = Date.now(), includeSoftwareUpdate = true } = {}) {
  if (!_cache.inv || (nowMs - _cache.at) > TTL_MS) {
    let inv;
    try {
      inv = inventory({ includeSoftwareUpdate });
    } catch (e) {
      // a thrown observation is UNKNOWN, never an empty box
      inv = {
        at: new Date(nowMs).toISOString(),
        managers: [],
        ok: false,
        reason: `the package observation failed (${e && e.message ? e.message.split('\n')[0] : e}) — what is installed is UNKNOWN, not clean`,
      };
    }
    _cache = { at: nowMs, inv };
  }
  return { ..._cache.inv, observedAgeMs: nowMs - _cache.at };
}

/** Jobs, with a bounded tail of the log so a caller can see progress without reading a whole file. */
export function jobView(j, { tailBytes = 4000 } = {}) {
  let tail = null;
  try {
    if (existsSync(j.log)) {
      const buf = readFileSync(j.log);
      tail = buf.subarray(Math.max(0, buf.length - tailBytes)).toString('utf8');
    }
  } catch (e) { tail = `(log unreadable: ${e.code || e.message}) — the job's output is UNKNOWN, not empty`; }
  return {
    id: j.id, manager: j.manager, label: j.label, state: j.state,
    startedAt: j.startedAt, endedAt: j.endedAt ?? null, exit: j.exit ?? null, pid: j.pid ?? null,
    tail,
  };
}

export function startApply(manager, { now = () => new Date().toISOString() } = {}) {
  const spec = APPLY[manager];
  if (!spec) {
    const why = NOT_APPLYABLE[manager];
    return { ok: false, status: 400, error: why || `unknown manager ${JSON.stringify(manager)} — nothing was run` };
  }
  // one job per manager — two `brew upgrade`s at once can corrupt a prefix
  for (const j of jobs.values()) {
    if (j.manager === manager && j.state === 'running') {
      return { ok: false, status: 409, error: `a ${spec.label} started by this panel is already running (job ${j.id}) — nothing was started`, job: jobView(j) };
    }
  }
  const dir = jobDir();
  try { mkdirSync(dir, { recursive: true }); } catch (e) {
    return { ok: false, status: 500, error: `could not create the job log directory (${e.code || e.message}) — nothing was started` };
  }
  const id = `${manager}-${Date.now().toString(36)}`;
  const log = join(dir, `${id}.log`);
  let fd;
  try { fd = openSync(log, 'a'); } catch (e) {
    return { ok: false, status: 500, error: `could not open the job log (${e.code || e.message}) — nothing was started` };
  }
  let child;
  try {
    // detached + no shell: the caller names a manager, never a command string.
    child = spawn(spec.bin, spec.args, { detached: true, stdio: ['ignore', fd, fd] });
  } catch (e) {
    return { ok: false, status: 500, error: `could not start ${spec.label} (${e.code || e.message}) — nothing is running` };
  }
  const job = { id, manager, label: spec.label, startedAt: now(), pid: child.pid, log, state: 'running', exit: null, endedAt: null };
  child.on('exit', (code, signal) => {
    job.state = code === 0 ? 'done' : 'failed';
    job.exit = code === null ? `signal ${signal}` : code;
    job.endedAt = now();
  });
  child.on('error', (e) => { job.state = 'failed'; job.exit = e.code || e.message; job.endedAt = now(); });
  child.unref();
  jobs.set(id, job);
  return { ok: true, status: 202, job: jobView(job) };
}

// The refusal names the operator port — mirrored from serve.mjs (CW_ADMIN_LOCAL_PORT || PORT+1),
// read at CALL time; a 403 that misdirects is worse than one that says nothing.
const operatorPort = () => Number(process.env.CW_ADMIN_LOCAL_PORT
  || (Number(process.env.CW_ADMIN_PORT || 7878) + 1));
const refuseOffPort = (send) => send(403, {
  ok: false,
  error: `package changes can only be applied from the operator port, http://127.0.0.1:${operatorPort()} — not from the published port, which is external even when you are sitting at the box. `
    + 'The inventory above is available on both; applying is not.',
});

export const routes = [
  {
    method: 'GET',
    path: '/api/packages',
    handle: ({ send, isLoopbackReq, url }) => {
      // softwareupdate talks to Apple and is slow — opt-in per render; absence reports `not-asked`
      const includeSoftwareUpdate = (url && url.searchParams && url.searchParams.get('softwareupdate') === '1') || false;
      const inv = readInventory({ includeSoftwareUpdate });
      if (!isLoopbackReq) return send(200, publishedView(inv));
      return send(200, {
        ...inv,
        applyable: Object.keys(APPLY),
        notApplyable: NOT_APPLYABLE,
        unknownManagers: (inv.managers || []).filter(isUnknown).map((m) => m.manager),
        jobs: [...jobs.values()].map((j) => jobView(j)),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/packages/apply',
    handle: async ({ send, isLoopbackReq, readJsonBody }) => {
      if (!isLoopbackReq) return refuseOffPort(send);
      let body;
      try { body = await readJsonBody(); } catch { return send(400, { ok: false, error: 'the request body was not readable JSON — nothing was run' }); }
      const manager = body && typeof body.manager === 'string' ? body.manager : '';
      const r = startApply(manager);
      return send(r.status, r.ok ? { ok: true, job: r.job } : { ok: false, error: r.error, job: r.job ?? null });
    },
  },
  {
    method: 'GET',
    path: '/api/packages/jobs',
    handle: ({ send, isLoopbackReq }) => {
      // job logs are operator-port detail for the same reason the inventory names are
      if (!isLoopbackReq) return send(403, { ok: false, error: 'job logs are operator-port only — they are the output of commands run on this machine' });
      return send(200, { ok: true, jobs: [...jobs.values()].map((j) => jobView(j)) });
    },
  },
];

export default routes;
