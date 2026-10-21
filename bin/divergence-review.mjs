#!/usr/bin/env node
// bin/divergence-review.mjs — review the CodeQL stage-1 divergences at or above the threshold with a
// model (monitor/divergence-review.mjs) and record each review beside its row. A review says which
// analyst's verdict the evidence supports better and whether the disagreement comes from the prompt
// and schema or from the evidence. It is a pointer for a human and changes no classification.

// usage: node bin/divergence-review.mjs [--limit N] [--dry-run] [--retry-failed]
//   --limit N        review at most N rows, highest score first (default 5, at most 100)
//   --dry-run        list the rows and the engine each would get; call no model, write nothing
//   --retry-failed   also review a row whose last review is recorded as failed
// exit: 0 every row reviewed, or nothing to review, or --dry-run · 20 a review failed and is recorded
//       as failed · 21 a store or job record could not be read, or a review could not be recorded · 22 usage

// The store and the reports root resolve as they do everywhere else (monitor/store-paths.mjs, the
// registry). The reviewer's settings are the env monitor/divergence-review.mjs documents.

// fact: only the latest row of a finding is reviewed / a re-run supersedes the job record that holds an earlier row's verdicts
// fact: a row with a recorded review is skipped / a re-run is idempotent, and a failed one is retried only on request

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { readDimension } from '../monitor/nondeterministic-store.mjs';
import { stage1Pair } from '../monitor/divergence-kappa.mjs';
import { reviewDivergence, reviewsBySubject, reviewMin, chooseReviewer, REVIEW_DIMENSION } from '../monitor/divergence-review.mjs';
import { loadRegistry } from '../monitor/registry.mjs';
import { reportsRootDir } from '../monitor/area.mjs';
import { readJSONState } from '../admin/lib/core.mjs';
import { sourceContext, reviewEvidence } from '../admin/routes/codeql-remediation.mjs';

export const EXIT = { OK: 0, FAILED: 20, UNREADABLE: 21, USAGE: 22 };
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

export function parseArgs(argv) {
  const o = { limit: DEFAULT_LIMIT, dryRun: false, retryFailed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--retry-failed') o.retryFailed = true;
    else if (a === '--limit') {
      const v = argv[++i];
      if (!/^\d+$/.test(String(v)) || Number(v) < 1 || Number(v) > MAX_LIMIT) return { error: `--limit takes a whole number from 1 to ${MAX_LIMIT}, got ${JSON.stringify(v ?? null)}` };
      o.limit = Number(v);
    } else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  return o;
}

/**
 * The rows to review: each finding's latest stage-1 row, at or above `min`, without a recorded
 * review (or with only a failed one, under retryFailed). Highest score first, then subject.
 */
export function selectRows(divergence, reviews, { min, retryFailed = false }) {
  const out = [];
  for (const { subject, rows } of divergence.subjects) {
    const pairs = rows.filter((r) => stage1Pair({ ...r, subject: r.subject ?? subject }));
    const latest = pairs[pairs.length - 1];
    if (!latest || typeof latest.score !== 'number' || latest.score < min) continue;
    const of = (reviews.get(subject) || []).filter((r) => r && r.detail && r.detail.reviewOf && r.detail.reviewOf.ts === latest.ts);
    if (of.some((r) => r.detail.status === 'reviewed')) continue;
    if (of.length && !retryFailed) continue;
    out.push({ ...latest, subject: latest.subject ?? subject, retry: of.length > 0 });
  }
  return out.sort((a, b) => b.score - a.score || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
}

/** Every area's codeql-remediation directory under the reports root. An absent root holds none. */
export function jobDirs(root = reportsRootDir(loadRegistry({ quiet: true }))) {
  let names;
  try { names = readdirSync(root, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return names.filter((e) => e.isDirectory()).map((e) => join(root, e.name, 'codeql-remediation')).sort();
}

const refuse = (error) => ({ ok: false, error });

/**
 * The evidence for a row, from the job record of the same run. A record that is absent, re-run since,
 * or unreadable is a reason, returned for the failed review; an unreadable one is never read as absent.
 */
export function loadEvidence(row, dirs) {
  const d = row.detail || {};
  const id = String(d.jobId || '');
  if (!/^[a-f0-9]{16}$/.test(id)) return refuse('the row names no job id, so its stage-1 verdicts cannot be found');
  let found = [];
  for (const dir of dirs) {
    const r = readJSONState(join(dir, `${id}.json`));
    if (r.state === 'absent') continue;
    if (r.state !== 'ok' || !r.value || typeof r.value !== 'object') return refuse(`job record ${id} is unreadable (${r.why || 'not a job object'}); that is not an absent record`);
    found.push(r.value);
  }
  if (d.project) found = found.filter((j) => j.project === d.project);
  if (!found.length) return refuse(`no job record ${id} under the reports root: it was cleared, or written on another machine`);
  const cls = (j, s) => j.stages && j.stages[s] && j.stages[s].verdict && j.stages[s].verdict.classification;
  const same = found.filter((j) => (d.runAt ? j.createdAt === d.runAt : true)
    && cls(j, 'local') === (d.local && d.local.classification) && cls(j, 'opus') === (d.opus && d.opus.classification));
  if (!same.length) return refuse(`job ${id} was re-run after this row; the stage-1 verdicts it scored were superseded`);
  if (same.length > 1) return refuse(`${same.length} job records match ${id}; none is chosen over the others`);
  const j = same[0];
  if (!j.finding || !j.stages.local.verdict || !j.stages.opus.verdict) return refuse(`job record ${id} holds no finding or no stage-1 verdict`);
  const repo = typeof j.repoPath === 'string' && existsSync(j.repoPath) ? j.repoPath : null;
  const ctx = sourceContext(repo, j.finding.file, j.finding.line);
  const note = `source context re-read at review time, and it may differ from what the analysts read: ${ctx.note}`;
  return reviewEvidence(j.finding, { ...ctx, note }, j.stages.local.verdict, j.stages.opus.verdict,
    { match: d.runAt ? 'run-identity' : 'classifications (the row predates run identity)' });
}

const line = (r) => `${r.subject} · score ${r.score.toFixed(2)}`;

export async function main(argv = process.argv.slice(2), { log = console.log, err = console.error, env = process.env } = {}) {
  const o = parseArgs(argv);
  if (o.error) { err(`divergence-review: ${o.error}`); return EXIT.USAGE; }
  const min = reviewMin(env);
  if (!min.ok) { err(`divergence-review: ${min.error}`); return EXIT.USAGE; }
  const probe = chooseReviewer(null, env);
  if (!probe.ok) { err(`divergence-review: ${probe.error}`); return EXIT.USAGE; }

  let divergence, reviews;
  try { divergence = readDimension('divergence'); reviews = reviewsBySubject(); }
  catch (e) { err(`divergence-review: the store could not be read (${e.message}); nothing was reviewed`); return EXIT.UNREADABLE; }
  if (divergence.absent) { log('divergence-review: no divergence row is recorded; nothing to review'); return EXIT.OK; }
  const all = selectRows(divergence, reviews, { min: min.value, retryFailed: o.retryFailed });
  const rows = all.slice(0, o.limit);
  log(`divergence-review: ${all.length} row(s) at or above ${min.value} without a review${all.length > rows.length ? `; the ${rows.length} highest are taken (--limit ${o.limit})` : ''}`);
  if (o.dryRun) {
    for (const r of rows) {
      const c = chooseReviewer(r, env);
      log(`  would review ${line(r)} with ${c.engine}${r.retry ? ' (retrying a failed review)' : ''}: ${c.note}`);
    }
    log('divergence-review: dry run; no model was called and nothing was written');
    return EXIT.OK;
  }

  let dirs;
  try { dirs = jobDirs(); }
  catch (e) { err(`divergence-review: the reports root could not be read (${e.message}); nothing was reviewed`); return EXIT.UNREADABLE; }
  let failed = 0, unrecorded = 0;
  for (const r of rows) {
    const out = await reviewDivergence(r, loadEvidence(r, dirs), { trigger: 'cli', env });
    const by = out.detail.answeredBy ? `${out.detail.answeredBy.engine}:${out.detail.answeredBy.model}` : out.detail.reviewer ? out.detail.reviewer.engine : 'no engine';
    if (!out.recorded) { unrecorded++; err(`  NOT RECORDED ${line(r)}: ${out.error}`); continue; }
    if (out.status === 'reviewed') {
      const v = out.detail.review;
      log(`  reviewed ${line(r)} by ${by} (${out.detail.sampling}): better supported ${v.betterSupported}, disagreement from ${v.disagreementSource}${v.promptSchemaIssue !== 'none' ? ` (${v.promptSchemaIssue})` : ''}`);
    } else {
      failed++;
      log(`  FAILED ${line(r)} by ${by}: ${out.detail.error} (recorded as failed)`);
    }
  }
  log(`divergence-review: ${rows.length - failed - unrecorded} reviewed, ${failed} failed and recorded, ${unrecorded} not recorded · store dimension ${REVIEW_DIMENSION} · each review is a pointer for a person, not a verdict`);
  return unrecorded ? EXIT.UNREADABLE : failed ? EXIT.FAILED : EXIT.OK;
}

if (isMainModule(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`divergence-review: ${e.stack || e.message}`); process.exitCode = EXIT.UNREADABLE; });
}
