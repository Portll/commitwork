// What admission needs from a workflow file, read through commitwork's Actions model
// (lib/actions-workflow.mjs, graded against GitHub's parser in docs/ACTIONS-MODEL.md).
// Static only: what a remote action does at runtime is not visible here.
import { parseWorkflow } from '../lib/actions-workflow.mjs';
import { parseYaml, toPlain } from '../lib/actions-yaml.mjs';

const WORKFLOWS = '.github/workflows/';
const MAX_ACTION_DEPTH = 4;
// GitHub names a matrix job `<name> (<values>)` and a called workflow's job `<caller> / <callee>`.
const MATRIX_SUFFIX = / \([^()]*\)$/;

/** The run's workflow file, or '' when it is not a file under .github/workflows (a dynamic workflow). */
export function workflowPath(run) {
  const path = String(run?.path || '').replace(/@.*$/, '');
  return path.startsWith(WORKFLOWS) && !path.split('/').includes('..') ? path : '';
}

export const workflowKey = (run) => `${workflowPath(run)}@${run?.head_sha}`;
export const actionKey = (dir, sha) => `${dir}@${sha}`;

/** The repo-relative directory of a local action (`./dir`), or '' for any other `uses`. */
export function localActionDir(uses) {
  const m = /^\.[/\\](.*)$/.exec(String(uses));
  if (!m) return '';
  const dir = m[1].replace(/\\/g, '/').replace(/\/+$/, '');
  return dir && !dir.split('/').includes('..') ? dir : '';
}

/** { model } or { error } for one workflow text. */
export function readWorkflow(text) {
  const r = parseWorkflow(text);
  if (r.errors.length || !r.model) return { error: r.errors[0]?.message || 'the workflow did not model' };
  return { model: r.model };
}

/** The workflow jobs an API job may be. Expression-named jobs are candidates when nothing matches by name. */
export function jobCandidates(model, apiName) {
  const name = String(apiName || '');
  const names = new Set([name, name.replace(MATRIX_SUFFIX, ''), name.split(' / ')[0]]);
  const byName = model.jobs.filter((j) => names.has(j.id) || (typeof j.name === 'string' && names.has(j.name)));
  return byName.length ? byName : model.jobs.filter((j) => typeof j.name !== 'string');
}

const stepUses = (steps = []) => steps.flatMap((s) => (s.parallel ? stepUses(s.parallel) : s.uses ? [s.uses] : []));

function readAction(text) {
  try {
    const action = toPlain(parseYaml(text));
    return action && typeof action === 'object' && action.runs && typeof action.runs === 'object' ? action : null;
  } catch {
    return null;
  }
}

const compositeUses = (action) =>
  (Array.isArray(action.runs.steps) ? action.runs.steps : []).map((s) => s?.uses).filter((u) => typeof u === 'string');

/** Local action directories a workflow text references, for the poller to fetch. */
export function localActionDirs(text) {
  const read = readWorkflow(text);
  if (!read.model) return [];
  const uses = read.model.jobs.flatMap((j) => stepUses(j.steps));
  return [...new Set(uses.map(localActionDir).filter(Boolean))];
}

/** Local action directories a composite action.yml references. */
export function actionLocalDirs(text) {
  const action = readAction(text);
  return action ? [...new Set(compositeUses(action).map(localActionDir).filter(Boolean))] : [];
}

// look(dir) → action.yml text, { error: { status } } or undefined.
function usesBlockers(uses, look, depth) {
  if (uses.startsWith('docker://')) return [{ code: 'needs-docker-action', detail: uses }];
  const dir = localActionDir(uses);
  if (!dir) return [];
  const seen = look(dir);
  if (seen && seen.error && seen.error.status !== 404) return [{ code: 'workflow-unmeasured', detail: `${uses}: ${seen.error.status} ${seen.error.reason}` }];
  const action = typeof seen === 'string' ? readAction(seen) : null;
  if (!action) return [{ code: 'local-action-unseen', detail: uses }];
  const using = String(action.runs.using || '').toLowerCase();
  if (using === 'docker') return [{ code: 'needs-docker-action', detail: uses }];
  if (using !== 'composite') return [];
  if (depth >= MAX_ACTION_DEPTH) return [{ code: 'local-action-unseen', detail: `${uses} nests deeper than ${MAX_ACTION_DEPTH}` }];
  return compositeUses(action).flatMap((u) => usesBlockers(u, look, depth + 1));
}

/** Why a modelled job cannot run on a docker-less slot, as [{ code, detail }]; empty when nothing visible stops it. */
export function jobBlockers(job, look = () => undefined) {
  if (job.type === 'reusableWorkflowJob') return [{ code: 'reusable-workflow', detail: job.ref }];
  const out = [];
  if (job.container !== undefined) out.push({ code: 'needs-container', detail: 'container:' });
  if (job.services !== undefined) out.push({ code: 'needs-services', detail: 'services:' });
  for (const uses of stepUses(job.steps)) out.push(...usesBlockers(uses, look, 0));
  return out;
}
