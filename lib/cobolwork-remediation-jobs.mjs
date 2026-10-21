// lib/cobolwork-remediation-jobs.mjs — job records for cobolwork remediation: the policy check, the
// run, apply and verify, each written atomically to one file per finding. Shared by the panel route
// and bin/cobolwork-remediate.mjs.

import { mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { loadPolicy } from '../monitor/remediation-policy.mjs';
import { idemKeyFor, OUTCOMES } from '../monitor/remediation-outcome.mjs';
import { unknown } from '../monitor/unknown.mjs';
import { appendFindingAdjudication, findingKeyForScanner } from '../bin/lib/verdict-journal-core.mjs';
import { remediate, applyLodged, verifyApplied, jobIdFor, refFor, git } from './cobolwork-remediation.mjs';

export const JOB_SCHEMA = 'commitwork/cobolwork-remediation-job.v1';
const EVENT_CAP = 120;
const iso = () => process.env.CW_NOW || new Date().toISOString();

// Drafting is remediation, so the org's `report` mode refuses it; applying is a person's act in every mode.
export function draftingAllowed() {
  const policy = loadPolicy();
  if (policy.mode === 'report') {
    return { ok: false, error: `the remediation policy is in report mode (${policy.source}), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies` };
  }
  return { ok: true, policy };
}

export function writeJob(dir, job) {
  job.updatedAt = iso();
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, `${job.id}.json`), JSON.stringify(job, null, 2) + '\n');
}

// -> { job } | { missing: true } | { unreadable: message }; a file that will not parse is not an absent job.
export function readJob(dir, id) {
  let raw;
  try { raw = readFileSync(join(dir, `${id}.json`), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { missing: true }; return { unreadable: e.message }; }
  try { return { job: JSON.parse(raw) }; } catch (e) { return { unreadable: `job file does not parse: ${e.message}` }; }
}

export function listJobs(dir, active = new Set()) {
  let names;
  try { names = readdirSync(dir).filter((n) => /^[a-f0-9]{16}\.json$/.test(n)); }
  catch (e) { if (e.code === 'ENOENT') return { ok: true, jobs: [] }; return { ok: false, error: `job store unreadable: ${e.message}`, jobs: [] }; }
  const jobs = names.sort().map((n) => {
    const id = n.slice(0, 16);
    const r = readJob(dir, id);
    if (!r.job) return { id, state: 'unreadable', error: r.unreadable || 'missing' };
    const j = r.job;
    // A job the file says is running, with no pipeline in this process, was cut off by a restart.
    const state = j.state === 'running' && !active.has(id) ? 'orphaned' : j.state;
    return { id, state, repo: j.repo, fingerprint: j.fingerprint, updatedAt: j.updatedAt,
      finding: j.finding ? { rule: j.finding.rule, sev: j.finding.sev, path: j.finding.path, line: j.finding.line } : null,
      final: j.final ? { verdict: j.final.verdict, outcome: j.final.outcome, attempt: j.final.attempt, files: j.final.files } : null,
      attempts: (j.attempts || []).length, applied: j.applied || null, verified: (j.verifications || []).slice(-1)[0] || null,
      error: j.error || null, events: (j.events || []).slice(-14) };
  });
  jobs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { ok: true, jobs };
}

export function newJob({ repo, fingerprint, maxAttempts = 3, engines, remote = false, project = null }) {
  return { schema: JOB_SCHEMA, id: jobIdFor(repo, fingerprint), repo, project, fingerprint, maxAttempts, remote: !!remote,
    sourceLeavesMachine: !!remote, engines, createdAt: iso(), state: 'queued', events: [], attempts: [], final: null,
    review: null, applied: null, verifications: [], error: null };
}

function logEvent(job, msg) {
  job.events.push({ at: iso(), msg: String(msg).slice(0, 400) });
  if (job.events.length > EVENT_CAP) job.events = [{ at: job.events[0].at, msg: `(${job.events.length - EVENT_CAP + 1} earlier events dropped)` }, ...job.events.slice(-(EVENT_CAP - 1))];
}

export async function runJob(dir, job, { repoPath, drafter, reviewer = null, bridge, signal = null }) {
  job.state = 'running'; job.error = null; logEvent(job, 'drafting started'); writeJob(dir, job);
  const onEvent = (m, attempts) => { logEvent(job, m); if (attempts) job.attempts = attempts; writeJob(dir, job); };
  let r;
  try {
    r = await remediate({ repoPath, fingerprint: job.fingerprint, jobId: job.id, drafter, reviewer, maxAttempts: job.maxAttempts, signal, onEvent,
      ...(bridge ? { bridge } : {}) });
  } catch (e) { r = { state: 'failed', error: e.message, attempts: [] }; }
  Object.assign(job, { state: r.state, baseSha: r.baseSha || null, finding: r.finding || job.finding || null, attempts: r.attempts || [],
    final: r.final || null, review: r.review || null, error: r.error || null, ...(r.state === 'lodged' ? { lodgedAt: iso() } : {}) });
  // Beside the job's own words, the shared unknown fields, so a count of what nobody could decide finds these.
  if (r.state === 'unscanned') Object.assign(job, unknown('not-run', r.error));
  if (job.final && job.final.verdict === 'undecided') Object.assign(job.final, unknown('not-adjudicated', `the gate left the draft undecided (${job.final.outcome})`));
  logEvent(job, r.state === 'lodged' ? `lodged: gate ${r.final.verdict} (${r.final.outcome}) on attempt ${r.final.attempt}` : `${r.state}: ${r.error || ''}`);
  writeJob(dir, job);
  return job;
}

export async function applyJob(dir, job, { repoPath, acknowledgeUndecided = false }) {
  if (job.state === 'applied') return { ok: false, conflict: true, error: `already applied as ${job.applied && job.applied.commit}` };
  if (job.state !== 'lodged') return { ok: false, conflict: true, error: `the job is ${job.state}; only a lodged draft is applied` };
  const r = await applyLodged({ repoPath, job, acknowledgeUndecided });
  if (!r.ok) { logEvent(job, `apply refused: ${r.error}`); writeJob(dir, job); return r; }
  job.state = 'applied';
  job.applied = { at: iso(), commit: r.commit, files: r.files, acknowledgedUndecided: job.final.verdict === 'undecided' };
  logEvent(job, `applied as ${r.commit.slice(0, 12)} (${r.files.join(', ')})`);
  writeJob(dir, job);
  return { ok: true, commit: r.commit, files: r.files };
}

// Checks HEAD with the gate's --target-only, and records an outcome only where the gate decided one.
export async function verifyJob(dir, job, { repoPath, bridge, verdictDir = undefined, artifact = null, signal = null }) {
  if (job.state !== 'applied') return { ok: false, conflict: true, error: `the job is ${job.state}; only an applied draft is verified` };
  const v = await verifyApplied({ repoPath, job, signal, ...(bridge ? { bridge } : {}) });
  if (!v.ok) { logEvent(job, `verify did not run: ${v.error}`); writeJob(dir, job); return v; }
  const record = { at: iso(), head: v.at, verdict: v.verdict, gateOutcome: v.gateOutcome, outcome: v.outcome, reasons: v.reasons.slice(0, 20) };
  if (v.outcome && OUTCOMES.includes(v.outcome)) {
    const findingKey = findingKeyForScanner('sastCobol', job.repo, { fingerprint: job.fingerprint });
    const claimRef = `cobolwork-remediation:${job.id}@${job.applied.commit}`;
    const res = appendFindingAdjudication({
      findingKey, category: 'sastCobol', repo: job.repo,
      machineVerdict: null, humanVerdict: 'remediated', truth: null,
      outcome: v.outcome, claimSource: 'cobolwork-remediation', claimRef, sliceId: v.at,
      outcomeKey: idemKeyFor({ claimRef, findingKey, sliceId: v.at }), bornSlice: null,
      basis: v.outcome === 'verified-fixed' ? 'cobolwork gate --target-only: the finding is gone at HEAD for a reason the engine states, with coverage complete'
        : 'cobolwork gate --target-only: the finding is still reported at HEAD',
      evidence: null, model: null, promptId: null,
    }, { dir: verdictDir, place: `sastCobol:${job.repo}`, artifact });
    record.recorded = res.ok ? true : `not recorded: ${res.error}`;
  } else Object.assign(record, { recorded: 'no outcome: the gate did not decide one' }, unknown('not-adjudicated', `the gate returned ${v.verdict} (${v.gateOutcome})`));
  job.verifications.push(record);
  logEvent(job, `verify at ${v.at.slice(0, 12)}: gate ${v.verdict} (${v.gateOutcome})${v.outcome ? `, ${v.outcome}` : ''}`);
  writeJob(dir, job);
  return { ok: true, ...record };
}

// Removes a finished job and the draft ref it kept.
export async function clearJob(dir, job, { repoPath = null } = {}) {
  if (repoPath && job.final && job.final.ref === refFor(job.id)) await git(repoPath, ['update-ref', '-d', refFor(job.id)]);
  try { unlinkSync(join(dir, `${job.id}.json`)); return { ok: true }; }
  catch (e) { return e.code === 'ENOENT' ? { ok: true } : { ok: false, error: e.message }; }
}
