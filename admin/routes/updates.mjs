// admin/routes/updates.mjs — the Updates section: every update this box can apply, and what each
// one fixes. The producer is monitor/update-vulns.mjs; this serves what it last wrote.
//
// Two tiers gated on isLoopbackReq, for the same reason as admin/routes/packages.mjs and one reason
// more: the detail here is not only a machine fingerprint (names and versions of everything behind)
// but a list of the CVEs this laptop is CURRENTLY vulnerable to, with the ones an upgrade would
// close. Published through a tunnel that is a targeting package. The published port gets counts.
//
// A refresh is a SCAN, not an upgrade: nothing in this file installs anything, and no apply path is
// added — applying stays in the Packages section, where the gate on it already lives.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, openSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { unknown } from '../../monitor/unknown.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Read at CALL time (house rule), so a test can point both stores somewhere disposable.
const updatesPath = () => process.env.CW_UPDATES_OUT || join(REPO, 'reports', 'updates.json');
const jobDir = () => process.env.CW_UPDATES_JOB_DIR || join(tmpdir(), 'cw-update-jobs');

const jobs = new Map();   // id -> { id, startedAt, pid, log, state, exit, endedAt }
// The millisecond alone collided: a refresh started the instant the last one exited took its id,
// replaced its record and appended to its log.
let jobSeq = 0;

/**
 * The scan's own output, or a state saying why there is none.
 *
 * ENOENT is the ONE absence: nobody has run it yet, which is a different sentence from "this box
 * has no updates". Anything else — a torn file, a permission error — is a void, because an empty
 * Updates panel and a clean one look identical on screen and only one of them is a claim.
 */
export function readUpdates() {
  const p = updatesPath();
  let text;
  try { text = readFileSync(p, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') {
      return { ok: false, state: 'not-run', reason: 'no update scan yet — run `node monitor/update-vulns.mjs --json-out`, or press Refresh on the operator port' };
    }
    return { ok: false, state: 'unknown', ...unknown('not-permitted', `${p} is unreadable (${e.code}) — what this box can update is UNKNOWN, not nothing`) };
  }
  let doc;
  try { doc = JSON.parse(text); } catch (e) {
    return { ok: false, state: 'unknown', ...unknown('unparseable', `${p} did not parse (${String(e.message).split('\n')[0]}) — treat as corrupt, never as zero updates`) };
  }
  if (!doc || !Array.isArray(doc.managers)) {
    return { ok: false, state: 'unknown', ...unknown('unparseable', `${p} carries no managers[] — the format decides the field, and this is not it`) };
  }
  return { ok: true, ...doc };
}

/**
 * The shape the PUBLISHED port may serve: counts and states, no names, no versions, no CVE ids.
 *
 * The withholding is STATED, because a redacted list and an empty one render the same otherwise —
 * and on this surface an empty list reads as "nothing to update", which is the one sentence this
 * panel exists to stop anybody saying by accident.
 */
export function publishedUpdatesView(doc) {
  if (!doc.ok) return { ok: false, published: true, state: doc.state, reason: doc.reason ?? doc.unknownDetail ?? null };
  return {
    ok: true,
    published: true,
    at: doc.at,
    state: doc.state,
    grypeDb: { state: doc.grypeDb?.state ?? null },
    kevChecked: doc.kevChecked ?? null,
    counts: doc.counts,
    managers: (doc.managers || []).map((m) => ({
      manager: m.manager,
      state: m.state,
      basis: m.basis ?? null,
      reason: m.reason ?? null,
      counts: m.counts ?? null,
      applyable: m.applyable ?? null,
    })),
    withheld: 'package names, versions, OS build and every vulnerability id are withheld on the published port — '
      + 'together they are a targeting package for this machine. Open the panel on the operator port for the detail.',
  };
}

export function jobView(j, { tailBytes = 4000 } = {}) {
  let tail = null;
  try {
    if (existsSync(j.log)) {
      const buf = readFileSync(j.log);
      tail = buf.subarray(Math.max(0, buf.length - tailBytes)).toString('utf8');
    }
  } catch (e) { tail = `(log unreadable: ${e.code || e.message}) — the scan's output is UNKNOWN, not empty`; }
  return { id: j.id, state: j.state, startedAt: j.startedAt, endedAt: j.endedAt ?? null, exit: j.exit ?? null, pid: j.pid ?? null, tail };
}

/**
 * Start the producer, detached, with no shell and no caller-supplied argument. One at a time: two
 * scans share one SBOM cache and one output file, and the second would land on the first's write.
 */
export function startRefresh({ now = () => new Date().toISOString(), spawnFn = spawn } = {}) {
  for (const j of jobs.values()) {
    if (j.state === 'running') return { ok: false, status: 409, error: `an update scan started by this panel is already running (job ${j.id}) — nothing was started`, job: jobView(j) };
  }
  const dir = jobDir();
  try { mkdirSync(dir, { recursive: true }); } catch (e) {
    return { ok: false, status: 500, error: `could not create the job log directory (${e.code || e.message}) — nothing was started` };
  }
  const id = `updates-${Date.now().toString(36)}-${(++jobSeq).toString(36)}`;
  const log = join(dir, `${id}.log`);
  let fd;
  try { fd = openSync(log, 'a'); } catch (e) {
    return { ok: false, status: 500, error: `could not open the job log (${e.code || e.message}) — nothing was started` };
  }
  let child;
  try {
    child = spawnFn(process.execPath, [join(REPO, 'monitor', 'update-vulns.mjs'), '--json-out'], { detached: true, stdio: ['ignore', fd, fd], cwd: REPO });
  } catch (e) {
    return { ok: false, status: 500, error: `could not start the update scan (${e.code || e.message}) — nothing is running` };
  }
  const job = { id, startedAt: now(), pid: child.pid, log, state: 'running', exit: null, endedAt: null };
  // The producer exits 1 when an update fixes something and 2 when the answer is unknown, so a
  // non-zero exit is a RESULT here, not a failure. Only a spawn error is a failed job.
  child.on('exit', (code, signal) => { job.state = 'done'; job.exit = code === null ? `signal ${signal}` : code; job.endedAt = now(); });
  child.on('error', (e) => { job.state = 'failed'; job.exit = e.code || e.message; job.endedAt = now(); });
  if (child.unref) child.unref();
  jobs.set(id, job);
  return { ok: true, status: 202, job: jobView(job) };
}

// Mirrored from serve.mjs (CW_ADMIN_LOCAL_PORT || PORT+1), read at CALL time: a 403 that misdirects
// is worse than one that says nothing.
const operatorPort = () => Number(process.env.CW_ADMIN_LOCAL_PORT || (Number(process.env.CW_ADMIN_PORT || 7878) + 1));

export const routes = [
  {
    method: 'GET',
    path: '/api/updates',
    handle: ({ send, isLoopbackReq }) => {
      const doc = readUpdates();
      if (!isLoopbackReq) return send(200, publishedUpdatesView(doc));
      return send(200, { ...doc, jobs: [...jobs.values()].map((j) => jobView(j)) });
    },
  },
  {
    method: 'POST',
    path: '/api/updates/refresh',
    handle: ({ send, isLoopbackReq }) => {
      if (!isLoopbackReq) {
        return send(403, {
          ok: false,
          error: `an update scan can only be started from the operator port, http://127.0.0.1:${operatorPort()} — not from the published port, which is external even when you are sitting at the box. `
            + 'The last scan\'s counts are available on both; starting a new one is not.',
        });
      }
      const r = startRefresh();
      return send(r.status, r.ok ? { ok: true, job: r.job } : { ok: false, error: r.error, job: r.job ?? null });
    },
  },
  {
    method: 'GET',
    path: '/api/updates/jobs',
    handle: ({ send, isLoopbackReq }) => {
      // Job logs name packages and paths on this machine, for the same reason the scan detail does.
      if (!isLoopbackReq) return send(403, { ok: false, error: 'scan logs are operator-port only — they are the output of a command run on this machine' });
      return send(200, { ok: true, jobs: [...jobs.values()].map((j) => jobView(j)) });
    },
  },
];

export default routes;
