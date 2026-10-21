// bin/create-pr.mjs: the proposal path. A commitwork/ branch is pushed from HEAD and the default
// branch is never touched; a dirty tree, nothing ahead of origin, no gh identity or a bare branch
// name is a refusal with its reason, not a push. Against a bare origin and a stub gh that records
// every call and names its login.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPr, validBranch, EXIT_REFUSED, EXIT_FAILED } from '../create-pr.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'create-pr.mjs');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-create-pr-')));
const BARE = join(TMP, 'origin.git'), REPO = join(TMP, 'repo'), BODY = join(TMP, 'body.md'), LOG = join(TMP, 'gh.log');
const GH = join(TMP, 'gh.mjs');
const TOKEN = 'ghp_TESTtokenTESTtoken0123456789';
const base = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GH_TOKEN', 'CW_GH_BIN']) delete base[k];
const env = (over = {}) => ({ ...base, CW_GH_BIN: GH, STUB_LOG: LOG, STUB_LOGIN: 'tester', ...over });
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: base });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const calls = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const reset = () => { rmSync(LOG, { force: true }); };
const bareRef = (ref) => { const r = spawnSync('git', ['-C', BARE, 'rev-parse', '--verify', '-q', ref], { encoding: 'utf8', env: base }); return r.status === 0 ? r.stdout.trim() : null; };
let FIRST;

before(() => {
  writeFileSync(GH, [
    "import { appendFileSync } from 'node:fs';",
    'const a = process.argv.slice(2), e = process.env;',
    "appendFileSync(e.STUB_LOG, JSON.stringify({ a, token: e.GH_TOKEN || null }) + '\\n');",
    "const cmd = a.slice(0, 2).join(' ');",
    "if (cmd === 'api user') { if (e.STUB_LOGIN) console.log(e.STUB_LOGIN); else { console.error('not logged in'); process.exit(1); } }",
    "else if (cmd === 'pr list') console.log(e.STUB_EXISTING || '[]');",
    "else if (cmd === 'pr create') { if (e.STUB_CREATE_FAIL) { console.error('HTTP 401: Bad credentials (' + e.GH_TOKEN + ')'); process.exit(1); } console.log('https://github.test/acme/widgets/pull/7'); }",
    "else if (cmd === 'repo view') console.log(e.STUB_DEFAULT || '');",
    "else if (cmd === 'auth git-credential') {}",
    "else { console.error('stub gh: ' + cmd); process.exit(2); }",
  ].join('\n') + '\n');
  mkdirSync(BARE, { recursive: true }); mkdirSync(REPO, { recursive: true });
  git(BARE, 'init', '--bare', '-q', '-b', 'main');
  git(REPO, 'init', '-q', '-b', 'main');
  writeFileSync(join(REPO, 'a.txt'), 'one\n');
  git(REPO, 'add', 'a.txt'); git(REPO, 'commit', '-q', '-m', 'first');
  git(REPO, 'remote', 'add', 'origin', BARE);
  git(REPO, 'push', '-q', '-u', 'origin', 'main');
  git(REPO, 'remote', 'set-head', 'origin', 'main');
  FIRST = git(REPO, 'rev-parse', 'HEAD');
  writeFileSync(BODY, 'proposal body\n');
});
after(() => rmSync(TMP, { recursive: true, force: true }));

const BRANCH = 'commitwork/fixrepo-sastsemgrep-js-sql-injection-0123abcd';
const args = (over = {}) => ({ repo: REPO, branch: BRANCH, title: 'commitwork: a fix', bodyFile: BODY, env: env(), ...over });

test('a branch outside commitwork/ or shaped like anything but a plain ref is refused before git runs', () => {
  assert.match(validBranch('main'), /must start with commitwork\//);
  assert.match(validBranch('commitwork/a..b'), /plain ref/);
  assert.match(validBranch('commitwork/a/'), /plain ref/);
  assert.equal(validBranch(BRANCH), null);
  reset();
  const r = createPr(args({ branch: 'main' }));
  assert.equal(r.state, 'refused'); assert.equal(r.code, EXIT_REFUSED);
  assert.deepEqual(calls(), [], 'gh was never called');
});

test('nothing ahead of origin is refused, and so is a dirty tree; neither pushes', () => {
  reset();
  const clean = createPr(args());
  assert.equal(clean.state, 'refused'); assert.match(clean.reason, /nothing to propose/);
  writeFileSync(join(REPO, 'a.txt'), 'two\n');
  const dirty = createPr(args());
  assert.equal(dirty.state, 'refused'); assert.match(dirty.reason, /uncommitted changes/);
  git(REPO, 'checkout', '-q', '--', 'a.txt');
  assert.equal(bareRef(`refs/heads/${BRANCH}`), null, 'no branch reached the origin');
  assert.ok(calls().every((c) => c.a[0] !== 'pr'), 'no pr call was made');
});

test('with a commit ahead: HEAD is pushed to the commitwork/ branch, main is untouched, the PR opens as the named identity', () => {
  writeFileSync(join(REPO, 'a.txt'), 'fixed\n');
  git(REPO, 'commit', '-q', '-am', 'fix');
  const head = git(REPO, 'rev-parse', 'HEAD');
  reset();
  const r = createPr(args({ env: env({ GH_TOKEN: TOKEN }) }));
  assert.equal(r.state, 'opened', JSON.stringify(r));
  assert.equal(r.code, 0);
  assert.equal(r.url, 'https://github.test/acme/widgets/pull/7');
  assert.equal(r.base, 'main');
  assert.equal(r.identity, 'tester via the declared GH_TOKEN');
  assert.equal(bareRef(`refs/heads/${BRANCH}`), head, 'the proposal branch is HEAD');
  assert.equal(bareRef('refs/heads/main'), FIRST, 'the default branch was never pushed');
  const create = calls().find((c) => c.a[0] === 'pr' && c.a[1] === 'create');
  assert.ok(create, 'gh pr create ran');
  assert.deepEqual(create.a.slice(2, 6), ['--head', BRANCH, '--base', 'main']);
  assert.ok(create.a.includes('--body-file') && create.a.includes(BODY));
  assert.equal(create.token, TOKEN, 'the token reached gh through the environment');
});

test('an open PR for the branch is reported, not duplicated; without GH_TOKEN the identity says ambient', () => {
  reset();
  const r = createPr(args({ env: env({ STUB_EXISTING: '[{"number":3,"url":"https://github.test/acme/widgets/pull/3"}]' }) }));
  assert.equal(r.state, 'existing');
  assert.equal(r.url, 'https://github.test/acme/widgets/pull/3');
  assert.equal(r.identity, "tester via gh's own login (ambient)");
  assert.ok(!calls().some((c) => c.a[0] === 'pr' && c.a[1] === 'create'), 'no second PR');
});

test('gh with no identity is a refusal before any push', () => {
  reset();
  git(REPO, 'push', '-q', 'origin', `:refs/heads/${BRANCH}`);
  const r = createPr(args({ env: env({ STUB_LOGIN: '' }) }));
  assert.equal(r.state, 'refused'); assert.match(r.reason, /no identity/);
  assert.equal(bareRef(`refs/heads/${BRANCH}`), null);
});

test('the CLI exits 21 on a refusal, 22 on a failed command (whose stderr it repeats — the job runner is what scrubs it), 0 when opened', () => {
  const run = (over, extra = []) => spawnSync(process.execPath, [CLI, '--repo', REPO, '--branch', BRANCH, '--title', 't', '--body-file', BODY, ...extra], { encoding: 'utf8', env: env(over) });
  const refused = run({}, ['--branch', 'main']);
  assert.equal(refused.status, EXIT_REFUSED, refused.stdout + refused.stderr);
  assert.match(refused.stdout, /\[create-pr\] result \{"state":"refused"/);
  const failed = run({ GH_TOKEN: TOKEN, STUB_CREATE_FAIL: '1' });
  assert.equal(failed.status, EXIT_FAILED, failed.stdout + failed.stderr);
  assert.match(failed.stdout, new RegExp(`Bad credentials \\(${TOKEN}\\)`), 'the script itself does not redact: that is admin/lib/jobs.mjs feed()');
  const opened = run({ GH_TOKEN: TOKEN });
  assert.equal(opened.status, 0, opened.stdout + opened.stderr);
  assert.match(opened.stdout, /\[create-pr\] opened: https:\/\/github\.test/);
});
