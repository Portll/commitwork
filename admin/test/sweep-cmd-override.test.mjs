// CW_SWEEP_CMD replaces the sweep's argv, and the picker's selection used to vanish with it: the job
// was labelled with the project while the command never heard of it. The override now receives the
// selection in env, never as argv it did not ask for, and the feed says the override is in effect.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initJobs, jobArgv, sweepOverride, trigger, jobs, jobSubs } from '../lib/jobs.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-sweep-override-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.CW_SWEEP_LIVE_LOG = join(TMP, 'sweep-latest.log');
initJobs({
  CW: TMP, registry: () => ({ areas: [{ slug: 'client-a' }] }), sessionStorePath: () => join(TMP, 'sessions.json'),
  projectSlug: (s) => s, primaryArea: () => null,
});

// Prints what it was handed, and nothing else: a stand-in for any command an operator pins.
const EMITTER = join(TMP, 'emitter.mjs');
writeFileSync(EMITTER, `console.log('EMIT ' + JSON.stringify({ argv: process.argv.slice(2),
  project: process.env.CW_SWEEP_PROJECT, check: process.env.CW_SWEEP_CHECK, repo: process.env.CW_SWEEP_REPO }));\n`);

const withEnv = (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

const finished = (kind) => new Promise((resolve) => {
  const sub = (k, p) => { if (k === kind && p.status && !p.status.running) { jobSubs.delete(sub); resolve(); } };
  jobSubs.add(sub);
});

test('without the override there is nothing to report, and the selection is in argv', () => {
  withEnv({ CW_SWEEP_CMD: '' }, () => {
    assert.equal(sweepOverride('client-a', { check: 'secrets' }), null);
    assert.deepEqual(jobArgv('sweep', 'client-a', { check: 'secrets' }).slice(2), ['secrets', 'client-a']);
  });
});

test('the override is spawned as configured, receives the selection in env, and the feed says so', async () => {
  const done = finished('sweep');
  const r = withEnv({ CW_SWEEP_CMD: `"${process.execPath}" "${EMITTER}"`, CW_SWEEP_REPO: 'inherited-stale' },
    () => trigger('sweep', 'client-a', { check: 'secrets' }));
  assert.deepEqual(r, { started: true });
  await done;
  const lines = jobs.sweep.lines;
  const emitted = lines.find((l) => l.startsWith('EMIT '));
  assert.ok(emitted, `the emitter never ran:\n${lines.join('\n')}`);
  assert.deepEqual(JSON.parse(emitted.slice(5)), { argv: [], project: 'client-a', check: 'secrets', repo: '' },
    'no argv appended; the selection in env; an inherited CW_SWEEP_REPO does not pose as this run\'s');
  const notice = lines.findIndex((l) => l.includes('CW_SWEEP_CMD override in effect'));
  assert.ok(notice > -1, 'the feed must say the override is in effect');
  assert.match(lines[notice], /CW_SWEEP_PROJECT=client-a CW_SWEEP_CHECK=secrets CW_SWEEP_REPO=\(none\)/);
  assert.ok(notice < lines.indexOf(emitted), 'the notice precedes the command\'s own output');
  assert.equal(jobs.sweep.project, 'client-a');
});
