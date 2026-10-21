// mcp/jobs.mjs — the bounded job queue behind run_checks_start / run_checks_result.
//
// Jobs run in the server process that accepted them. Given a store directory, each process also
// writes its jobs to <dir>/<prefix>.json after every change, so a restarted server can answer for an
// earlier process's ids: a finished job with its stored result, and a job that was queued or running
// when its process exited as `interrupted`. An interrupted job is never re-run. One file per process,
// so concurrent servers never write the same file.
// Every bound refuses rather than drops: a full queue throws at submit, and a finished job leaves
// retention only after it was retained for the configured count or time.
//
// env, read at call time: CW_MCP_JOB_CONCURRENCY (runs at once, default 1),
//       CW_MCP_JOB_QUEUE (runs waiting, default 8), CW_MCP_JOB_RETAIN (finished jobs kept, default 50),
//       CW_MCP_JOB_RETAIN_MS (how long a finished job is kept, default 1 h),
//       CW_MCP_JOB_STORE (the job store directory, default <reports root>/mcp-jobs)

import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../monitor/lockfile.mjs';

const LIMITS = [
  ['concurrency', 'CW_MCP_JOB_CONCURRENCY', 1, 1],
  ['maxQueued', 'CW_MCP_JOB_QUEUE', 8, 0],
  ['maxRetained', 'CW_MCP_JOB_RETAIN', 50, 1],
  ['retainMs', 'CW_MCP_JOB_RETAIN_MS', 60 * 60 * 1000, 1],
];

/** Read at call time. A malformed value throws: a typo must not silently become the default. */
export function jobLimits(env = process.env) {
  const out = {};
  for (const [key, name, dflt, min] of LIMITS) {
    const raw = env[name];
    if (raw === undefined || raw === '') { out[key] = dflt; continue; }
    if (!/^\d+$/.test(raw) || Number(raw) < min) throw new Error(`${name}=${JSON.stringify(raw)} is not an integer >= ${min}`);
    out[key] = Number(raw);
  }
  return out;
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const JOB_STATES = Object.freeze(['queued', 'running', 'done', 'failed', 'interrupted']);
export const JOB_STORE_SCHEMA = 'commitwork.mcp-jobs/1';
const IN_FLIGHT = new Set(['queued', 'running']);
const ID_RE = /^job-([a-z0-9]{1,32})-(\d+)$/;

/**
 * Is the process that wrote a store file still running? A server holds one queue, so this pid with
 * another prefix is an earlier process whose pid was reused.
 */
export function ownerAlive(owner, selfPrefix) {
  if (owner.pid === process.pid) return owner.prefix === selfPrefix;
  try { process.kill(owner.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** A store file, parsed and shape-checked. ENOENT is null; anything else throws. */
export function readJobStore(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const doc = JSON.parse(raw);
  if (!isRecord(doc) || doc.schema !== JOB_STORE_SCHEMA) throw new Error(`not a ${JOB_STORE_SCHEMA} document`);
  if (!isRecord(doc.owner) || !Number.isInteger(doc.owner.pid) || doc.owner.pid < 1 || typeof doc.owner.prefix !== 'string'
    || !Number.isInteger(doc.issued) || !Array.isArray(doc.jobs) || Number.isNaN(Date.parse(doc.savedAt))) {
    throw new Error('malformed: owner, issued, savedAt or jobs is missing or of the wrong type');
  }
  return doc;
}

/**
 * @param {object} o
 * @param {(payload: any, job: {id: string}) => {done: Promise<{state: 'done'|'failed', result?: any, reason?: string, extra?: object}>, kill: () => void}} o.start
 * @param {() => number} [o.now]
 * @param {() => ReturnType<typeof jobLimits>} [o.limits]
 * @param {string} [o.prefix] per-process id prefix, [a-z0-9]{1,32}
 * @param {(() => string) | null} [o.store] the store directory, resolved at each use; null keeps jobs in memory only
 * @param {(view: object) => object} [o.redact] what of a job's view is written to the store
 * @param {typeof ownerAlive} [o.alive]
 */
export function createJobQueue({ start, now = Date.now, limits = () => jobLimits(), prefix, store = null, redact = (v) => v, alive = ownerAlive }) {
  const jobs = new Map();           // insertion order = submission order
  const waiting = [];
  const live = new Map();           // id -> kill
  let issued = 0;
  let closed = null;
  let storeError = null;
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  const ended = (j) => j.finishedAt ?? j.interruptedAt ?? null;
  const fileFor = (p) => join(store(), `${p}.json`);

  if (prefix === undefined) {
    prefix = randomBytes(4).toString('hex');
    // A collision would overwrite an earlier process's record; draw again rather than risk it.
    for (let i = 0; store && existsSync(fileFor(prefix)); i++) {
      if (i >= 8) throw new Error(`job store ${store()}: could not draw an unused job id prefix`);
      prefix = randomBytes(4).toString('hex');
    }
  } else if (!/^[a-z0-9]{1,32}$/.test(prefix)) throw new Error(`job id prefix ${JSON.stringify(prefix)} is not [a-z0-9]{1,32}`);
  else if (store && existsSync(fileFor(prefix))) throw new Error(`job store ${fileFor(prefix)} already exists; refusing to overwrite another process's record`);
  if (store) sweep();

  // Files of exited processes whose last record is older than retention. A file that does not parse
  // is left for get() to report: deleting it would turn an unreadable record into an absent one.
  function sweep() {
    let names;
    try { names = readdirSync(store()); } catch (e) {
      if (e.code === 'ENOENT') return;
      throw new Error(`job store ${store()} cannot be listed (${e.code || e.message}); set CW_MCP_JOB_STORE to a writable directory`);
    }
    const lim = limits();
    for (const n of names) {
      const m = /^([a-z0-9]{1,32})\.json$/.exec(n);
      if (!m || m[1] === prefix) continue;
      let doc;
      try { doc = readJobStore(join(store(), n)); } catch { continue; }
      if (doc && !alive(doc.owner, prefix) && now() - Date.parse(doc.savedAt) > lim.retainMs) rmSync(join(store(), n), { force: true });
    }
  }

  function record(job) {
    const v = { jobId: job.id, state: job.state, request: job.request,
      submittedAt: iso(job.submittedAt), startedAt: iso(job.startedAt), finishedAt: iso(job.finishedAt) };
    if (job.interruptedAt != null) v.interruptedAt = iso(job.interruptedAt);
    if (job.reason) v.reason = job.reason;
    if (job.result !== undefined) v.result = job.result;
    return { ...v, ...job.extra };
  }

  function save(n = issued) {
    if (!store) return;
    const doc = { schema: JOB_STORE_SCHEMA, owner: { prefix, pid: process.pid }, savedAt: iso(now()), issued: n,
      jobs: [...jobs.values()].map((j) => redact(record(j))) };
    writeAtomic(fileFor(prefix), `${JSON.stringify(doc, null, 2)}\n`, { mkdir: true, mode: 0o600 });
  }
  // After a submit the store is best effort: the run cannot be refused any more, so a failed write
  // rides on every view until a later write succeeds.
  function persist() {
    try { save(); storeError = null; } catch (e) { storeError = `job store not written (${e.code || e.message}); this job may not survive a restart`; }
  }

  function prune(lim) {
    const t = now();
    const before = jobs.size;
    const finished = [...jobs.values()].filter((j) => ended(j) != null);
    for (const j of finished) if (t - ended(j) > lim.retainMs) jobs.delete(j.id);
    const left = finished.filter((j) => jobs.has(j.id));
    for (let i = 0; i < left.length - lim.maxRetained; i++) jobs.delete(left[i].id);
    if (jobs.size !== before) persist();
  }

  function merge(job, extra) {
    for (const [k, v] of Object.entries(extra || {})) {
      const prev = job.extra[k];
      job.extra[k] = isRecord(prev) && isRecord(v) ? { ...prev, ...v } : v;
    }
  }

  function finish(job, out) {
    live.delete(job.id);
    job.state = out.state === 'done' ? 'done' : 'failed';
    job.finishedAt = now();
    if (out.result !== undefined) job.result = out.result;
    if (out.reason) job.reason = out.reason;
    merge(job, out.extra);
    if (job.state === 'failed' && !job.reason) job.reason = 'the runner reported failure without a reason';
    if (job.interruptedBy) {
      job.state = 'interrupted';
      job.interruptedAt = job.finishedAt;
      job.reason = `interrupted while running: ${job.interruptedBy}; not re-run${job.reason ? ` (the run ended: ${job.reason})` : ''}`;
    }
    persist();
    pump();
  }

  function pump() {
    if (closed) return;
    let lim;
    try { lim = limits(); } catch (e) {
      // A limit that stopped parsing mid-session fails the waiting jobs by name rather than stalling them.
      for (const job of waiting.splice(0)) finish(job, { state: 'failed', reason: `not started: ${e.message}` });
      return;
    }
    while (waiting.length && live.size < lim.concurrency) {
      const job = waiting.shift();
      job.state = 'running';
      job.startedAt = now();
      persist();
      let h;
      try { h = start(job.payload, { id: job.id }); } catch (e) { finish(job, { state: 'failed', reason: `did not start: ${e.message}` }); continue; }
      live.set(job.id, h.kill);
      h.done.then((out) => finish(job, out || {}), (e) => finish(job, { state: 'failed', reason: e?.message || String(e) }));
    }
  }

  function view(job) {
    const v = record(job);
    if (job.state === 'queued') v.queuePosition = waiting.indexOf(job) + 1;
    if (storeError) v.storeError = storeError;
    return v;
  }

  // Another process's job, from its file. In flight there and its owner gone = interrupted.
  function stored(id, p, n, lim) {
    const file = fileFor(p);
    let doc;
    try { doc = readJobStore(file); } catch (e) {
      throw new Error(`job store ${file} is unreadable (${e.code || e.message}); refusing to report ${id} as absent`);
    }
    if (!doc) throw new Error(`job ${id} was not issued by this server process, and the job store holds no record of it: it was never issued, or its process exited more than ${lim.retainMs} ms ago`);
    if (doc.owner.prefix !== p) throw new Error(`job store ${file} is unreadable (it names prefix ${JSON.stringify(doc.owner.prefix)}); refusing to report ${id} as absent`);
    const job = doc.jobs.find((j) => j?.jobId === id);
    if (!job) {
      if (n <= doc.issued) throw new Error(`job ${id} has expired from retention (finished jobs are kept for ${lim.retainMs} ms, at most ${lim.maxRetained} of them)`);
      throw new Error(`job ${id} was never issued: the process that owns its prefix issued ${doc.issued}`);
    }
    const out = { ...job, restored: true };
    if (!IN_FLIGHT.has(job.state)) {
      const t = Date.parse(job.finishedAt ?? job.interruptedAt ?? doc.savedAt);
      if (now() - t > lim.retainMs) throw new Error(`job ${id} has expired from retention (finished jobs are kept for ${lim.retainMs} ms, at most ${lim.maxRetained} of them)`);
      return out;
    }
    if (alive(doc.owner, prefix)) {
      return { ...out, heldBy: { pid: doc.owner.pid, note: 'another live server process holds this job; this is the state it last recorded' } };
    }
    if (now() - Date.parse(doc.savedAt) > lim.retainMs) throw new Error(`job ${id} has expired from retention (its process exited more than ${lim.retainMs} ms ago)`);
    return { ...out, state: 'interrupted',
      reason: `interrupted: the server process that held this job (pid ${doc.owner.pid}) exited while it was ${job.state}; last recorded ${doc.savedAt}; not re-run`,
      lastRecordedAt: doc.savedAt };
  }

  return {
    /** Refuses (throws) when the queue is full, the server is closing, or the store cannot be written; never drops. */
    submit(payload, { request = null, extra = {} } = {}) {
      if (closed) throw new Error(`job refused: the server is shutting down (${closed})`);
      const lim = limits();
      prune(lim);
      const freeSlot = live.size < lim.concurrency && waiting.length === 0;
      if (!freeSlot && waiting.length >= lim.maxQueued) {
        throw new Error(`job refused: queue full (${live.size} running of ${lim.concurrency}, ${waiting.length} queued of ${lim.maxQueued}); collect or wait for a running job, then submit again`);
      }
      const job = { id: `job-${prefix}-${issued + 1}`, state: 'queued', payload, request, extra: { ...extra },
        submittedAt: now(), startedAt: null, finishedAt: null, interruptedAt: null };
      jobs.set(job.id, job);
      // Refused before it exists: a job that cannot survive a restart is not accepted.
      try { save(issued + 1); storeError = null; } catch (e) {
        jobs.delete(job.id);
        throw new Error(`job refused: the job store could not be written (${e.code || e.message}); set CW_MCP_JOB_STORE to a writable directory`);
      }
      issued += 1;
      waiting.push(job);
      pump();
      return { ...view(job), limits: lim };
    },
    /** Merge fields into a job's record, one level deep, as a runner's `extra` is. */
    annotate(id, extra) {
      const job = jobs.get(id);
      if (!job) throw new Error(`job ${id} is not held by this server process`);
      merge(job, extra);
      persist();
      return view(job);
    },
    get(id) {
      const lim = limits();
      prune(lim);
      const job = jobs.get(id);
      if (job) return view(job);
      const m = ID_RE.exec(String(id));
      if (m && m[1] === prefix) {
        if (Number(m[2]) >= 1 && Number(m[2]) <= issued) {
          throw new Error(`job ${id} has expired from retention (finished jobs are kept for ${lim.retainMs} ms, at most ${lim.maxRetained} of them)`);
        }
      } else if (m && store) return stored(id, m[1], Number(m[2]), lim);
      throw new Error(`job ${JSON.stringify(String(id)).slice(0, 80)} was never issued by this server process${store ? '' : ' (jobs are held in memory; a restarted server does not know earlier ids)'}`);
    },
    /** Interrupts every queued job and kills every running one; returns how many were running. */
    shutdown(reason = 'server shutting down') {
      closed = reason;
      const t = now();
      for (const job of waiting.splice(0)) {
        job.state = 'interrupted'; job.interruptedAt = t; job.reason = `interrupted before it started: ${reason}; not re-run`;
      }
      for (const id of live.keys()) jobs.get(id).interruptedBy = reason;
      persist();
      const n = live.size;
      for (const kill of live.values()) { try { kill(); } catch { /* already gone */ } }
      return n;
    },
    running: () => live.size,
    prefix: () => prefix,
  };
}
