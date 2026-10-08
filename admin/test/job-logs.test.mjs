// One post-mortem log per panel job kind. Every kind used to write reports/sweep-latest.log and
// every start truncated it, so a health run launched mid-sweep erased the sweep's log and then
// interleaved into it. Driven through trigger() against fake runners in a scratch CW.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initJobs, jobArgv, jobLogPath, trigger, jobs } from '../lib/jobs.mjs';
import { AMBIENT_OUTPUTS, scopedOutputEnv } from '../../bin/test-run.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-job-logs-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
const CW = join(TMP, 'cw');
const GATE = join(TMP, 'gate');
const SWEEP_LOG = join(TMP, 'logs', 'sweep.log');
const JOB_DIR = join(TMP, 'job-logs');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.CW_SWEEP_LIVE_LOG = SWEEP_LOG;
process.env.CW_JOB_LOG_DIR = JOB_DIR;
delete process.env.CW_SWEEP_CMD;

// The sweep prints, then holds until the test opens the gate, so the health run starts mid-sweep.
mkdirSync(join(CW, 'monitor'), { recursive: true });
writeFileSync(join(CW, 'monitor', 'sweep.mjs'), `import { existsSync } from 'node:fs';
console.log('SWEEP first');
const t = setInterval(() => { if (existsSync(${JSON.stringify(GATE)})) { clearInterval(t); console.log('SWEEP last'); } }, 20);
setTimeout(() => process.exit(2), 10000).unref();\n`);
writeFileSync(join(CW, 'monitor', 'health-sweep.mjs'), "console.log('HEALTH ' + process.argv.slice(2).join(' '));\n");
initJobs({
  CW, registry: () => ({ areas: [{ slug: 'client-a' }] }), sessionStorePath: () => join(TMP, 'sessions.json'),
  projectSlug: (s) => s, primaryArea: () => null,
});

const until = async (what, pred, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (pred()) return;
  assert.fail(`timed out waiting for ${what}`);
};
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const KINDS = ['sweep', 'bola', 'stpa', 'install-tools', 'scan-path',
  'health-all', 'health-deadcode', 'health-toolchain', 'health-provenance', 'health-gates'];

test('a health run started mid-sweep neither truncates the sweep log nor writes into it', async () => {
  assert.deepEqual(trigger('sweep', 'client-a'), { started: true });
  await until('the sweep\'s first line', () => read(SWEEP_LOG).includes('SWEEP first'));
  assert.deepEqual(trigger('health-deadcode', 'client-a'), { started: true });
  await until('the health run to finish', () => jobs['health-deadcode'] && !jobs['health-deadcode'].running);
  writeFileSync(GATE, '');
  await until('the sweep to finish', () => !jobs.sweep.running);

  const sweep = read(SWEEP_LOG);
  const health = read(join(JOB_DIR, 'health-deadcode-latest.log'));
  assert.match(sweep, /\[serve\] starting: .*sweep\.mjs[\s\S]*SWEEP first[\s\S]*SWEEP last/, 'the sweep log survived whole');
  assert.doesNotMatch(sweep, /HEALTH/, 'the health run interleaved into the sweep log');
  assert.match(health, /\[serve\] starting: .*health-sweep\.mjs[\s\S]*HEALTH deadcode client-a/);
  assert.doesNotMatch(health, /SWEEP/);
  assert.ok(!read(process.env.CW_HEALTH_RUNS_STORE).includes('logPath'), 'the log path is not persisted with the run');
});

test('each kind has its own log, the sweep keeps its override, and env is read at call time', () => {
  const paths = KINDS.map((k) => { assert.ok(jobArgv(k, 'p', { path: '/x', out: '/o' }), `${k} is not a job kind`); return jobLogPath(k); });
  assert.equal(new Set(paths).size, KINDS.length, 'two kinds share a log');
  assert.equal(jobLogPath('sweep'), SWEEP_LOG);
  assert.equal(jobLogPath('bola'), join(JOB_DIR, 'bola-latest.log'));
  const saved = { s: process.env.CW_SWEEP_LIVE_LOG, d: process.env.CW_JOB_LOG_DIR };
  try {
    delete process.env.CW_SWEEP_LIVE_LOG; delete process.env.CW_JOB_LOG_DIR;
    assert.equal(jobLogPath('sweep'), join(CW, 'reports', 'sweep-latest.log'), 'the path monitor/ and the retention tests know');
    assert.equal(jobLogPath('health-all'), join(CW, 'reports', 'health-all-latest.log'));
  } finally { process.env.CW_SWEEP_LIVE_LOG = saved.s; process.env.CW_JOB_LOG_DIR = saved.d; }
});

test('the test runner scopes every log a job can write, and its self-check owns each file name', () => {
  const entry = AMBIENT_OUTPUTS.find((o) => o.env === 'CW_JOB_LOG_DIR');
  assert.ok(entry, 'bin/test-run.mjs does not register CW_JOB_LOG_DIR; a suite run would write job logs into reports/');
  assert.equal(entry.live, join(REPO, 'reports'));
  const saved = { s: process.env.CW_SWEEP_LIVE_LOG, d: process.env.CW_JOB_LOG_DIR };
  try {
    delete process.env.CW_SWEEP_LIVE_LOG; delete process.env.CW_JOB_LOG_DIR;
    for (const k of KINDS) assert.match(basename(jobLogPath(k)), entry.files, `${k}'s log is invisible to the self-check`);
    const scoped = scopedOutputEnv(join(TMP, 'scratch'), {});
    process.env.CW_SWEEP_LIVE_LOG = scoped.CW_SWEEP_LIVE_LOG; process.env.CW_JOB_LOG_DIR = scoped.CW_JOB_LOG_DIR;
    for (const k of KINDS) assert.ok(jobLogPath(k).startsWith(join(TMP, 'scratch')), `the scoping did not move ${k}'s log`);
  } finally { process.env.CW_SWEEP_LIVE_LOG = saved.s; process.env.CW_JOB_LOG_DIR = saved.d; }
});
