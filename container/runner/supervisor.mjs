// supervisor.mjs: the root process of a runner slot, under --init. One job per container lifetime:
// wipe /work, claim a job from the dispatcher, run the runner as uid 1000, kill what the job left,
// report the cgroup totals, exit. The compose restart policy brings the next lifetime, with fresh
// tmpfs, a fresh cgroup and a new boot nonce.
//   env: CW_SLOT_ID, CW_SLOT_SECRET (removed from this process's env on read), CW_SLOT_CLAIM_URL,
//        CW_SLOT_WORK (default /work), HTTPS_PROXY / NO_PROXY handed to the runner
//
// exit: 0 the runner exited 0 · 1 the runner failed · 3 the claim was refused · 4 the work volume is missing
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chownSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { claimJob, reportJob, ClaimRefused } from './claim-client.mjs';
import { cgroupTotals, killAll, wipe } from './slot-lib.mjs';

const JOB_UID = 1000;
const HOME = '/home/node';
const RUNNER_SRC = '/opt/actions-runner';
const HOOK = '/opt/commitwork/container/runner/job-started.sh';

let slotId = '';
const boot = randomBytes(16).toString('hex');
const log = (event, data = {}) => console.log(JSON.stringify({ slot: slotId || null, boot, event, ...data }));

const sh = (cmd, args) => new Promise((done) => spawn(cmd, args, { stdio: 'inherit' }).on('exit', done));

/** The copy keeps the image's read-only modes, so ownership alone leaves _diag uncreatable. */
async function giveToJob(p) {
  await sh('chown', ['-R', `${JOB_UID}:${JOB_UID}`, p]);
  await sh('chmod', ['-R', 'u+w', p]);
}

async function prepare(work) {
  const removed = wipe(work);
  // the runner writes _diag, _work and its JIT files beside its binaries; the image copy stays read-only
  cpSync(RUNNER_SRC, `${work}/runner`, { recursive: true });
  await giveToJob(`${work}/runner`);
  mkdirSync(`${HOME}/.semgrep`, { recursive: true });
  chownSync(HOME, JOB_UID, JOB_UID);
  chownSync(`${HOME}/.semgrep`, JOB_UID, JOB_UID);
  return removed;
}

function proxyEnv() {
  const proxy = process.env.HTTPS_PROXY;
  if (!proxy) return {};
  const none = process.env.NO_PROXY || '';
  // Node's fetch ignores the proxy variables unless told; the slot has no other way out
  return { HTTPS_PROXY: proxy, https_proxy: proxy, HTTP_PROXY: proxy, http_proxy: proxy, NO_PROXY: none, no_proxy: none, NODE_USE_ENV_PROXY: '1' };
}

function runJob(work, job) {
  const env = {
    HOME, PATH: process.env.PATH, LANG: 'C.UTF-8',
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1',
    ACTIONS_RUNNER_HOOK_JOB_STARTED: HOOK,
    CW_SLOT_REPO: job.repo,
    CW_SLOT_ACTORS: (job.actors || []).join(','),
    // the image's own policy: a lane the sandbox cannot confine is refused, never run unconfined
    CW_SANDBOX: process.env.CW_SANDBOX || 'require',
    CW_SKIP_SETUP: '1',
    ...proxyEnv(),
  };
  const child = spawn(`${work}/runner/run.sh`, ['--jitconfig', job.jit], { cwd: `${work}/runner`, uid: JOB_UID, gid: JOB_UID, env, stdio: 'inherit' });
  return new Promise((done) => child.on('exit', (code, signal) => done({ code, signal })));
}

/** The slot's identity, read first in main; the secret leaves this process's environment on read. */
function takeSlotEnv(env = process.env) {
  const id = env.CW_SLOT_ID || '';
  const secret = env.CW_SLOT_SECRET || '';
  delete env.CW_SLOT_SECRET;
  return { id, secret };
}

async function main() {
  const { id, secret } = takeSlotEnv();
  slotId = id;
  const work = process.env.CW_SLOT_WORK || '/work';
  const url = process.env.CW_SLOT_CLAIM_URL;
  if (!existsSync(work)) { log('refused', { reason: `work volume ${work} is missing` }); return 4; }
  if (!url || !slotId || !secret) { log('refused', { reason: 'CW_SLOT_CLAIM_URL, CW_SLOT_ID and CW_SLOT_SECRET are required' }); return 3; }
  log('prepared', { removedEntries: await prepare(work) });
  let job;
  try {
    job = await claimJob({ url, secret, slotId, boot });
  } catch (e) {
    if (!(e instanceof ClaimRefused)) throw e;
    log('refused', { reason: e.message });
    return 3;
  }
  log('claimed', { runnerName: job.runnerName, repo: job.repo, jobId: job.jobId });
  const started = Date.now();
  const { code, signal } = await runJob(work, job);
  const report = { code, signal, wallSec: (Date.now() - started) / 1000, leftovers: killAll(JOB_UID), totals: cgroupTotals() };
  log('finished', { ...report, reported: await reportJob({ url, secret, slotId, boot, report }) });
  return code === 0 ? 0 : 1;
}

process.exitCode = await main();
