// POST /api/issue/pr (gate W2, bifocal H3/H4/H11): operator port only with the issue-detail wording,
// a registered repository path only, a deterministic commitwork/ branch named from the group key,
// a body with places and fixes and no evidence, the credential redacted out of it, a secrets-lane
// group refused outright, and the job started with its token DECLARED. The last test drives the
// real runner and the real bin/create-pr.mjs against a stub gh that echoes the token into its
// failure, and reads the loopback stream: the token is absent there.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, branchFor, composeBody, SECRETS_LANES, TOKEN_NAME } from '../routes/pull-request.mjs';
import { LOCAL_ONLY } from '../routes/issue-detail.mjs';
import { groupKeyFor } from '../../monitor/feed-groups.mjs';
import { initJobs, trigger as realTrigger, jobs, jobScope, jobStatusFor, jobLogPath } from '../lib/jobs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-pr-route-')));
const KEYS = ['CW_REGISTRY', 'CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE', 'CW_SECRETS_FILE', 'CW_PR_BODY_DIR', 'CW_FEATURE_PULL_REQUEST', 'CW_EXPERIMENTAL',
  'CW_JOB_LOG_DIR', 'CW_HEALTH_RUNS_STORE', 'CW_SWEEP_CMD', 'CW_GH_BIN', 'GH_TOKEN', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'STUB_CREATE_FAIL', 'STUB_LOGIN', 'STUB_LOG'];
const saved = {};
const OUT = join(TMP, 'reports', 'fixarea');
const BARE = join(TMP, 'origin.git'), REPO = join(TMP, 'repo'), GH = join(TMP, 'gh.mjs'), BODIES = join(TMP, 'pr-bodies');
const TOKEN = 'ghp_ROUTEtokenROUTEtoken0123456789';
const SAST = { repo: 'fixrepo', rule: 'js/sql-injection', file: 'src/db.js', line: 10, sev: 'high', message: `tainted by ${TOKEN} in the query` };
const ROLLUP = {
  generated: '2026-10-08T00:00:00.000Z', sliceId: 'sweep-20261008000000-fixarea',
  scannerFindings: {
    sastSemgrep: [SAST, { ...SAST, line: 44 }],
    depsGo: [{ repo: 'fixrepo', id: 'GHSA-1', package: 'left-pad', version: '1.0.0', fixed: '1.3.0', sev: 'crit', kev: true, message: 'advisory' }],
    secrets: [{ repo: 'fixrepo', rule: 'aws-key', file: 'config.js', line: 3, sev: 'crit', message: 'AKIA…' }],
    sastGo: [{ repo: 'otherrepo', rule: 'G101', file: 'main.go', line: 1, sev: 'med', message: 'x' }],
  },
};
const KEY = groupKeyFor('sastSemgrep', SAST).key;
const REGISTRY = {
  reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea', defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: REPO, manifest: 'security-baseline' }],
  areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

before(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  mkdirSync(OUT, { recursive: true }); mkdirSync(BARE, { recursive: true }); mkdirSync(REPO, { recursive: true });
  writeFileSync(join(OUT, 'rollup.json'), JSON.stringify(ROLLUP));
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify(REGISTRY));
  writeFileSync(join(TMP, 'secret.toml'), `${TOKEN_NAME} = "${TOKEN}"\n`);
  writeFileSync(join(TMP, 'secrets.json'), JSON.stringify({ secrets: { [TOKEN_NAME]: `file:${join(TMP, 'secret.toml')}#${TOKEN_NAME}` } }));
  writeFileSync(GH, [
    "import { appendFileSync } from 'node:fs';",
    'const a = process.argv.slice(2), e = process.env;',
    "if (e.STUB_LOG) appendFileSync(e.STUB_LOG, JSON.stringify({ a, token: e.GH_TOKEN || null }) + '\\n');",
    "const cmd = a.slice(0, 2).join(' ');",
    "if (cmd === 'api user') console.log('tester');",
    "else if (cmd === 'pr list') console.log('[]');",
    "else if (cmd === 'pr create') { console.error('HTTP 401: Bad credentials (' + e.GH_TOKEN + ')'); process.exit(1); }",
    "else if (cmd === 'auth git-credential') {}",
    "else { console.error('stub gh: ' + cmd); process.exit(2); }",
  ].join('\n') + '\n');
  git(BARE, 'init', '--bare', '-q', '-b', 'main');
  git(REPO, 'init', '-q', '-b', 'main');
  writeFileSync(join(REPO, 'src.js'), 'one\n');
  git(REPO, 'add', 'src.js'); git(REPO, 'commit', '-q', '-m', 'first');
  git(REPO, 'remote', 'add', 'origin', BARE);
  git(REPO, 'push', '-q', '-u', 'origin', 'main');
  git(REPO, 'remote', 'set-head', 'origin', 'main');
  writeFileSync(join(REPO, 'src.js'), 'fixed\n');
  git(REPO, 'commit', '-q', '-am', 'fix');
  process.env.CW_REGISTRY = join(TMP, 'projects.json');
  process.env.CW_ISSUES = join(TMP, 'issues.json');
  process.env.CW_SECRETS_FILE = join(TMP, 'secrets.json');
  process.env.CW_PR_BODY_DIR = BODIES;
  process.env.CW_JOB_LOG_DIR = join(TMP, 'job-logs');
  process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
  process.env.CW_GH_BIN = GH;
  process.env.STUB_LOG = join(TMP, 'gh.log');
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const PR = routes.find((r) => r.method === 'POST' && r.path === '/api/issue/pr');
const call = (body, { loopback = true, trigger = () => ({ started: true }) } = {}) => new Promise((resolve) => PR.handle({
  req: {}, isLoopbackReq: loopback, adminSession: () => ({ user: 'op@example.test', provider: 'password' }),
  query: new URLSearchParams(), knownProjects: () => new Set(['fixarea']), readJsonBody: (_r, cb) => cb(body, null), trigger,
  send: (code, payload) => resolve({ code, payload }),
}));
const recording = () => { const calls = []; return { calls, trigger: (kind, project, opts) => { calls.push({ kind, project, opts }); return { started: true }; } }; };

test('off the operator port it refuses with the issue-detail wording, and the feature flag can switch it off', async () => {
  const rec = recording();
  const r = await call({ project: 'fixarea', key: KEY }, { loopback: false, trigger: rec.trigger });
  assert.equal(r.code, 403);
  assert.deepEqual(r.payload, LOCAL_ONLY);
  process.env.CW_FEATURE_PULL_REQUEST = 'off';
  try {
    const off = await call({ project: 'fixarea', key: KEY }, { trigger: rec.trigger });
    assert.equal(off.code, 404); assert.equal(off.payload.featureOff, true); assert.equal(off.payload.flag, 'pull-request');
  } finally { delete process.env.CW_FEATURE_PULL_REQUEST; }
  assert.equal(rec.calls.length, 0);
});

test('a bad project, a missing key, an unknown group, an unregistered repository and a secrets lane each refuse before anything runs', async () => {
  const rec = recording();
  assert.equal((await call({ project: 'nope', key: KEY }, rec)).code, 400);
  assert.equal((await call({ project: 'fixarea' }, rec)).code, 400);
  assert.equal((await call({ project: 'fixarea', key: 'no\u0000such\u0000group' }, rec)).code, 404);
  const other = await call({ project: 'fixarea', key: groupKeyFor('sastGo', ROLLUP.scannerFindings.sastGo[0]).key }, rec);
  assert.equal(other.code, 409); assert.match(other.payload.error, /not resolvable from the registry/);
  const sec = await call({ project: 'fixarea', key: groupKeyFor('secrets', ROLLUP.scannerFindings.secrets[0]).key }, rec);
  assert.equal(sec.code, 403); assert.equal(sec.payload.refused, true); assert.match(sec.payload.error, /rotating the credential/);
  assert.ok(SECRETS_LANES.includes('secrets-gitleaks'));
  assert.equal(rec.calls.length, 0, 'no job was started by any refusal');
  assert.ok(!existsSync(BODIES) || readdirSync(BODIES).length === 0, 'no body file was written by any refusal');
});

test('the happy path starts create-pr with the token DECLARED, a deterministic branch, and a body holding places and fixes but no evidence or credential', async () => {
  const rec = recording();
  const r = await call({ project: 'fixarea', key: KEY }, rec);
  assert.equal(r.code, 202, JSON.stringify(r.payload));
  assert.equal(r.payload.kind, 'create-pr');
  assert.equal(r.payload.branch, branchFor(KEY));
  assert.match(r.payload.branch, /^commitwork\/fixrepo-sastsemgrep-js-sql-injection-[0-9a-f]{8}$/);
  assert.equal(r.payload.identity, `the declared ${TOKEN_NAME}`);
  assert.match(r.payload.note, /merging stays human/);
  assert.equal(rec.calls.length, 1);
  const { kind, project, opts } = rec.calls[0];
  assert.equal(kind, 'create-pr'); assert.equal(project, 'fixarea');
  assert.equal(opts.repoPath, REPO, 'the registry path, never a caller string');
  assert.deepEqual(opts.tokens, [TOKEN], 'declared to the runner so the stream can be scrubbed');
  assert.equal(opts.branch, branchFor(KEY));
  assert.equal((await call({ project: 'fixarea', key: KEY }, rec)).payload.branch, opts.branch, 'the same group names the same branch');
  const body = readFileSync(opts.bodyFile, 'utf8');
  assert.match(body, /src\/db\.js/); assert.match(body, /js\/sql-injection/);
  assert.doesNotMatch(body, /tainted/, 'no finding message');
  assert.doesNotMatch(body, /:10\b|:44\b|line/, 'no line numbers');
  assert.doesNotMatch(body, new RegExp(TOKEN), 'the credential is redacted out of the body');
  const dep = composeBody({ project: 'p', lane: 'depsGo', subject: 'left-pad', repo: 'fixrepo', members: [{ lane: 'depsGo', sev: 'crit', row: ROLLUP.scannerFindings.depsGo[0] }] });
  assert.match(dep, /left-pad@1\.0\.0 → 1\.3\.0/); assert.match(dep, /KEV/);
});

test('a job that does not start is a 409 carrying the runner\'s reason', async () => {
  const r = await call({ project: 'fixarea', key: KEY }, { trigger: () => ({ started: false, reason: 'already running' }) });
  assert.equal(r.code, 409); assert.equal(r.payload.error, 'already running');
});

test('END TO END: the real runner streams a stub gh that echoes the token into its failure, and the token is absent on loopback', async () => {
  initJobs({ CW: ROOT, registry: () => REGISTRY, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug: (s) => s, primaryArea: () => ({ slug: 'fixarea' }) });
  const r = await call({ project: 'fixarea', key: KEY }, { trigger: realTrigger });
  assert.equal(r.code, 202, JSON.stringify(r.payload));
  for (const end = Date.now() + 15000; jobs['create-pr'] && jobs['create-pr'].running && Date.now() < end;) await new Promise((res) => setTimeout(res, 25));
  assert.ok(jobs['create-pr'] && !jobs['create-pr'].running, 'the job finished');
  const gh = readFileSync(join(TMP, 'gh.log'), 'utf8');
  assert.match(gh, new RegExp(`"token":"${TOKEN}"`), 'gh received the declared token through the environment');
  const bare = spawnSync('git', ['-C', BARE, 'rev-parse', '--verify', '-q', `refs/heads/${r.payload.branch}`], { encoding: 'utf8' });
  assert.equal(bare.status, 0, 'HEAD was pushed to the commitwork/ branch before gh was asked');
  for (const [name, scope] of [['loopback', jobScope({ project: 'fixarea', operator: true })], ['public', jobScope({ project: 'fixarea', operator: false })]]) {
    const st = jobStatusFor('create-pr', scope);
    assert.ok(st, `${name} sees the job`);
    const text = st.lines.join('\n');
    assert.match(text, /Bad credentials \(\[redacted: credential\]\)/, `${name}: the failure line was scrubbed, not dropped`);
    assert.doesNotMatch(text, new RegExp(TOKEN), `${name}: the token never reaches the console`);
  }
  assert.doesNotMatch(readFileSync(jobLogPath('create-pr'), 'utf8'), new RegExp(TOKEN));
  assert.equal(jobs['create-pr'].exitCode, 22, 'a failed gh is a broken run, not a reported one');
});
