#!/usr/bin/env node
// bin/actions-health.mjs — whether a repository's GitHub Actions results can be believed, and
// what they cost.
//
// Every signal here was sitting in the Actions API while nobody read it. Measured 2026-09-27:
// Actions refused to start any job across the account from 2026-09-19 and nothing on this box
// noticed for five days; commitwork's own CI had been red on every push since 2026-08-11; CodeQL and
// veld's Docs workflow failed every run; and 47% of 5,388 billed weighted minutes in 30 days went on
// jobs that failed. A red run in a repository nobody opens is not a signal.
//
// usage: actions-health.mjs [repoDir]
//   env, read at call time: CW_ACTIONS_HEALTH_RUNS (runs read, default 30), CW_ACTIONS_HEALTH_JOB_RUNS
//   (newest runs whose jobs are read, default 10), CW_ACTIONS_HEALTH_STREAK (red streak that is a
//   finding, default 3). Auth is gh's own.
// Output: a rule-counts report on stdout. Exit 0 ran · 2 could not run.
import { spawnSync } from 'node:child_process';
import { scannedGit } from './lib/git-env.mjs';
import { resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

const RED = new Set(['failure', 'startup_failure', 'timed_out']);
const GREEN = new Set(['success']);
const OS_WEIGHT = { linux: 1, windows: 2, macos: 10 };
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);

/** owner/repo for a github.com remote URL, or null. */
export function githubSlug(url) {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** A job that never got a runner is a job Actions refused to start; it is also not billed. */
export const neverStarted = (job) => !job.runner_name && !(job.steps || []).length;

export function jobOs(job) {
  const l = (job.labels || []).map((x) => String(x).toLowerCase());
  if (l.includes('self-hosted')) return 'self-hosted';
  if (l.some((x) => x.includes('windows'))) return 'windows';
  if (l.some((x) => x.includes('macos'))) return 'macos';
  return 'linux';
}

/** Billed weighted minutes: each job rounded up to a minute, weighted by runner OS; public repositories and self-hosted runners are free. */
export function jobWeightedMinutes(job, isPrivate) {
  if (!isPrivate || neverStarted(job) || !job.started_at || !job.completed_at) return 0;
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at);
  const w = OS_WEIGHT[jobOs(job)] || 0;
  return ms > 0 ? Math.ceil(ms / 60000) * w : 0;
}

/** Consecutive red runs, newest first, ignoring cancelled, skipped and in-progress runs. */
export function redStreak(runsNewestFirst) {
  let length = 0;
  let since = null;
  for (const r of runsNewestFirst) {
    if (GREEN.has(r.conclusion)) break;
    if (!RED.has(r.conclusion)) continue;
    length++;
    since = r.created_at;
  }
  return { length, since };
}

/** The report, from already-fetched API objects. Pure. */
export function assess({ repo, runs, jobsByRun }, { streakMin = 3 } = {}) {
  const summary = { findings: 0, byRule: {}, filesScanned: 0, void: false, private: !!repo.private, defaultBranch: repo.default_branch };
  const out = { tool: 'actions-health', summary, findings: [] };
  const add = (f) => { out.findings.push(f); summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1; summary.findings++; };
  if (!runs.length) return { ...out, summary: { ...summary, void: true, voidReason: 'Actions holds no runs for this repository — nothing to believe or disbelieve, which is not a clean result' } };

  const byWorkflow = new Map();
  for (const r of runs) {
    const key = r.path || r.name || `workflow ${r.workflow_id}`;
    if (!byWorkflow.has(key)) byWorkflow.set(key, { name: r.name, runs: [] });
    byWorkflow.get(key).runs.push(r);
  }
  summary.filesScanned = byWorkflow.size;
  summary.runsSampled = runs.length;
  summary.workflows = [];
  for (const [path, w] of [...byWorkflow].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const onDefault = w.runs.filter((r) => r.head_branch === repo.default_branch && r.event !== 'pull_request')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const s = redStreak(onDefault);
    summary.workflows.push({ path, name: w.name, runs: w.runs.length, redStreak: s.length });
    if (s.length >= streakMin) {
      add({ rule: 'ci-red-streak', path, sev: 'med',
        detail: `the last ${s.length} ${repo.default_branch} runs of ${w.name || path} failed, the first of them on ${String(s.since).slice(0, 10)}; a workflow that always fails tells nobody anything` });
    }
  }

  const jobs = Object.values(jobsByRun).flat();
  const refused = jobs.filter(neverStarted).length;
  summary.jobsSampled = jobs.length;
  summary.jobsNeverStarted = refused;
  summary.weightedMinutesSampled = jobs.reduce((s, j) => s + jobWeightedMinutes(j, repo.private), 0);
  summary.weightedMinutesOnFailures = jobs.filter((j) => j.conclusion === 'failure').reduce((s, j) => s + jobWeightedMinutes(j, repo.private), 0);
  if (jobs.length >= 3 && refused / jobs.length >= 0.5) {
    add({ rule: 'ci-never-started', path: '.github/workflows', sev: 'high',
      detail: `${refused} of ${jobs.length} jobs in the newest ${Object.keys(jobsByRun).length} runs never got a runner: Actions refused to start them (budget, billing or policy), so those runs report nothing` });
  }
  return out;
}

function gh(path) {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error && r.error.code === 'ENOENT') throw Object.assign(new Error('gh is not on PATH'), { void: true });
  if (r.status !== 0) {
    const why = String(r.stderr || '').trim().split('\n').pop().slice(0, 200);
    throw Object.assign(new Error(`gh api ${path.split('?')[0]}: ${why}`), { void: true });
  }
  return JSON.parse(r.stdout);
}

export function actionsHealth(repoDir, env = process.env) {
  const remote = scannedGit(repoDir, ['remote', 'get-url', 'origin']);
  const slug = remote.status === 0 ? githubSlug(remote.stdout) : null;
  const voided = (why) => ({ tool: 'actions-health', summary: { findings: 0, byRule: {}, filesScanned: 0, void: true, voidReason: why }, findings: [] });
  if (!slug) return voided('origin is not a github.com repository — Actions health does not apply, which is not a clean result');
  try {
    const repo = gh(`repos/${slug}`);
    const runs = gh(`repos/${slug}/actions/runs?per_page=${num(env.CW_ACTIONS_HEALTH_RUNS, 30)}`).workflow_runs || [];
    const newest = [...runs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, num(env.CW_ACTIONS_HEALTH_JOB_RUNS, 10));
    const jobsByRun = {};
    for (const r of newest) jobsByRun[r.id] = gh(`repos/${slug}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`).jobs || [];
    return assess({ repo, runs, jobsByRun }, { streakMin: num(env.CW_ACTIONS_HEALTH_STREAK, 3) });
  } catch (e) {
    if (e.void) return voided(`could not read Actions for ${slug}: ${e.message}`);
    throw e;
  }
}

if (isMainModule(import.meta.url)) {
  let out;
  try { out = actionsHealth(resolve(process.argv[2] || '.')); }
  catch (e) { process.stderr.write(`actions-health: ${e.message}\n`); process.exitCode = 2; }
  if (out) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    process.exitCode = out.summary.void && /could not read|not on PATH/.test(out.summary.voidReason) ? 2 : 0;
  }
}
