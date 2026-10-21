// Breakers N1 (compound-critical): the job-stream redactor stopped at the operator port, so a gh or
// git job that echoed its token streamed it in the clear on loopback. A declared token is now
// scrubbed at feed() — before lines[], the log file and every subscriber — on BOTH ports, and a
// kind that runs gh refuses to start until its token list is declared. Driven through the real
// runner against a stand-in create-pr script; a second, undeclared value streams in the clear as
// the control that the scrub is selective rather than the stream being empty.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initJobs, trigger, jobs, jobSubs, jobScope, jobStatusFor, redactorFor, jobLogPath } from '../lib/jobs.mjs';

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-job-token-')));
const CW = join(TMP, 'cw');
const ENV = ['CW_JOB_LOG_DIR', 'CW_HEALTH_RUNS_STORE', 'CW_SWEEP_CMD', 'STUB_LEAK'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
after(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});
process.env.CW_JOB_LOG_DIR = join(TMP, 'job-logs');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
delete process.env.CW_SWEEP_CMD;
mkdirSync(join(CW, 'bin'), { recursive: true });
writeFileSync(join(CW, 'bin', 'create-pr.mjs'), [
  "console.log('[stub] argv ' + JSON.stringify(process.argv.slice(2)));",
  "console.log('[stub] stdout token=' + process.env.GH_TOKEN);",
  "console.error('[stub] stderr HTTP 401: Bad credentials (' + process.env.GH_TOKEN + ')');",
  "console.log('[stub] leak=' + process.env.STUB_LEAK);",
].join('\n') + '\n');
initJobs({ CW, registry: () => ({ areas: [{ slug: 'alpha' }], projects: [{ name: 'acme', area: 'alpha' }] }),
  sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug: (s) => s, primaryArea: () => ({ slug: 'alpha' }) });

const TOKEN = 'ghp_SECRETsecretSECRET1234567890';
const LEAK = 'undeclared-value-stays-visible';
const OPTS = { repoPath: join(TMP, 'repo'), branch: 'commitwork/x-00000000', title: 't', bodyFile: join(TMP, 'b.md'), repo: 'acme' };
const until = async (what, pred, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (pred()) return;
  assert.fail(`timed out waiting for ${what}`);
};
const loopback = jobScope({ project: 'alpha', operator: true });
const remote = jobScope({ project: 'alpha', operator: false });

test('a create-pr job refuses to start until its token list is declared', () => {
  const r = trigger('create-pr', 'alpha', OPTS);
  assert.equal(r.started, false);
  assert.equal(r.refused, true);
  assert.match(r.reason, /token list must be declared/);
  assert.equal(jobs['create-pr'], undefined, 'nothing was spawned');
});

test('the declared token is scrubbed on loopback AND the public port, in lines, the log and the stream; an undeclared value is not', async () => {
  process.env.STUB_LEAK = LEAK;
  const streamed = [];
  const sub = (k, p) => { if (k === 'create-pr' && p.line !== undefined) streamed.push(p.line); };
  jobSubs.add(sub);
  try {
    assert.deepEqual(trigger('create-pr', 'alpha', { ...OPTS, tokens: [TOKEN] }), { started: true });
    await until('create-pr to finish', () => !jobs['create-pr'].running);
  } finally { jobSubs.delete(sub); }
  for (const [name, scope] of [['loopback', loopback], ['public', remote]]) {
    const st = jobStatusFor('create-pr', scope);
    assert.ok(st, `${name} sees its own project's job`);
    const text = st.lines.join('\n');
    assert.doesNotMatch(text, new RegExp(TOKEN), `${name}: the token never reaches the console`);
    assert.match(text, /stdout token=\[redacted: credential\]/, `${name}: the child DID receive the token (stdout)`);
    assert.match(text, /Bad credentials \(\[redacted: credential\]\)/, `${name}: stderr is scrubbed too`);
    assert.match(text, new RegExp(`leak=${LEAK}`), `${name}: control — an undeclared value streams in the clear, so the scrub is selective`);
    assert.doesNotMatch(st.lines[0], new RegExp(TOKEN), 'the [serve] starting line carries argv, which never holds the token');
    assert.match(st.lines[0], /--body-file/, 'the body travels as a file path, not as text');
  }
  assert.doesNotMatch(readFileSync(jobLogPath('create-pr'), 'utf8'), new RegExp(TOKEN), 'the post-mortem log never holds it');
  assert.ok(streamed.length >= 4, 'subscribers saw the lines');
  assert.doesNotMatch(streamed.join('\n'), new RegExp(TOKEN), 'no subscriber ever received it');
});

test('redactorFor: a token is redacted for every scope, a scan-path secret only off the operator port', () => {
  jobs['create-pr'].secrets = ['/Users/op/private-path'];
  const op = redactorFor('create-pr', loopback), pub = redactorFor('create-pr', remote);
  const s = `path /Users/op/private-path token ${TOKEN}`;
  assert.equal(op(s), 'path /Users/op/private-path token [redacted: credential]');
  assert.equal(pub(s), 'path [redacted: shown on the operator port] token [redacted: credential]');
  jobs['create-pr'].secrets = [];
});

test('a token shorter than eight characters is not declared, so a trivially short value cannot blank the stream', () => {
  assert.deepEqual(trigger('create-pr', 'alpha', { ...OPTS, tokens: ['abc'] }).started, true);
  assert.deepEqual(jobs['create-pr'].tokens, []);
});
