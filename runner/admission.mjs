// Admission for one queued job, pure: labels, then the event, then the workflow at the run's head
// sha. Codes and outcomes are in codes.mjs. Docker needs are read statically (container:,
// services:, docker:// steps, local actions whose action.yml is visible); a remote docker action
// is not seen and fails at runtime on a docker-less slot, which costs a job, not isolation.
import { outcomeOf } from './codes.mjs';
import { actorsFor, labelsFor } from './config.mjs';
import { actionKey, jobBlockers, jobCandidates, readWorkflow, workflowPath } from './workflow-facts.mjs';

// Both run with the base repository's secrets and a write token.
export const PRIVILEGED_EVENTS = Object.freeze(['pull_request_target', 'workflow_run']);
const NO_DOCKER = 'needs docker; slots have none';

const lower = (s) => String(s).toLowerCase();
const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && lower(a) === lower(b);
const jobLabels = (job) => (Array.isArray(job?.labels) ? job.labels.map(lower) : []);

/** True when a job's runs-on names this runner. */
export const isAddressed = (job) => jobLabels(job).includes('commitwork');

const verdict = (code, reason) => ({ admit: outcomeOf(code) === 'admit', code, reason });

const BLOCKER_REASONS = {
  'needs-container': () => `${NO_DOCKER} (container:)`,
  'needs-services': () => `${NO_DOCKER} (services:)`,
  'needs-docker-action': (d) => `${NO_DOCKER} (${d}); only statically visible docker actions are refused`,
  'local-action-unseen': (d) => `local action ${d}: its action.yml is not visible at the head sha, so its docker needs are unknown`,
  'reusable-workflow': (d) => `calls ${d}; the called workflow is not inspected`,
  'workflow-unmeasured': (d) => `local action unreadable (${d}); decided again next tick`,
};

export function eventVerdict(run, repo) {
  if (PRIVILEGED_EVENTS.includes(run.event)) {
    return verdict('event-privileged', `${run.event} runs with the base repository's secrets and write token`);
  }
  // Every event, not only pull_request: a head outside the repo is fork code whatever triggered it.
  const head = run.head_repository?.full_name;
  if (!sameRepo(head, repo)) return verdict('head-foreign', `head repository ${head || 'unknown'} is not ${repo}`);
  return null;
}

/** Both the actor and whoever re-ran it must be declared: a re-run executes the original's code. */
export function actorVerdict(run, actors) {
  const who = [run?.actor?.login, run?.triggering_actor?.login].filter((x) => typeof x === 'string').map(lower);
  if (!who.length) return verdict('actor-unknown', 'the run names no actor');
  const outside = [...new Set(who.filter((a) => !(actors || []).includes(a)))];
  return outside.length ? verdict('actor-foreign', `run by ${outside.join(', ')}, outside [${(actors || []).join(', ')}]`) : null;
}

function labelVerdict(job, allowed) {
  const outside = jobLabels(job).filter((l) => !allowed.includes(l));
  if (!outside.length) return null;
  return verdict('labels-outside-set', `runs-on label(s) ${outside.join(', ')} are outside [${allowed.join(', ')}]`);
}

function workflowVerdict(run, job, text, actionTexts) {
  const path = workflowPath(run);
  const at = `${path || run.path} at ${run.head_sha}`;
  if (!path) return verdict('workflow-unseen', `${run.path || 'the run'} is not a file under .github/workflows`);
  if (text && typeof text === 'object' && text.error) {
    if (text.error.status === 404) return verdict('workflow-unseen', `${at}: not found`);
    return verdict('workflow-unmeasured', `${at}: ${text.error.status} ${text.error.reason}; decided again next tick`);
  }
  if (typeof text !== 'string') return verdict('workflow-unmeasured', `${at}: not fetched; decided again next tick`);
  const read = readWorkflow(text);
  if (read.error) return verdict('workflow-unreadable', `${at}: ${read.error}`);
  const candidates = jobCandidates(read.model, job.name);
  if (!candidates.length) return verdict('job-unmapped', `job ${JSON.stringify(job.name)} matches no job in ${path}`);
  const look = (dir) => actionTexts?.[actionKey(dir, run.head_sha)];
  const blockers = candidates.flatMap((c) => jobBlockers(c, look));
  // A definite refusal outranks an unreadable action: it cancels now rather than waiting a tick.
  const first = blockers.find((b) => outcomeOf(b.code) === 'refuse') || blockers[0];
  return first ? verdict(first.code, BLOCKER_REASONS[first.code](first.detail)) : null;
}

/**
 * (run, job, workflow text, config, action texts) → { admit, code, reason }.
 * The text is a string, { error: { status, reason } } when the fetch failed, or undefined.
 * actionTexts maps actionKey(dir, sha) to an action.yml text or { error }.
 */
export function admit(run, job, workflowText, config, actionTexts = {}) {
  if (!isAddressed(job)) return verdict('not-addressed', `runs-on [${jobLabels(job).join(', ')}] does not name commitwork`);
  const repo = run?.repository?.full_name;
  const allowed = labelsFor(config, repo);
  if (!allowed) return verdict('repo-undeclared', `${repo || 'the run\'s repository'} is not declared`);
  return eventVerdict(run, repo)
    || actorVerdict(run, actorsFor(config, repo))
    || labelVerdict(job, allowed)
    || workflowVerdict(run, job, workflowText, actionTexts)
    || verdict('admitted', `${run.event}: event, labels and workflow checks passed`);
}
