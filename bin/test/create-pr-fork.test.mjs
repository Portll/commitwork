// bin/create-pr.mjs --draft and --upstream: the draft flag reaches gh only when asked for, and an
// upstream PR goes through the gh identity's fork, made when missing, never through origin. Against
// bare repositories standing in for the upstream and the fork, and a stub gh that records every call.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPr } from '../create-pr.mjs';

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-create-pr-fork-')));
const UP = join(TMP, 'upstream.git'), HOST = join(TMP, 'host'), FORK = join(HOST, 'tester', 'widgets.git');
const REPO = join(TMP, 'repo'), BODY = join(TMP, 'body.md'), LOG = join(TMP, 'gh.log'), GH = join(TMP, 'gh.mjs');
const FORKED = join(TMP, 'forked');
const BRANCH = 'commitwork/deps/go-2026-0001';
const base = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GH_TOKEN', 'CW_GH_BIN']) delete base[k];
const env = (over = {}) => ({ ...base, CW_GH_BIN: GH, CW_GIT_HOST_URL: HOST, STUB_LOG: LOG, STUB_FORKED: FORKED, STUB_LOGIN: 'tester', ...over });
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: base });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const calls = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).a) : []);
const reset = () => { rmSync(LOG, { force: true }); rmSync(FORKED, { force: true }); };
const refIn = (bare, ref) => { const r = spawnSync('git', ['-C', bare, 'rev-parse', '--verify', '-q', ref], { encoding: 'utf8', env: base }); return r.status === 0 ? r.stdout.trim() : null; };
const args = (over = {}) => ({ repo: REPO, branch: BRANCH, title: 'deps: clear GO-2026-0001', bodyFile: BODY, env: env(), ...over });

before(() => {
  writeFileSync(GH, [
    "import { appendFileSync, existsSync, writeFileSync } from 'node:fs';",
    'const a = process.argv.slice(2), e = process.env;',
    "appendFileSync(e.STUB_LOG, JSON.stringify({ a }) + '\\n');",
    "const cmd = a.slice(0, 2).join(' ');",
    "if (cmd === 'api user') console.log(e.STUB_LOGIN);",
    "else if (a[0] === 'api' && a[1].startsWith('repos/')) {",
    "  if (e.STUB_FORK_PARENT !== undefined) console.log(e.STUB_FORK_PARENT);",
    "  else if (existsSync(e.STUB_FORKED)) console.log('acme/widgets');",
    "  else { console.error('HTTP 404: Not Found'); process.exit(1); } }",
    "else if (cmd === 'repo fork') writeFileSync(e.STUB_FORKED, '1');",
    "else if (cmd === 'pr list') console.log(e.STUB_EXISTING || '[]');",
    "else if (cmd === 'pr create') console.log('https://github.test/acme/widgets/pull/9');",
    "else if (cmd === 'auth git-credential') {}",
    "else { console.error('stub gh: ' + cmd); process.exit(2); }",
  ].join('\n') + '\n');
  for (const d of [UP, FORK, REPO]) mkdirSync(d, { recursive: true });
  git(UP, 'init', '--bare', '-q', '-b', 'main');
  git(FORK, 'init', '--bare', '-q', '-b', 'main');
  git(REPO, 'init', '-q', '-b', 'main');
  writeFileSync(join(REPO, 'go.mod'), 'module example.test/widgets\n');
  git(REPO, 'add', 'go.mod'); git(REPO, 'commit', '-q', '-m', 'first');
  git(REPO, 'remote', 'add', 'origin', UP);
  git(REPO, 'push', '-q', '-u', 'origin', 'main');
  git(REPO, 'remote', 'set-head', 'origin', 'main');
  writeFileSync(join(REPO, 'go.mod'), 'module example.test/widgets\n\nrequire example.test/dep v1.2.3\n');
  git(REPO, 'commit', '-q', '-am', 'bump');
  writeFileSync(BODY, 'body\n');
});
after(() => rmSync(TMP, { recursive: true, force: true }));

test('upstream with no fork: the fork is made, HEAD lands in the fork, upstream is untouched, the PR opens as a draft against upstream', () => {
  reset();
  const r = createPr(args({ draft: true, upstream: 'acme/widgets' }));
  assert.equal(r.state, 'opened', JSON.stringify(r));
  assert.equal(r.fork, 'tester/widgets');
  assert.equal(r.draft, true);
  assert.ok(calls().some((a) => a[0] === 'repo' && a[1] === 'fork' && a[2] === 'acme/widgets'), 'gh repo fork ran');
  assert.equal(refIn(FORK, `refs/heads/${BRANCH}`), git(REPO, 'rev-parse', 'HEAD'));
  assert.equal(refIn(UP, `refs/heads/${BRANCH}`), null, 'nothing was pushed to the upstream');
  const create = calls().find((a) => a[0] === 'pr' && a[1] === 'create');
  assert.deepEqual(create.slice(2, 8), ['--repo', 'acme/widgets', '--head', `tester:${BRANCH}`, '--base', 'main']);
  assert.equal(create.at(-1), '--draft');
});

test('an existing fork is reused (no second fork) and a PR without draft carries no --draft', () => {
  reset();
  const r = createPr(args({ upstream: 'acme/widgets', env: env({ STUB_FORK_PARENT: 'acme/widgets' }) }));
  assert.equal(r.state, 'opened', JSON.stringify(r));
  assert.ok(!calls().some((a) => a[0] === 'repo' && a[1] === 'fork'), 'no fork call');
  const create = calls().find((a) => a[0] === 'pr' && a[1] === 'create');
  assert.ok(!create.includes('--draft'));
});

test('a same-named repository that is not a fork of upstream is a refusal before any push', () => {
  reset();
  git(FORK, 'update-ref', '-d', `refs/heads/${BRANCH}`);
  const r = createPr(args({ draft: true, upstream: 'acme/widgets', env: env({ STUB_FORK_PARENT: '' }) }));
  assert.equal(r.state, 'refused');
  assert.match(r.reason, /is not a fork of acme\/widgets/);
  assert.equal(refIn(FORK, `refs/heads/${BRANCH}`), null);
});

test('an upstream the gh identity owns, or one that is not owner/name, is refused', () => {
  reset();
  assert.match(createPr(args({ upstream: 'tester/widgets' })).reason, /push to it directly/);
  assert.match(createPr(args({ upstream: 'acme/widgets; rm -rf ~' })).reason, /owner\/name/);
});

test("an open PR from someone else's fork with the same branch name is not ours; our own is reported, not duplicated", () => {
  reset();
  const theirs = JSON.stringify([{ number: 4, url: 'https://github.test/acme/widgets/pull/4', headRepositoryOwner: { login: 'other' } }]);
  assert.equal(createPr(args({ draft: true, upstream: 'acme/widgets', env: env({ STUB_FORK_PARENT: 'acme/widgets', STUB_EXISTING: theirs }) })).state, 'opened');
  reset();
  const ours = JSON.stringify([{ number: 5, url: 'https://github.test/acme/widgets/pull/5', headRepositoryOwner: { login: 'tester' } }]);
  const r = createPr(args({ draft: true, upstream: 'acme/widgets', env: env({ STUB_FORK_PARENT: 'acme/widgets', STUB_EXISTING: ours }) }));
  assert.equal(r.state, 'existing');
  assert.equal(r.url, 'https://github.test/acme/widgets/pull/5');
  assert.ok(!calls().some((a) => a[0] === 'pr' && a[1] === 'create'));
});
