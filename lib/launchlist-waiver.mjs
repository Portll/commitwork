// lib/launchlist-waiver.mjs — the one waiver the launch checklist honours: an `accept` annotation
// on actions-gaps' `self-hosted-runner` finding, recorded when a repository is opted into the
// commitwork runner. Nothing here reads pull_request_target; that stays a hard failure.
//
// Keyed as the rollup keys it: category actionsGaps, identity (rule, file, job) from
// monitor/detail-schema.mjs, plus repo. No line number, and never fleet-scoped.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, scanWorkflow } from '../bin/actions-gaps.mjs';
import { annActive, scannerAnnMatch, validateScannerAnnotation } from '../monitor/annotate-lib.mjs';
import { identityFor } from '../monitor/detail-schema.mjs';
import { annotationsPathFor } from '../monitor/store-paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const WAIVER_CATEGORY = 'actionsGaps';
export const WAIVER_RULE = 'self-hosted-runner';
export const RUNNER_LABEL = 'commitwork';
/** annotate-lib's `reason` is free text, so the basis must open with this and name every control. */
export const WAIVER_PREFIX = 'commitwork-runner:';
/** Ids for the controls the basis must name; container/runner/README.md says what each one is. */
export const RUNNER_CONTROLS = Object.freeze([
  'no-docker-socket', 'slot-network', 'jit-only', 'one-job-per-slot', 'admission', 'job-started-hook',
]);

/** The launchlist's own self-hosted rule, kept so a form the parser misses still fails. */
const RAW_RULE = /runs-on:[^\n]*self-hosted/;

const get = (node, key) => (node && node.type === 'map' ? node.entries.get(key) : undefined);
const scalars = (node, out = []) => {
  if (!node) return out;
  if (node.type === 'scalar') out.push(node.value);
  else if (node.type === 'seq') node.items.forEach((n) => scalars(n, out));
  else if (node.type === 'map') node.entries.forEach((n) => scalars(n, out));
  return out;
};

/** Labels a job's runs-on names literally. An expression names none: its matrix cannot be tied to one runner. */
function literalLabels(runsOn) {
  if (!runsOn) return [];
  if (runsOn.type === 'scalar' && /\$\{\{/.test(runsOn.value)) return [];
  const node = runsOn.type === 'map' ? get(runsOn, 'labels') : runsOn;
  return scalars(node).map((s) => String(s).trim().toLowerCase());
}

/** actions-gaps' self-hosted jobs in one workflow text: [{ job, commitwork }], or null when it does not parse. */
export function selfHostedJobs(file, text) {
  let doc;
  try { doc = parseYaml(text); } catch { return null; }
  if (!doc || doc.type !== 'map') return null;
  const jobs = get(doc, 'jobs');
  return scanWorkflow(file, doc).findings.filter((f) => f.rule === WAIVER_RULE)
    .map((f) => ({ job: f.job, commitwork: literalLabels(get(get(jobs, f.job), 'runs-on')).includes(RUNNER_LABEL) }));
}

/** Why `reason` is not a waiver basis, or '' when it is one. */
export function basisGaps(reason) {
  const text = String(reason || '').trim();
  if (!text.startsWith(WAIVER_PREFIX)) return `basis does not start with '${WAIVER_PREFIX}'`;
  const named = new Set(text.slice(WAIVER_PREFIX.length).split(/[^a-z0-9-]+/i));
  const missing = RUNNER_CONTROLS.filter((c) => !named.has(c));
  return missing.length ? `basis does not name ${missing.join(', ')}` : '';
}

/** scannerAnnotations from the operator's store: { records } or { error }. Only ENOENT is empty. */
export function loadScannerAnnotations(path = annotationsPathFor(ROOT)) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    if (e && e.code === 'ENOENT') return { records: [] };
    return { error: `annotation store unreadable (${(e && e.code) || 'unparseable'})` };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'annotation store is not an object' };
  const recs = doc.scannerAnnotations;
  if (recs === undefined) return { records: [] };
  return Array.isArray(recs) ? { records: recs } : { error: 'annotation store: scannerAnnotations is not a list' };
}

/**
 * The waiver for one self-hosted job: { waived: true, text } or { waived: false, why }.
 * Any active, valid, repo-scoped accept with a complete basis waives; an earlier record that fails
 * does not block a later one that passes.
 */
export function waiverFor(records, { repo, file, job }, now) {
  const idf = identityFor(WAIVER_CATEGORY);
  const row = { repo, rule: WAIVER_RULE, file, job };
  const accepts = (records || []).filter((a) => a && a.category === WAIVER_CATEGORY && a.action === 'accept'
    && !validateScannerAnnotation(a, idf).length && annActive(a, now) && scannerAnnMatch(a, row, idf));
  if (!accepts.length) return { waived: false, why: `no accept annotation in force for ${WAIVER_RULE} on job ${job} in ${repo}` };
  const why = (a) => (a.scope === 'fleet' ? 'a fleet-scoped accept is not a per-repo opt-in' : basisGaps(a.reason));
  const ok = accepts.find((a) => !why(a));
  if (!ok) return { waived: false, why: why(accepts[0]) };
  const date = new Date(ok.at).toISOString().slice(0, 10);
  return { waived: true, text: `waived: accepted ${date} by ${ok.who}: ${ok.reason.trim()}` };
}

/**
 * Self-hosted rows for one workflow: { hard: [], waived: [] }. A job is waived only when its runs-on
 * names the commitwork label and its accept holds; a raw-rule hit with no parsed job stays hard.
 * `annotations` is called at most once per file, and only when a job needs it.
 */
export function selfHostedRows(path, text, { repo, annotations, now }) {
  const raw = RAW_RULE.test(text);
  const jobs = selfHostedJobs(path, text);
  if (jobs === null) return { hard: raw ? [`${path}: self-hosted runner (the workflow does not parse, so no job can carry a waiver)`] : [], waived: [] };
  if (!jobs.length) return { hard: raw ? [`${path}: self-hosted runner (no job names the label, so nothing can carry a waiver)`] : [], waived: [] };
  const hard = [];
  const waived = [];
  let store = null;
  for (const { job, commitwork } of jobs) {
    const at = `${path}: self-hosted runner, job ${job}`;
    if (!commitwork) { hard.push(`${at} (runs-on does not name ${RUNNER_LABEL} literally, so the runner's controls are not shown to apply)`); continue; }
    store = store || annotations();
    const v = store.error ? { waived: false, why: store.error } : waiverFor(store.records, { repo, file: path, job }, now);
    if (v.waived) waived.push(`${at} ${v.text}`);
    else hard.push(`${at} (${v.why})`);
  }
  return { hard, waived };
}
