// The ledger's statements and row shapes. Rows leave as camelCase with ISO times; null stays null.

const keep = (table, order) =>
  `DELETE FROM ${table} WHERE rowid <= (SELECT rowid FROM ${table} ORDER BY ${order} LIMIT 1 OFFSET ?)`;

export const SQL = Object.freeze({
  lastFor: 'SELECT id, code, reason FROM decisions WHERE repo IS ? AND run_id IS ? AND job_id IS ? ORDER BY id DESC LIMIT 1',
  touch: 'UPDATE decisions SET last_ms = max(last_ms, ?), seen = seen + 1 WHERE id = ?',
  insertDecision: `INSERT INTO decisions (first_ms, last_ms, repo, run_id, job_id, admit, code, outcome, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  insertRunner: `INSERT INTO runners (name, repo, run_id, job_id, slot_id, runner_id, minted_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING`,
  claim: 'UPDATE runners SET claimed_ms = ? WHERE name = ? AND slot_id = ? AND claimed_ms IS NULL',
  insertJob: `INSERT INTO jobs (at_ms, runner_name, repo, job_id, slot_id, exit_code, signal, wall_sec, cpu_sec,
    mem_peak_bytes, io_rbytes, io_wbytes, killed, left_running)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(runner_name) DO NOTHING`,
  finish: 'UPDATE runners SET finished_ms = ? WHERE name = ? AND finished_ms IS NULL',
  decisions: 'SELECT * FROM decisions WHERE last_ms >= ? ORDER BY last_ms DESC, id DESC LIMIT ?',
  jobs: `SELECT j.*, r.run_id, r.minted_ms, r.claimed_ms FROM jobs j LEFT JOIN runners r ON r.name = j.runner_name
    WHERE j.at_ms >= ? ORDER BY j.at_ms DESC, j.id DESC LIMIT ?`,
  openRunners: 'SELECT * FROM runners WHERE finished_ms IS NULL ORDER BY minted_ms DESC LIMIT ?',
  allRunners: 'SELECT * FROM runners ORDER BY minted_ms DESC LIMIT ?',
  oldDecisions: 'DELETE FROM decisions WHERE last_ms < ?',
  overDecisions: keep('decisions', 'rowid DESC'),
  oldJobs: 'DELETE FROM jobs WHERE at_ms < ?',
  overJobs: keep('jobs', 'rowid DESC'),
  oldRunners: 'DELETE FROM runners WHERE minted_ms < ?',
  overRunners: keep('runners', 'rowid DESC'),
});

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(Number(ms)).toISOString());

export const decisionRow = (r) => ({
  id: r.id, at: iso(r.first_ms), lastAt: iso(r.last_ms), seen: r.seen,
  repo: r.repo, runId: r.run_id, jobId: r.job_id,
  admit: r.admit === 1, code: r.code, outcome: r.outcome, reason: r.reason,
});

export const runnerRow = (r) => ({
  name: r.name, repo: r.repo, runId: r.run_id, jobId: r.job_id, slotId: r.slot_id, runnerId: r.runner_id,
  mintedAt: iso(r.minted_ms), claimedAt: iso(r.claimed_ms), finishedAt: iso(r.finished_ms),
});

export const jobRow = (r) => ({
  id: r.id, at: iso(r.at_ms), runnerName: r.runner_name, repo: r.repo, runId: r.run_id ?? null, jobId: r.job_id,
  slotId: r.slot_id, exitCode: r.exit_code, signal: r.signal, wallSec: r.wall_sec, cpuSec: r.cpu_sec,
  memPeakBytes: r.mem_peak_bytes, io: { rbytes: r.io_rbytes, wbytes: r.io_wbytes },
  leftovers: { killed: r.killed, left: r.left_running },
  mintedAt: iso(r.minted_ms), claimedAt: iso(r.claimed_ms),
});
