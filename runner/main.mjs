// The dispatcher process in portll-stack. Every pollSec it gathers the declared repos, decides and
// executes; it serves the slots' claim port on every network it is on, and the read-only stack API
// on the control subnet only, so a job network never reaches the API.
//   env, read at start: CW_RUNNER_CONFIG, CW_RUNNER_TOKEN_FILE, CW_SLOT_SECRETS_FILE,
//     CW_STACK_API_TOKEN_FILE, CW_RUNNER_LEDGER, CW_STACK_IDS, CW_CONTROL_SUBNET,
//     CW_CLAIM_PORT (7090), CW_STACK_API_PORT (7091)
// exit: 0 on SIGTERM · 2 a required setting is missing or unreadable
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';
import { createStackApi, hostOnSubnet } from './api.mjs';
import { createClaims } from './claim.mjs';
import { loadConfig } from './config.mjs';
import { execute } from './execute.mjs';
import { createGithub } from './github.mjs';
import { openLedger } from './ledger.mjs';
import { createMeter } from './meter.mjs';
import { poll } from './poll.mjs';

const log = (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

function setting(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
const fileSetting = (name) => readFileSync(setting(name), 'utf8').trim();

/** One tick, never throwing past a defect report: a failed tick waits for the next one. */
async function tick({ gh, config, claims, ledger }) {
  try {
    const { actions } = await poll({ gh, config, freeSlots: claims.freeSlots() });
    const out = await execute(actions, { gh, claims, ledger });
    if (actions.some((a) => a.kind !== 'record') || out.failed.length) log('tick', out);
  } catch (e) {
    log('tick-defect', { message: e.message, stack: e.stack });
  }
}

export async function start() {
  const config = loadConfig({ path: setting('CW_RUNNER_CONFIG') });
  const gh = createGithub({ token: fileSetting('CW_RUNNER_TOKEN_FILE'), fetch });
  const ledger = openLedger(setting('CW_RUNNER_LEDGER'));
  const claims = createClaims({
    secrets: JSON.parse(fileSetting('CW_SLOT_SECRETS_FILE')),
    onReport: (r) => { ledger.jobFinished(r); log('job-finished', { runnerName: r.runnerName, repo: r.repo, code: r.code, wallSec: r.wallSec }); },
  });
  const claimServer = createServer((req, res) => claims.handle(req, res).catch(() => res.destroy()));
  await new Promise((r) => claimServer.listen(Number(process.env.CW_CLAIM_PORT || 7090), '0.0.0.0', r));
  const meter = createMeter({ idsPath: setting('CW_STACK_IDS') });
  meter.start();
  const api = createStackApi({
    ledger, meter, slots: claims.states,
    token: fileSetting('CW_STACK_API_TOKEN_FILE'),
    host: hostOnSubnet(setting('CW_CONTROL_SUBNET')),
    port: Number(process.env.CW_STACK_API_PORT || 7091),
  });
  const apiAt = await api.listen();
  log('started', { repos: config.repos.map((r) => r.repo), slots: config.slots.map((s) => s.id), api: apiAt, pollSec: config.pollSec });

  let timer = null;
  let stopping = false;
  const loop = async () => {
    await tick({ gh, config, claims, ledger });
    if (!stopping) timer = setTimeout(loop, config.pollSec * 1000);
  };
  loop();
  const stop = async () => {
    stopping = true;
    clearTimeout(timer);
    meter.stop();
    claimServer.closeAllConnections?.();
    await Promise.all([api.close(), new Promise((r) => claimServer.close(r))]);
    ledger.close();
    log('stopped');
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (isMainModule(import.meta.url)) {
  start().catch((e) => { log('refused', { reason: e.message }); process.exitCode = 2; });
}
