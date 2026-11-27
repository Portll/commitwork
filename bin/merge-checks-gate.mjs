#!/usr/bin/env node
// bin/merge-checks-gate.mjs — has every other check on this commit passed? A job's `needs:` covers
// its own workflow only, and a pull request merged by a job can go in while another workflow's
// check on the same commit is failing or still running. This reads every check run on the commit,
// waits for the ones still running, and answers once.
//
// The calling job's own check run is in progress while this runs and is left out: it is the one
// whose name is SELF_CHECK_NAME inside workflow run GITHUB_RUN_ID.
//
// usage: node bin/merge-checks-gate.mjs [--wait <seconds>] [--every <seconds>] [--github-output]
//   input: GITHUB_REPOSITORY, HEAD_SHA, GH_TOKEN, GITHUB_RUN_ID, SELF_CHECK_NAME, GITHUB_API_URL
//   --wait            how long to wait for running checks (default 900)
//   --every           seconds between reads (default 30)
//   --github-output   append clear=true|false to $GITHUB_OUTPUT, and exit 0 either way
//
// exit: 0 clear (or decided, under --github-output) · 2 usage · 20 a check did not pass · 21 a check
// was still running at the deadline · 22 no other check succeeded on the commit · 23 the checks
// could not be read — never read as "clear"
import { appendFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';

const PASSING = new Set(['success', 'neutral', 'skipped']);
const PAGE = 100;
const MAX_PAGES = 20;

/** { verdict: 'clear'|'blocked'|'pending'|'empty', failed, pending, succeeded } over every check run but the caller's own. */
export function judgeChecks(runs, { selfName = '', selfRunId = '' } = {}) {
  const own = (r) => !!selfName && !!selfRunId && r.name === selfName && String(r.details_url || '').includes(`/actions/runs/${selfRunId}/`);
  const others = runs.filter((r) => !own(r));
  const label = (r) => `${r.name}${r.status === 'completed' ? ` (${r.conclusion || 'no conclusion'})` : ` (${r.status || 'no status'})`}`;
  const pending = others.filter((r) => r.status !== 'completed');
  const failed = others.filter((r) => r.status === 'completed' && !PASSING.has(r.conclusion));
  const succeeded = others.filter((r) => r.status === 'completed' && r.conclusion === 'success');
  const verdict = failed.length ? 'blocked' : pending.length ? 'pending' : succeeded.length ? 'clear' : 'empty';
  return { verdict, failed: failed.map(label), pending: pending.map(label), succeeded: succeeded.length };
}

export async function readCheckRuns({ api, repo, sha, token, fetchImpl = fetch }) {
  const runs = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchImpl(`${api}/repos/${repo}/commits/${sha}/check-runs?per_page=${PAGE}&page=${page}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'commitwork-merge-checks-gate' },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for the commit's check runs`);
    const body = await res.json();
    if (!Array.isArray(body.check_runs) || !Number.isInteger(body.total_count)) throw new Error("the check-runs answer has no check_runs list");
    runs.push(...body.check_runs);
    if (runs.length >= body.total_count || !body.check_runs.length) return runs;
  }
  throw new Error(`more than ${MAX_PAGES * PAGE} check runs on one commit`);
}

/** Reads until nothing is running, something failed, or `waitSec` has passed. */
export async function settle({ read, self, waitSec, everySec, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = console.log }) {
  const deadline = now() + waitSec * 1000;
  for (;;) {
    const judged = judgeChecks(await read(), self);
    if (judged.verdict !== 'pending' || now() >= deadline) return judged;
    log(`waiting on ${judged.pending.length}: ${judged.pending.join(', ')}`);
    await sleep(everySec * 1000);
  }
}

const EXIT = { clear: 0, blocked: 20, pending: 21, empty: 22 };
const SAYS = {
  clear: (j) => `checks: clear — ${j.succeeded} succeeded and none failed or is running`,
  blocked: (j) => `checks: not clear — did not pass: ${j.failed.join(', ')}`,
  pending: (j) => `checks: not clear — still running at the deadline: ${j.pending.join(', ')}`,
  empty: () => 'checks: not clear — no other check succeeded on this commit',
};

async function main(argv, env) {
  let waitSec = 900;
  let everySec = 30;
  const ghOut = argv.includes('--github-output');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--wait' || argv[i] === '--every') {
      const n = Number(argv[i + 1]);
      if (!Number.isFinite(n) || n < 0 || (argv[i] === '--every' && n < 1)) { console.error(`${argv[i]} needs a number of seconds`); return 2; }
      if (argv[i++] === '--wait') waitSec = n; else everySec = n;
    } else if (argv[i] !== '--github-output') { console.error(`unknown argument ${argv[i]}`); return 2; }
  }
  const decide = (clear, code) => {
    if (!ghOut) return code;
    if (!env.GITHUB_OUTPUT) { console.error('--github-output: GITHUB_OUTPUT is not set'); return 23; }
    appendFileSync(env.GITHUB_OUTPUT, `clear=${clear}\n`);
    return 0;
  };
  const repo = env.GITHUB_REPOSITORY || '';
  const sha = env.HEAD_SHA || '';
  const problem = !/^[\w.-]+\/[\w.-]+$/.test(repo) ? 'GITHUB_REPOSITORY is not owner/name'
    : !/^[0-9a-f]{40}$/.test(sha) ? 'HEAD_SHA is not a full commit id'
    : !env.GH_TOKEN ? 'GH_TOKEN is not set'
    : !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !env.SELF_CHECK_NAME ? 'GITHUB_RUN_ID and SELF_CHECK_NAME must name the calling job' : null;
  if (problem) { console.error(`checks: ${problem} — not merging`); return decide(false, 23); }
  let judged;
  try {
    judged = await settle({
      read: () => readCheckRuns({ api: env.GITHUB_API_URL || 'https://api.github.com', repo, sha, token: env.GH_TOKEN }),
      self: { selfName: env.SELF_CHECK_NAME, selfRunId: env.GITHUB_RUN_ID }, waitSec, everySec,
    });
  } catch (e) {
    console.error(`checks: could not be read (${e.message}) — not merging`);
    return decide(false, 23);
  }
  console.log(SAYS[judged.verdict](judged));
  return decide(judged.verdict === 'clear', EXIT[judged.verdict]);
}

if (isMainModule(import.meta.url)) process.exitCode = await main(process.argv.slice(2), process.env);
