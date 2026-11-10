// The I/O shell around decide: gather one snapshot through the GitHub client, then decide. The
// actions are returned, not executed. A failed read lands in the snapshot as { error } and decide
// treats it as unmeasured; anything but a GithubError is a defect and propagates.
//   env, read at call time: CW_NOW (pins now for a deterministic tick)
import { nowISO } from '../lib/clock.mjs';
import { isAddressed } from './admission.mjs';
import { decide } from './decide.mjs';
import { GithubError } from './github.mjs';
import { visibilityOf } from './repo-gate.mjs';
import { actionKey, actionLocalDirs, localActionDirs, workflowKey, workflowPath } from './workflow-facts.mjs';

// in_progress as well: a job released by `needs:` queues inside a run that is already in progress.
export const RUN_STATUSES = Object.freeze(['queued', 'in_progress']);
const MAX_ACTION_DEPTH = 4;

async function settle(promise) {
  try {
    return await promise;
  } catch (e) {
    if (!(e instanceof GithubError)) throw e;
    return { error: { status: e.status, reason: e.reason } };
  }
}

async function gatherRuns(gh, repo) {
  const runs = new Map();
  for (const status of RUN_STATUSES) {
    const listed = await settle(gh.runs(repo, status));
    if (!Array.isArray(listed)) return listed;
    for (const run of listed) if (!runs.has(run.id)) runs.set(run.id, run);
  }
  const out = [];
  for (const run of runs.values()) out.push({ run, jobs: await settle(gh.runJobs(repo, run.id)) });
  return out;
}

async function fetchAction(gh, repo, dir, sha) {
  const yml = await settle(gh.fileAt(repo, `${dir}/action.yml`, sha));
  return yml?.error?.status === 404 ? settle(gh.fileAt(repo, `${dir}/action.yaml`, sha)) : yml;
}

async function gatherActions(gh, repo, sha, dirs, out, depth) {
  for (const dir of dirs) {
    const key = actionKey(dir, sha);
    if (key in out) continue;
    out[key] = await fetchAction(gh, repo, dir, sha);
    if (typeof out[key] === 'string' && depth < MAX_ACTION_DEPTH) {
      await gatherActions(gh, repo, sha, actionLocalDirs(out[key]), out, depth + 1);
    }
  }
}

// Only runs holding a queued job addressed to this runner cost a workflow read.
async function gatherTexts(gh, repo, queuedRuns) {
  const workflowTexts = {};
  const actionTexts = {};
  for (const { run, jobs } of Array.isArray(queuedRuns) ? queuedRuns : []) {
    if (!Array.isArray(jobs) || !jobs.some((j) => j.status === 'queued' && isAddressed(j))) continue;
    const path = workflowPath(run);
    const key = workflowKey(run);
    if (!path || key in workflowTexts) continue;
    workflowTexts[key] = await settle(gh.fileAt(repo, path, run.head_sha));
    if (typeof workflowTexts[key] === 'string') {
      await gatherActions(gh, repo, run.head_sha, localActionDirs(workflowTexts[key]), actionTexts, 0);
    }
  }
  return { workflowTexts, actionTexts };
}

/** One repo's snapshot. The fork-PR policy is read only for a public repo, the only one it gates. */
export async function gatherRepo(gh, repo) {
  const meta = await settle(gh.repoMeta(repo));
  const policy = visibilityOf(meta) === 'public' ? await settle(gh.forkApproval(repo)) : null;
  const queuedRuns = await gatherRuns(gh, repo);
  const runners = await settle(gh.runners(repo));
  const { workflowTexts, actionTexts } = await gatherTexts(gh, repo, queuedRuns);
  return { meta, policy, queuedRuns, workflowTexts, actionTexts, runners };
}

/** Every declared repo's snapshot, keyed by repo. */
export async function gather(gh, config) {
  const snapshot = {};
  for (const { repo } of config.repos) snapshot[repo] = await gatherRepo(gh, repo);
  return snapshot;
}

/** One tick: { snapshot, actions }. Nothing is executed. */
export async function poll({ gh, config, freeSlots = [], now = Date.parse(nowISO()) }) {
  const snapshot = await gather(gh, config);
  return { snapshot, actions: decide({ config, snapshot, freeSlots, now }) };
}
