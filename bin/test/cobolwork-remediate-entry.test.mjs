// bin/cobolwork-remediate.mjs as a process, against a job store in tmp (--dir or
// CW_COBOLWORK_REMEDIATION_DIR) and the remediation policy pointed at an absent file. Only the paths
// that need no model, no cobolwork binary and no network are driven: usage errors (exit 2), the
// report-mode refusal that stops a draft before any engine is resolved, `list` over a real store
// (orphaned and unreadable jobs named as such), and apply/verify refusing a job in the wrong state
// without writing to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobIdFor } from '../../lib/cobolwork-remediation.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'cobolwork-remediate.mjs');
const FP = 'a'.repeat(32);

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cobol-remediate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'ledger-batch'); mkdirSync(repo);
  return { dir, repo, jobs: join(dir, 'jobs'), policy: join(dir, 'no-policy.json') };
}

function cli(s, args, extraEnv = {}) {
  const env = { ...process.env, CW_REMEDIATION_POLICY: s.policy, CW_COBOLWORK_REMEDIATION_DIR: s.jobs, ...extraEnv };
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, cwd: s.dir });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* usage paths print no JSON */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

const job = (id, fields) => ({ schema: 1, id, repo: 'ledger-batch', fingerprint: FP, attempts: [], events: [],
  verifications: [], final: null, applied: null, error: null, ...fields });
const seed = (s, j) => { mkdirSync(s.jobs, { recursive: true }); writeFileSync(join(s.jobs, `${j.id}.json`), JSON.stringify(j, null, 2)); };

test('usage errors exit 2 and name what is wrong', (t) => {
  const s = sandbox(t);
  const none = cli(s, []);
  assert.equal(none.code, 2);
  assert.match(none.err, /^usage: cobolwork-remediate draft\|apply\|verify --repo <path>/);
  assert.match(cli(s, ['list', '--bogus']).err, /cobolwork-remediate: unknown option --bogus/);
  assert.equal(cli(s, ['draft', '--repo']).code, 2);
  assert.match(cli(s, ['draft', '--repo']).err, /--repo needs a value/);
  assert.equal(cli(s, ['draft', '--fingerprint', FP]).code, 2, 'draft without --repo');
  const fp = cli(s, ['draft', '--repo', s.repo, '--fingerprint', 'not-hex']);
  assert.equal(fp.code, 2);
  assert.match(fp.err, /--fingerprint is the 32-hex cobolwork fingerprint/);
  const id = cli(s, ['apply', '--repo', s.repo, '--job', 'nothex']);
  assert.equal(id.code, 2);
  assert.match(id.err, /--job is a 16-hex job id/);
});

test('draft under the default (report-mode) policy is refused before any engine is resolved, and writes no job', (t) => {
  const s = sandbox(t);
  const r = cli(s, ['draft', '--repo', s.repo, '--fingerprint', FP]);
  assert.equal(r.code, 1, r.err);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /remediation policy is in report mode \(default\), which drafts nothing/);
  assert.equal(existsSync(s.jobs), false, 'a refused draft created the job store');
});

test('list over an absent store is an empty list, not an error', (t) => {
  const s = sandbox(t);
  const r = cli(s, ['list']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { ok: true, jobs: [] });
});

test('list names a cut-off running job as orphaned and an unparseable one as unreadable, newest first', (t) => {
  const s = sandbox(t);
  seed(s, job('0000000000000001', { state: 'lodged', updatedAt: '2026-03-01T00:00:00.000Z' }));
  seed(s, job('0000000000000002', { state: 'running', updatedAt: '2026-03-02T00:00:00.000Z' }));
  mkdirSync(s.jobs, { recursive: true });
  writeFileSync(join(s.jobs, '0000000000000003.json'), '{ "state": ');
  writeFileSync(join(s.jobs, 'notes.json'), '{}');   // not a job id: never listed
  const r = cli(s, ['list', '--dir', s.jobs], { CW_COBOLWORK_REMEDIATION_DIR: join(s.dir, 'elsewhere') });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.jobs.map((j) => [j.id, j.state]), [
    ['0000000000000002', 'orphaned'], ['0000000000000001', 'lodged'], ['0000000000000003', 'unreadable'],
  ]);
  assert.match(r.json.jobs[2].error, /job file does not parse/);
});

test('apply or verify on a job that is not in the store is exit 1 naming the id and the store', (t) => {
  const s = sandbox(t);
  for (const cmd of ['apply', 'verify']) {
    const r = cli(s, [cmd, '--repo', s.repo, '--job', 'feedfacecafebeef']);
    assert.equal(r.code, 1, cmd);
    assert.deepEqual(r.json, { ok: false, error: `no job feedfacecafebeef in ${s.jobs}` });
  }
});

test('apply refuses a job that is not lodged, and verify one that is not applied, without writing to it', (t) => {
  const s = sandbox(t);
  // --fingerprint + --name resolve the same id the panel route mints
  const id = jobIdFor('ledger-batch', FP);
  seed(s, job(id, { state: 'queued', updatedAt: '2026-03-01T00:00:00.000Z' }));
  const before = readFileSync(join(s.jobs, `${id}.json`), 'utf8');
  const apply = cli(s, ['apply', '--repo', s.repo, '--name', 'ledger-batch', '--fingerprint', FP]);
  assert.equal(apply.code, 1);
  assert.deepEqual(apply.json, { ok: false, conflict: true, error: 'the job is queued; only a lodged draft is applied' });
  const verify = cli(s, ['verify', '--repo', s.repo, '--job', id]);
  assert.equal(verify.code, 1);
  assert.deepEqual(verify.json, { ok: false, conflict: true, error: 'the job is queued; only an applied draft is verified' });
  assert.equal(readFileSync(join(s.jobs, `${id}.json`), 'utf8'), before, 'a refused apply/verify wrote to the job');
});

test('an unparseable job file is reported as unreadable, not as a missing job', (t) => {
  const s = sandbox(t);
  mkdirSync(s.jobs, { recursive: true });
  writeFileSync(join(s.jobs, 'feedfacecafebeef.json'), 'not json');
  const r = cli(s, ['apply', '--repo', s.repo, '--job', 'feedfacecafebeef']);
  assert.equal(r.code, 1);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /^job file does not parse: /);
});
