// The dispatcher's ledger: admission decisions, minted runners and finished jobs, on node:sqlite in
// WAL mode. One connection per process per path; a second open shares it and its options.
// A decision repeated tick after tick for the same subject is one row with a count.
//   env, read at call time: CW_RUNNER_LEDGER (else <private dir>/runner-ledger.db), CW_NOW
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowISO } from '../lib/clock.mjs';
import { privateDir } from '../monitor/store-paths.mjs';
import { outcomeOf } from './codes.mjs';
import { LedgerError, migrate } from './ledger-schema.mjs';
import { decisionRow, jobRow, runnerRow, SQL } from './ledger-sql.mjs';

export { LedgerError };
export const LEDGER_DEFAULTS = Object.freeze({ retainDays: 30, maxRows: 100_000, pruneEvery: 200 });
const OWN_TREE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPEN = new Map();

/** The ledger path: CW_RUNNER_LEDGER, else runner-ledger.db in the private dir. */
export const ledgerPath = (root = OWN_TREE) =>
  (process.env.CW_RUNNER_LEDGER ? resolve(process.env.CW_RUNNER_LEDGER) : join(privateDir(root), 'runner-ledger.db'));

const fail = (message) => { throw new LedgerError('ledger-input', message); };
const str = (v) => (typeof v === 'string' && v ? v : null);
const real = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isSafeInteger(v) ? v : null);
const limitOf = (n, fallback) => (Number.isSafeInteger(n) && n > 0 ? Math.min(n, 10_000) : fallback);

/** Epoch ms from a number, an ISO string, or now when absent. */
function msOf(at, now) {
  if (at === undefined || at === null) return now();
  const ms = typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(ms) ? Math.trunc(ms) : fail(`not a time: ${JSON.stringify(at)}`);
}

function connect(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    migrate(db);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

function prepareAll(db) {
  return Object.fromEntries(Object.entries(SQL).map(([k, sql]) => [k, db.prepare(sql)]));
}

function writers(q, now, wrote) {
  return {
    recordDecision(d) {
      const x = d && d.kind === 'record' ? d.decision : d;
      if (!x || typeof x.code !== 'string') fail('a decision needs a code');
      const at = msOf(x.at, now);
      const subject = [str(x.repo), int(x.runId), int(x.jobId)];
      const last = q.lastFor.get(...subject);
      if (last && last.code === x.code && last.reason === str(x.reason)) {
        q.touch.run(at, last.id);
        return { id: last.id, repeated: true };
      }
      const r = q.insertDecision.run(at, at, ...subject, x.admit ? 1 : 0, x.code, outcomeOf(x.code), str(x.reason));
      wrote();
      return { id: Number(r.lastInsertRowid), repeated: false };
    },
    runnerMinted({ name, repo, runId, jobId, slotId, runnerId, at } = {}) {
      if (!str(name) || !str(repo) || !str(slotId)) fail('a minted runner needs name, repo and slotId');
      const r = q.insertRunner.run(name, repo, int(runId), int(jobId), slotId, int(runnerId), msOf(at, now));
      wrote();
      return r.changes > 0;
    },
    /** True only for the first claim of a runner by the slot it was minted for. */
    runnerClaimed(name, slotId, at) {
      return q.claim.run(msOf(at, now), String(name), String(slotId)).changes > 0;
    },
    /** The supervisor's report plus runnerName, repo, jobId. A repeated report is not counted twice. */
    jobFinished(report) {
      if (!report || typeof report !== 'object') fail('a job report must be an object');
      const at = msOf(report.at, now);
      const t = report.totals || {};
      const lo = report.leftovers || {};
      const r = q.insertJob.run(at, str(report.runnerName), str(report.repo), int(report.jobId), str(report.slotId),
        int(report.code), str(report.signal), real(report.wallSec), real(t.cpuSec), int(t.memPeakBytes),
        int(t.io?.rbytes), int(t.io?.wbytes), int(lo.killed), int(lo.left));
      if (str(report.runnerName)) q.finish.run(at, report.runnerName);
      wrote();
      return r.changes > 0;
    },
  };
}

function readers(q, now) {
  return {
    decisions: ({ since, limit } = {}) => q.decisions.all(since === undefined ? 0 : msOf(since, now), limitOf(limit, 100)).map(decisionRow),
    jobs: ({ since, limit } = {}) => q.jobs.all(since === undefined ? 0 : msOf(since, now), limitOf(limit, 100)).map(jobRow),
    runners: ({ open = false, limit } = {}) => (open ? q.openRunners : q.allRunners).all(limitOf(limit, 500)).map(runnerRow),
  };
}

function pruner(q, opts, now) {
  return () => {
    const cutoff = now() - opts.retainDays * 86_400_000;
    let removed = 0;
    for (const t of ['Decisions', 'Jobs', 'Runners']) {
      removed += Number(q[`old${t}`].run(cutoff).changes);
      removed += Number(q[`over${t}`].run(opts.maxRows).changes);
    }
    return removed;
  };
}

function build(db, opts, release) {
  const q = prepareAll(db);
  const now = opts.now || (() => Date.parse(nowISO()));
  const prune = pruner(q, opts, now);
  let writes = 0;
  const wrote = () => { if (++writes % opts.pruneEvery === 0) prune(); };
  prune();
  return {
    ...writers(q, now, wrote),
    ...readers(q, now),
    prune,
    check() {
      try { db.prepare('SELECT 1').get(); return { status: 'live', reason: null }; } catch (e) { return { status: 'unreadable', reason: e.message }; }
    },
    close: release,
  };
}

/** Open (or share) the ledger at `path`. Options: retainDays, maxRows, pruneEvery, now() → epoch ms. */
export function openLedger(path = ledgerPath(), opts = {}) {
  const key = resolve(path);
  const held = OPEN.get(key);
  if (held) { held.refs++; return held.handle; }
  const db = connect(key);
  const entry = { refs: 1, handle: null };
  const release = () => {
    if (entry.refs <= 0 || --entry.refs > 0) return;
    OPEN.delete(key);
    db.close();
  };
  entry.handle = build(db, { ...LEDGER_DEFAULTS, ...opts }, release);
  OPEN.set(key, entry);
  return entry.handle;
}
