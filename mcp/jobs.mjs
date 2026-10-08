// mcp/jobs.mjs — the bounded job queue behind run_checks_start / run_checks_result.
//
// In memory, per server process: an MCP stdio server lives as long as its client, and a job id a
// restarted server cannot resolve is reported as never issued by this process, not as absent work.
// Every bound refuses rather than drops: a full queue throws at submit, and a finished job leaves
// retention only after it was retained for the configured count or time.

import { randomBytes } from 'node:crypto';

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

export const JOB_STATES = Object.freeze(['queued', 'running', 'done', 'failed']);

/**
 * @param {object} o
 * @param {(payload: any) => {done: Promise<{state: 'done'|'failed', result?: any, reason?: string, extra?: object}>, kill: () => void}} o.start
 * @param {() => number} [o.now]
 * @param {() => ReturnType<typeof jobLimits>} [o.limits]
 * @param {string} [o.prefix] per-process id prefix; ids from another process never resolve here
 */
export function createJobQueue({ start, now = Date.now, limits = () => jobLimits(), prefix = randomBytes(4).toString('hex') }) {
  const jobs = new Map();           // insertion order = submission order
  const waiting = [];
  const live = new Map();           // id -> kill
  let issued = 0;
  let closed = null;
  const iso = (t) => (t == null ? null : new Date(t).toISOString());

  function prune(lim) {
    const t = now();
    const finished = [...jobs.values()].filter((j) => j.finishedAt != null);
    for (const j of finished) if (t - j.finishedAt > lim.retainMs) jobs.delete(j.id);
    const left = finished.filter((j) => jobs.has(j.id));
    for (let i = 0; i < left.length - lim.maxRetained; i++) jobs.delete(left[i].id);
  }

  function finish(job, out) {
    live.delete(job.id);
    job.state = out.state === 'done' ? 'done' : 'failed';
    job.finishedAt = now();
    if (out.result !== undefined) job.result = out.result;
    if (out.reason) job.reason = out.reason;
    for (const [k, v] of Object.entries(out.extra || {})) {
      const prev = job.extra[k];
      job.extra[k] = isRecord(prev) && isRecord(v) ? { ...prev, ...v } : v;
    }
    if (job.state === 'failed' && !job.reason) job.reason = 'the runner reported failure without a reason';
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
      let h;
      try { h = start(job.payload); } catch (e) { finish(job, { state: 'failed', reason: `did not start: ${e.message}` }); continue; }
      live.set(job.id, h.kill);
      h.done.then((out) => finish(job, out || {}), (e) => finish(job, { state: 'failed', reason: e?.message || String(e) }));
    }
  }

  function view(job) {
    const v = { jobId: job.id, state: job.state, request: job.request,
      submittedAt: iso(job.submittedAt), startedAt: iso(job.startedAt), finishedAt: iso(job.finishedAt) };
    if (job.state === 'queued') v.queuePosition = waiting.indexOf(job) + 1;
    if (job.reason) v.reason = job.reason;
    if (job.result !== undefined) v.result = job.result;
    return { ...v, ...job.extra };
  }

  return {
    /** Refuses (throws) when the queue is full or the server is closing; never drops. */
    submit(payload, { request = null, extra = {} } = {}) {
      if (closed) throw new Error(`job refused: the server is shutting down (${closed})`);
      const lim = limits();
      prune(lim);
      const freeSlot = live.size < lim.concurrency && waiting.length === 0;
      if (!freeSlot && waiting.length >= lim.maxQueued) {
        throw new Error(`job refused: queue full (${live.size} running of ${lim.concurrency}, ${waiting.length} queued of ${lim.maxQueued}); collect or wait for a running job, then submit again`);
      }
      const job = { id: `job-${prefix}-${++issued}`, state: 'queued', payload, request, extra: { ...extra },
        submittedAt: now(), startedAt: null, finishedAt: null };
      jobs.set(job.id, job);
      waiting.push(job);
      pump();
      return { ...view(job), limits: lim };
    },
    get(id) {
      const lim = limits();
      prune(lim);
      const job = jobs.get(id);
      if (job) return view(job);
      const m = new RegExp(`^job-${prefix}-(\\d+)$`).exec(String(id));
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= issued) {
        throw new Error(`job ${id} has expired from retention (finished jobs are kept for ${lim.retainMs} ms, at most ${lim.maxRetained} of them)`);
      }
      throw new Error(`job ${JSON.stringify(String(id)).slice(0, 80)} was never issued by this server process (jobs are held in memory; a restarted server does not know earlier ids)`);
    },
    /** Fails every queued job and kills every running one; returns how many were running. */
    shutdown(reason = 'server shutting down') {
      closed = reason;
      for (const job of waiting.splice(0)) {
        job.state = 'failed'; job.finishedAt = now(); job.reason = `not started: ${reason}`;
      }
      const n = live.size;
      for (const kill of live.values()) { try { kill(); } catch { /* already gone */ } }
      return n;
    },
    running: () => live.size,
  };
}
