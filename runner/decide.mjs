// One dispatcher tick, pure: config, a snapshot per declared repo, free slot ids and now → an
// ordered action list. Records come first, then cancels, deletes and mints. GitHub hands a runner
// any queued job its labels match, so refused runs are cancelled before a new runner exists.
//   snapshot[repo] = { meta, policy, queuedRuns: [{ run, jobs }], workflowTexts, actionTexts, runners }
//   a failed read anywhere in it is { error: { status, reason } }
import { admit, isAddressed } from './admission.mjs';
import { outcomeOf } from './codes.mjs';
import { repoGate } from './repo-gate.mjs';
import { classifyRunners, runnerName } from './reconcile.mjs';
import { workflowKey } from './workflow-facts.mjs';

const time = (iso) => Date.parse(iso) || 0;
const byAge = (a, b) => time(a.at) - time(b.at) || a.jobId - b.jobId;
const byRunAge = (a, b) => time(a.run.created_at) - time(b.run.created_at) || a.run.id - b.run.id;
const errorText = (x) => (x && x.error ? `${x.error.status} ${x.error.reason}` : 'not in the snapshot');
const note = (repo, runId, jobId, v) => ({ repo, runId, jobId, admit: v.admit, code: v.code, reason: v.reason });
const wait = (code, reason) => ({ admit: false, code, reason });

/** Runs holding a queued job addressed to this runner, oldest first, carrying only those jobs. */
function addressedRuns(repo, queuedRuns, out) {
  const runs = new Map();
  for (const { run, jobs } of queuedRuns) {
    if (!run || runs.has(run.id)) continue;
    if (!Array.isArray(jobs)) { out.records.push(note(repo, run.id, null, wait('jobs-unmeasured', `jobs unreadable: ${errorText(jobs)}`))); continue; }
    const addressed = jobs.filter((j) => j.status === 'queued' && isAddressed(j));
    if (addressed.length) runs.set(run.id, { run, jobs: addressed });
  }
  return [...runs.values()].sort(byRunAge);
}

function refuseRepo(repo, runs, gate, out) {
  out.records.push(note(repo, null, null, { admit: false, code: gate.code, reason: gate.reason }));
  if (outcomeOf(gate.code) !== 'refuse') return;
  for (const { run } of runs) out.cancels.push({ kind: 'cancel', repo, runId: run.id, code: gate.code });
}

/** Admit each job of one run. One refusal cancels the run, so none of its jobs is minted. */
function decideRun(repo, { run, jobs }, s, config, out) {
  const text = s.workflowTexts?.[workflowKey(run)];
  const verdicts = jobs.map((job) => ({ job, v: admit(run, job, text, config, s.actionTexts) }))
    .filter(({ v }) => outcomeOf(v.code) !== 'skip');
  const refused = verdicts.find(({ v }) => outcomeOf(v.code) === 'refuse');
  const admitted = [];
  for (const { job, v } of verdicts) {
    if (refused && v.admit) {
      out.records.push(note(repo, run.id, job.id, { admit: false, code: 'run-refused', reason: `job ${refused.job.id} in this run was refused: ${refused.v.code}` }));
    } else if (v.admit) {
      admitted.push({ repo, runId: run.id, jobId: job.id, at: job.created_at || run.created_at, decision: note(repo, run.id, job.id, v) });
    } else out.records.push(note(repo, run.id, job.id, v));
  }
  if (refused) out.cancels.push({ kind: 'cancel', repo, runId: run.id, code: refused.v.code });
  return admitted;
}

function decideRepo(entry, s, config, now, out) {
  const { repo } = entry;
  const runners = classifyRunners(s.runners, { now, staleRunnerSec: config.staleRunnerSec });
  for (const r of runners.stale) out.deletes.push({ kind: 'delete', repo, runnerId: r.id, name: r.name });
  if (!Array.isArray(s.queuedRuns)) {
    out.records.push(note(repo, null, null, wait('runs-unmeasured', `runs unreadable: ${errorText(s.queuedRuns)}`)));
    return;
  }
  const runs = addressedRuns(repo, s.queuedRuns, out);
  if (!runs.length) return;
  const gate = repoGate(s.meta, s.policy);
  if (!gate.served) { refuseRepo(repo, runs, gate, out); return; }
  const admitted = runs.flatMap((r) => decideRun(repo, r, s, config, out)).sort(byAge);
  // Without the runner list, minted-but-unclaimed runners are unknown and a mint could double one.
  if (!Array.isArray(s.runners)) {
    for (const c of admitted) out.records.push({ ...c.decision, code: 'runners-unmeasured', reason: `runners unreadable: ${errorText(s.runners)}` });
    return;
  }
  for (const c of admitted.splice(0, runners.pending.length)) {
    out.records.push({ ...c.decision, code: 'runner-pending', reason: 'an idle runner minted earlier will take this job' });
  }
  out.candidates.push(...admitted.map((c) => ({ ...c, labels: entry.labels, actors: entry.actors })));
}

/** Oldest admitted job first, one per free slot; the rest wait. */
function assign(candidates, slots, now, records) {
  return candidates.sort(byAge).flatMap((c, i) => {
    if (i >= slots.length) {
      records.push({ ...c.decision, code: 'capacity-wait', reason: `no free slot: ${slots.length} free for ${candidates.length} admitted job(s)` });
      return [];
    }
    records.push(c.decision);
    const slotId = slots[i];
    return [{ kind: 'mint', repo: c.repo, runId: c.runId, jobId: c.jobId, slotId, name: runnerName(slotId, c.jobId, now), labels: [...c.labels], actors: [...(c.actors || [])] }];
  });
}

/** ({ config, snapshot, freeSlots, now }) → [record…, cancel…, delete…, mint…]. now is epoch milliseconds. */
export function decide({ config, snapshot = {}, freeSlots = [], now }) {
  if (!Number.isFinite(now)) throw new TypeError('decide needs now as epoch milliseconds');
  const out = { records: [], cancels: [], deletes: [], candidates: [] };
  for (const entry of config.repos) decideRepo(entry, snapshot[entry.repo] || {}, config, now, out);
  const free = new Set(freeSlots);
  const slots = config.slots.map((s) => s.id).filter((id) => free.has(id));
  const mints = assign(out.candidates, slots, now, out.records);
  return [...out.records.map((decision) => ({ kind: 'record', decision })), ...out.cancels, ...out.deletes, ...mints];
}
