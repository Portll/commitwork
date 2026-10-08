#!/usr/bin/env node
// bin/offbox-watch-check.mjs — the LOCAL half of the off-box watcher: it watches the watcher.
//
// commitwork-remote's watch.mjs observes the anchor witness hourly and appends to its own chained
// ledger. That design has one hole this file exists to close: a watcher that stops running raises
// nothing. Its alarms are red workflow runs in a private repository, and a red run nobody opens is
// not a route. Measured 2026-09-24: every workflow in commitwork-remote had failed at startup
// since 2026-09-19T18:11 — five days — and nothing on this box knew, because nothing here looked.
//
// So freshness is a finding here, not an absence:
//   ok               the ledger is fresh and its newest observation says ok
//   ALARM            the newest observation alarms (its reasons are carried through verbatim)
//   STALE-LEDGER     no observation within CW_OFFBOX_MAX_AGE_H — the watcher stopped watching
//   STALE-WITNESS    the witness has not moved within CW_OFFBOX_WITNESS_MAX_AGE_H — this box stopped witnessing
//   WORKFLOW-FAILING --runs, and the last runs of the workflow all failed
//   no-ledger        the branch does not exist: never observed, which is not a pass
//   offline / not-permitted / no-repository   unknown, reported as unknown
//
// Exit: 0 ok · 1 an alarm state · 2 unknown. A state that proves nothing never exits 0.
//
// --page delivers to two routes, both every time:
//   1. CW_OFFBOX_WEBHOOK_URL, an HTTPS POST carrying CW_OFFBOX_PAGE_TOKEN as a bearer. Declared as
//      https://remote.commitwork.online/api/offbox/page, the panel on THIS box — a convenience view.
//   2. an issue in the witness repository, opened with the credential gh already holds. This is
//      the route that leaves the box, and it survives the failure it exists for: the issues API
//      answers while scheduled workflows in that same repository are refusing to start.
// Route 1 never substitutes for route 2. An alarm about this machine cannot be considered
// delivered by a service running on it.
//
// usage: offbox-watch-check.mjs [--json] [--runs] [--page]
//   CW_WITNESS_REPO / _REMOTE / _BRANCH   the witness clone, remote and branch
//   CW_OFFBOX_LEDGER_BRANCH               default watch-ledger
//   CW_OFFBOX_MAX_AGE_H                   ledger bound, default 6 (the watcher's cron is hourly)
//   CW_OFFBOX_WITNESS_MAX_AGE_H           witness bound, default 24 (the witness moves only while
//                                         the nightly sweep ladder runs, ~17h apart; the watcher
//                                         applies the same 24h to it)
//   CW_OFFBOX_WEBHOOK_URL                 --page target, HTTPS only, resolved via lib/secrets.mjs
//   CW_OFFBOX_ISSUE_REPO                  issue route target, default Portll/commitwork-remote
//   CW_NOW                                determinism, read at call time

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journal } from './lib/verdict-journal-core.mjs';
import { resolveInto, SECRETS_FILE } from '../lib/secrets.mjs';
import { gitChildEnv } from './lib/git-env.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

export const WEBHOOK_ENV = 'CW_OFFBOX_WEBHOOK_URL';
export const TOKEN_ENV = 'CW_OFFBOX_PAGE_TOKEN';
export const ISSUE_TITLE = '[offbox-watch] the off-box watcher is not reporting';
export const ALARM_STATES = ['ALARM', 'STALE-LEDGER', 'STALE-WITNESS', 'WORKFLOW-FAILING'];
export const UNKNOWN_STATES = ['no-ledger', 'offline', 'not-permitted', 'no-repository', 'unreadable-ledger'];

export const config = (env = process.env) => ({
  repo: env.CW_WITNESS_REPO || resolve(REPO, '..', 'commitwork-remote'),
  remote: env.CW_WITNESS_REMOTE || 'origin',
  witnessBranch: env.CW_WITNESS_BRANCH || 'witness-anchors',
  ledgerBranch: env.CW_OFFBOX_LEDGER_BRANCH || 'watch-ledger',
  maxAgeH: Number(env.CW_OFFBOX_MAX_AGE_H) > 0 ? Number(env.CW_OFFBOX_MAX_AGE_H) : 6,
  witnessMaxAgeH: Number(env.CW_OFFBOX_WITNESS_MAX_AGE_H) > 0 ? Number(env.CW_OFFBOX_WITNESS_MAX_AGE_H) : 24,
});
const nowMs = (env = process.env) => (env.CW_NOW ? Date.parse(env.CW_NOW) : Date.now());

// gitChildEnv: under a post-commit hook in a linked worktree an inherited GIT_DIR outranks `-C`,
// and every call here would read commitwork's own origin instead of the witness repository.
function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 60_000, env: gitChildEnv() });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** Why a fetch failed decides whether this is unknown or simply a branch that does not exist yet. */
export function classifyFetchFailure(stderr) {
  if (/couldn't find remote ref|not found/i.test(stderr)) return 'absent';
  if (/authentication|permission denied|403|could not read Username/i.test(stderr)) return 'not-permitted';
  return 'offline';
}

const hoursBetween = (thenMs, atMs) => Math.round(((atMs - thenMs) / 3_600_000) * 10) / 10;

/** The freshest observation the ledger carries, and whether its chain reads whole. */
export function newestObservation(text) {
  const lines = String(text || '').split('\n').filter(Boolean);
  if (!lines.length) return { records: 0, newest: null, torn: 0 };
  let torn = 0;
  let newest = null;
  for (const l of lines) {
    try {
      const r = JSON.parse(l);
      if (!newest || String(r.observedAt || '') > String(newest.observedAt || '')) newest = r;
    } catch { torn++; }
  }
  return { records: lines.length, newest, torn };
}

/** The last runs of the watch workflow, newest first. Optional: needs gh and the network. */
export function recentRuns({ repoSlug = 'Portll/commitwork-remote', workflow = 'witness-watch.yml', limit = 5 } = {}) {
  const r = spawnSync('gh', ['run', 'list', '-R', repoSlug, '-w', workflow, '-L', String(limit),
    '--json', 'conclusion,createdAt'], { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) return { state: r.stderr && /auth/i.test(r.stderr) ? 'not-permitted' : 'offline', runs: [] };
  try { return { state: 'checked', runs: JSON.parse(r.stdout || '[]') }; } catch { return { state: 'unreadable', runs: [] }; }
}

export function check({ env = process.env, runs = false } = {}) {
  const cfg = config(env);
  const at = nowMs(env);
  if (!existsSync(join(cfg.repo, '.git')) && !existsSync(join(cfg.repo, 'HEAD'))) {
    return { state: 'no-repository', code: 2, detail: 'no witness clone to read the ledger from' };
  }
  const fetched = {};
  for (const [key, branch] of [['ledger', cfg.ledgerBranch], ['witness', cfg.witnessBranch]]) {
    const f = git(cfg.repo, ['fetch', '-q', cfg.remote, `+refs/heads/${branch}:refs/remotes/${cfg.remote}/${branch}`]);
    fetched[key] = f.ok ? 'ok' : classifyFetchFailure(f.err);
  }
  const worst = [fetched.ledger, fetched.witness].find((s) => s === 'not-permitted' || s === 'offline');
  if (worst) return { state: worst, code: 2, detail: `fetch: ledger ${fetched.ledger}, witness ${fetched.witness}` };

  const tip = (b) => git(cfg.repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${b}`]).out || null;
  const commitMs = (ref) => {
    const t = git(cfg.repo, ['show', '-s', '--format=%ct', ref]).out;
    return /^\d+$/.test(t) ? Number(t) * 1000 : null;
  };
  const ledgerTip = tip(cfg.ledgerBranch);
  const witnessTip = tip(cfg.witnessBranch);
  const witnessAgeH = witnessTip ? hoursBetween(commitMs(witnessTip), at) : null;

  if (!ledgerTip) {
    return { state: 'no-ledger', code: 2, witnessTip, witnessAgeH,
      detail: 'the watcher has never written an observation — an absence, not a pass' };
  }
  const shown = git(cfg.repo, ['show', `${ledgerTip}:ledger.jsonl`]);
  if (!shown.ok) return { state: 'unreadable-ledger', code: 2, ledgerTip, detail: shown.err.slice(0, 200) };
  const { records, newest, torn } = newestObservation(shown.out);
  if (!newest) return { state: 'unreadable-ledger', code: 2, ledgerTip, records, torn, detail: 'no parseable observation' };

  const observedMs = Date.parse(newest.observedAt || '') || commitMs(ledgerTip);
  const ledgerAgeH = hoursBetween(observedMs, at);
  const base = { ledgerTip, witnessTip, records, torn, ledgerAgeH, witnessAgeH, maxAgeH: cfg.maxAgeH,
    witnessMaxAgeH: cfg.witnessMaxAgeH, observedAt: newest.observedAt || null, verdict: newest.verdict || null };

  if (newest.verdict === 'ALARM') return { ...base, state: 'ALARM', code: 1, alarms: newest.alarms || [] };
  if (ledgerAgeH > cfg.maxAgeH) {
    return { ...base, state: 'STALE-LEDGER', code: 1,
      detail: `the newest observation is ${ledgerAgeH}h old against a ${cfg.maxAgeH}h bound — the watcher is not running` };
  }
  // Its own bound, never the ledger's: the witness moves only during the nightly sweep ladder, so a
  // 6h bound raised STALE-WITNESS every afternoon and paged the issue hourly until the next night.
  if (witnessAgeH !== null && witnessAgeH > cfg.witnessMaxAgeH) {
    return { ...base, state: 'STALE-WITNESS', code: 1,
      detail: `the witness has not moved for ${witnessAgeH}h against a ${cfg.witnessMaxAgeH}h bound — this box stopped witnessing` };
  }
  if (runs) {
    const rr = recentRuns();
    base.runs = rr.state;
    if (rr.state === 'checked' && rr.runs.length && rr.runs.every((x) => x.conclusion === 'failure')) {
      return { ...base, state: 'WORKFLOW-FAILING', code: 1,
        detail: `the last ${rr.runs.length} runs of the watch workflow all failed; oldest ${rr.runs.at(-1)?.createdAt}` };
    }
  }
  return { ...base, state: 'ok', code: 0 };
}

/** Opaque by construction: the wire carries a ref and a state, never a path, host or ledger body. */
export function pagePayload(result, at = new Date().toISOString()) {
  return {
    event: 'offbox-watch',
    ref: sha256(`offbox-watch|${result.state}|${result.ledgerTip || 'none'}`).slice(0, 16),
    state: result.state,
    ledgerAgeHours: result.ledgerAgeH ?? null,
    witnessAgeHours: result.witnessAgeH ?? null,
    alarms: Array.isArray(result.alarms) ? result.alarms.length : 0,
    at,
  };
}

export async function page(result, { env = process.env, fetchImpl = fetch } = {}) {
  const r = resolveInto([WEBHOOK_ENV, TOKEN_ENV], { env, file: env.CW_SECRETS_FILE || SECRETS_FILE });
  const url = r.env[WEBHOOK_ENV];
  if (!url) return { paged: 'no-url', reason: `${WEBHOOK_ENV} is not declared — the alarm has no route` };
  // Refused in the core, before any request: an injected transport cannot bypass this.
  if (!/^https:\/\//i.test(url)) return { paged: 'refused', reason: 'webhook target is not https' };
  const token = r.env[TOKEN_ENV];
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(pagePayload(result, env.CW_NOW || new Date().toISOString())),
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? { paged: 'sent', status: res.status } : { paged: 'failed', status: res.status };
  } catch (e) { return { paged: 'failed', reason: String(e.message || e).slice(0, 120) }; }
}

function ghCli(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 60_000 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** Why the API refused decides the state; a refusal is never a delivered page. */
export function classifyGhFailure(stderr) {
  if (/401|403|authentication|not logged|gh auth|resource not accessible/i.test(stderr)) return 'not-permitted';
  if (/could not resolve|timed out|network|connection (refused|reset)|dial tcp/i.test(stderr)) return 'offline';
  return 'failed';
}

/** The same opaque payload the webhook carries, as issue text. No paths, hosts or ledger body. */
export function issueBody(result, at) {
  const p = pagePayload(result, at);
  return [
    `state: ${p.state}`,
    `ref: ${p.ref}`,
    `ledger age: ${p.ledgerAgeHours ?? 'unknown'}h`,
    `witness age: ${p.witnessAgeHours ?? 'unknown'}h`,
    `alarms carried: ${p.alarms}`,
    `observed: ${p.at}`,
  ].join('\n');
}

/**
 * One issue per outage, commented on after that: an hourly check that opens an issue an hour is a
 * route that trains its reader to close it. Keyed on the TITLE, never on a line or a run id.
 */
export async function pageIssue(result, { env = process.env, ghImpl = ghCli } = {}) {
  const slug = env.CW_OFFBOX_ISSUE_REPO || 'Portll/commitwork-remote';
  const body = issueBody(result, env.CW_NOW || new Date().toISOString());
  const open = ghImpl(['api', `repos/${slug}/issues?state=open&per_page=100`,
    '--jq', `[.[] | select(.title == ${JSON.stringify(ISSUE_TITLE)}) | .number] | first // empty`]);
  if (!open.ok) return { issue: classifyGhFailure(open.err), reason: open.err.slice(0, 160) };

  const existing = open.out ? Number(open.out) : null;
  if (existing) {
    const c = ghImpl(['api', `repos/${slug}/issues/${existing}/comments`, '-f', `body=${body}`]);
    return c.ok ? { issue: 'commented', number: existing } : { issue: classifyGhFailure(c.err), reason: c.err.slice(0, 160) };
  }
  const created = ghImpl(['api', `repos/${slug}/issues`, '-f', `title=${ISSUE_TITLE}`, '-f', `body=${body}`, '--jq', '.number']);
  if (!created.ok) return { issue: classifyGhFailure(created.err), reason: created.err.slice(0, 160) };
  return { issue: 'opened', number: Number(created.out) || null };
}

/**
 * BOTH routes, every time, and neither stands in for the other. The declared webhook terminates on
 * this box, so a delivery there proves nothing to anyone who does not trust this box, and letting
 * it satisfy the page would let whoever controls the box silence the route that leaves it.
 */
export async function notify(result, { env = process.env, fetchImpl = fetch, ghImpl = ghCli } = {}) {
  const hook = await page(result, { env, fetchImpl });
  const i = await pageIssue(result, { env, ghImpl });
  return { paged: `issue-${i.issue}`, number: i.number ?? null, webhook: hook.paged,
    ...(i.reason ? { reason: i.reason } : {}), ...(hook.reason ? { webhookReason: hook.reason } : {}) };
}

export async function run({ env = process.env, runs = false, doPage = false } = {}) {
  const result = check({ env, runs });
  let paging = { paged: 'not-requested' };
  if (doPage && result.code === 1) paging = await notify(result, { env });
  const record = {
    state: result.state,
    ledgerAgeH: result.ledgerAgeH ?? null,
    witnessAgeH: result.witnessAgeH ?? null,
    alarms: Array.isArray(result.alarms) ? result.alarms.length : 0,
    records: result.records ?? null,
    paged: paging.paged,
    webhook: paging.webhook ?? null,
  };
  // Journalled whatever the state: a check that only records its alarms cannot show a gap in itself.
  // Under a test runner with no CW_VERDICT_DIR this refuses: a forgotten seam would write the
  // fixture's verdict into the production journal, which is how the anchor stores were polluted.
  if (env.NODE_TEST_CONTEXT && !env.CW_VERDICT_DIR) {
    throw new Error('offbox-watch-check: refusing to journal under a test runner without CW_VERDICT_DIR');
  }
  const w = journal('offbox-watch', record);
  return { ...result, paging, journalled: w.ok, ...(w.ok ? {} : { journalError: w.error }) };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = await run({ runs: args.includes('--runs'), doPage: args.includes('--page') });
  if (args.includes('--json')) console.log(JSON.stringify(out, null, 1));
  else {
    console.log(`offbox-watch: ${out.state}${out.ledgerAgeH != null ? ` · ledger ${out.ledgerAgeH}h` : ''}${out.witnessAgeH != null ? ` · witness ${out.witnessAgeH}h` : ''}`);
    if (out.detail) console.log(`  ${out.detail}`);
    for (const a of out.alarms || []) console.log(`  alarm: ${a}`);
    if (out.paging?.paged && out.paging.paged !== 'not-requested') console.log(`  page: ${out.paging.paged}${out.paging.reason ? ` (${out.paging.reason})` : ''}`);
  }
  process.exit(out.code);
}
