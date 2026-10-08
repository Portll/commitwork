// The STPA sweep's exit contract has three readers: its own CLI, the job runner's phase, and the
// panel's console title. Both callers are asserted against the EXIT the sweep exports, through the
// real job runner and a stand-in script, so an exit added there and not here fails this file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initJobs, trigger, jobs } from '../lib/jobs.mjs';
import { EXIT } from '../../monitor/stpa-sweep.mjs';
import { panelScript } from './lib/panel-source.mjs';

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-stpa-exit-')));
const CW = join(TMP, 'cw');
const CODE = join(TMP, 'exit-code');
const ENV = ['CW_JOB_LOG_DIR', 'CW_HEALTH_RUNS_STORE', 'CW_SCAN_PATH_OUT'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
after(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});
process.env.CW_JOB_LOG_DIR = join(TMP, 'job-logs');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.CW_SCAN_PATH_OUT = join(TMP, 'scan-out');
mkdirSync(join(CW, 'monitor'), { recursive: true });
writeFileSync(join(CW, 'monitor', 'stpa-sweep.mjs'),
  `import { readFileSync } from 'node:fs';\nprocess.exit(Number(readFileSync(${JSON.stringify(CODE)}, 'utf8')));\n`);
initJobs({ CW, registry: () => ({ areas: [], projects: [] }), sessionStorePath: () => join(TMP, 'sessions.json'),
  projectSlug: (s) => s, primaryArea: () => null });

const REPORTING = Object.entries(EXIT).filter(([name]) => name !== 'failed');

async function runExiting(code) {
  writeFileSync(CODE, String(code));
  assert.deepEqual(trigger('stpa', ''), { started: true });
  for (const end = Date.now() + 10000; jobs.stpa.running; await new Promise((r) => setTimeout(r, 20))) {
    if (Date.now() > end) assert.fail(`the stand-in sweep exiting ${code} never finished`);
  }
  return jobs.stpa;
}

test('every exit the sweep declares as a completed run finishes the job as done; a failed sweep does not', async () => {
  assert.ok(REPORTING.some(([name]) => name === 'unclassified'), 'the sweep no longer declares the unclassified exit this file exists for');
  for (const [name, code] of REPORTING) {
    const job = await runExiting(code);
    assert.equal(job.exitCode, code, name);
    assert.equal(job.phase, 'done', `exit ${code} (${name}) is a completed sweep reporting something, and the runner left it at "${job.phase}"`);
  }
  const failed = await runExiting(EXIT.failed);
  assert.equal(failed.exitCode, EXIT.failed);
  assert.notEqual(failed.phase, 'done', 'a sweep that could not run must not read as a completed one');
});

test('a sweep that never loaded is not a completed run: Node\'s own exits are not reporting exits', async () => {
  for (const code of [1, 4]) {
    assert.ok(!Object.values(EXIT).includes(code), `exit ${code} is Node's own and must not be a sweep verdict`);
    const job = await runExiting(code);
    assert.equal(job.exitCode, code);
    assert.notEqual(job.phase, 'done', `exit ${code} (a module that failed to load) read as a completed sweep`);
  }
});

test('the panel titles every completed exit and leaves a failed sweep to the generic "exited" line', () => {
  const table = /const STPA_EXIT=\{([\s\S]*?)\};/.exec(panelScript());
  assert.ok(table, 'STPA_EXIT is not in the panel client');
  const titled = [...table[1].matchAll(/(\d+):\[/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  assert.deepEqual(titled, REPORTING.map(([, code]) => code).sort((a, b) => a - b));
  assert.match(table[1], /24:\[[^\]]*unclassified closure point/);
});
