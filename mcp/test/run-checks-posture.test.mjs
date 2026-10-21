// MCP run_checks under the operator's two run_checks settings:
// runChecksRoots (CW_MCP_REPO_ROOTS) allows NOTHING when it names nothing, and refuses a repo outside
// every named root while naming them; runChecksRepoCode (CW_MCP_REPO_CODE) is opt-in by default and
// refuses a group with an executesRepoCode check unless the operator lists the repository in
// runChecksRepoCodeRepos. Roots past their review date add a warning, never a refusal.
// Because an empty allowlist refuses, every test here that expects a RUN must name a root. A
// test that forgets one fails on the roots guard before it reaches the thing it meant to measure. Driven through the server over stdio. A fake `node` on PATH
// stands in for the runner and records its argv, so nothing is scanned.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, realpathSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO, 'mcp', 'server.mjs');
const T = realpathSync(mkdtempSync(join(tmpdir(), 'cw-mcp-posture-')));
const HOME = join(T, 'home');
const ROOT_A = join(T, 'root-a');
const GITREPO = join(ROOT_A, 'repo');
const OUTSIDE = join(T, 'elsewhere', 'repo');
const FAKE = join(T, 'fakebin');
const ARGV = join(T, 'runner-argv.txt');
const CLEAR = ['CW_MCP_REPO_ROOTS', 'CW_MCP_REPO_CODE', 'CW_MCP_REPO_CODE_REPOS', 'CW_MCP_REPO_ROOTS_REVIEW_DAYS', 'CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_NOW'];

before(() => {
  for (const d of [GITREPO, OUTSIDE, HOME, FAKE]) mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', GITREPO]);
  execFileSync('git', ['init', '-q', OUTSIDE]);
  symlinkSync(ROOT_A, join(T, 'root-link'));
  writeFileSync(join(FAKE, 'node'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(ARGV)}\n`);
  chmodSync(join(FAKE, 'node'), 0o755);
});
after(() => rmSync(T, { recursive: true, force: true }));

function call(name, args, env = {}) {
  rmSync(ARGV, { force: true });
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !CLEAR.includes(k)));
  const out = execFileSync(process.execPath, [SERVER], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
    env: { ...base, HOME, PATH: `${FAKE}${delimiter}${process.env.PATH}`, CW_REPORT_DIR: join(T, 'reports'), ...env },
  });
  for (const line of out.split('\n').filter(Boolean)) {
    const m = JSON.parse(line);
    if (m.id === 1) return { isError: !!m.result?.isError, text: m.result?.content?.[0]?.text ?? '', ran: existsSync(ARGV) };
  }
  throw new Error(`no response frame: ${out.slice(0, 300)}`);
}
const QG = { manifest: 'quality-gates', group: 'boot-pass' };

// An allowlist that names nothing allows nothing.
test('roots unset: no repository is allowed, and the refusal says the allowlist is empty', () => {
  for (const tool of ['run_checks', 'run_checks_start']) {
    const r = call(tool, { repo: OUTSIDE, ...QG });
    assert.equal(r.isError, true, `${tool}: ${r.text}`);
    assert.match(r.text, /roots allowlist is empty/);
    assert.match(r.text, /CW_MCP_REPO_ROOTS/, 'the refusal must name the way out of it');
    assert.equal(r.ran, false, 'refused before the runner starts');
  }
  // and a repo INSIDE no root is refused for the same reason, not for being outside one
  const inside = call('run_checks', { repo: GITREPO, ...QG });
  assert.equal(inside.isError, true);
  assert.match(inside.text, /roots allowlist is empty/);
});

test('a repo outside every root is refused with the roots named, before the runner starts', () => {
  for (const tool of ['run_checks', 'run_checks_start']) {
    const r = call(tool, { repo: OUTSIDE, ...QG }, { CW_MCP_REPO_ROOTS: `${ROOT_A}${delimiter}${join(T, 'root-b')}` });
    assert.equal(r.isError, true, `${tool}: ${r.text}`);
    assert.match(r.text, /not under a run_checks root/);
    assert.ok(r.text.includes(ROOT_A) && r.text.includes(join(T, 'root-b')), r.text);
    assert.match(r.text, /env:CW_MCP_REPO_ROOTS/);
    assert.equal(r.ran, false);
  }
});

test('a repo under a root runs; the root and the repo compare as their realpaths', () => {
  for (const roots of [ROOT_A, join(T, 'root-link')]) {
    const r = call('run_checks', { repo: GITREPO, ...QG }, { CW_MCP_REPO_ROOTS: roots });
    assert.equal(r.isError, false, `${roots}: ${r.text}`);
    assert.ok(r.ran);
  }
  // a sibling sharing the root's prefix is not under it
  mkdirSync(`${ROOT_A}-x/repo`, { recursive: true });
  execFileSync('git', ['init', '-q', `${ROOT_A}-x/repo`]);
  assert.equal(call('run_checks', { repo: `${ROOT_A}-x/repo`, ...QG }, { CW_MCP_REPO_ROOTS: ROOT_A }).isError, true);
});

test('the roots come from the settings store when the env is silent, and the store can be permissive', () => {
  mkdirSync(join(HOME, '.commitwork'), { recursive: true });
  const store = join(HOME, '.commitwork', 'settings.json');
  writeFileSync(store, JSON.stringify({ v: 1, settings: { runChecksRoots: { value: [ROOT_A], at: 'x', by: 'op' } } }));
  try {
    const r = call('run_checks', { repo: OUTSIDE, ...QG });
    assert.equal(r.isError, true);
    assert.match(r.text, /from store/);
    assert.equal(call('run_checks', { repo: GITREPO, ...QG }).isError, false);
  } finally { rmSync(store, { force: true }); }
});

test('an unreadable roots setting refuses every run rather than reading as unrestricted', () => {
  const r = call('run_checks', { repo: GITREPO, ...QG }, { CW_MCP_REPO_ROOTS: 'relative/dir' });
  assert.equal(r.isError, true);
  assert.match(r.text, /roots cannot be read/);
  assert.equal(r.ran, false);
});

test('repo code is opt-in BY DEFAULT: a group with an executesRepoCode check is refused, naming the checks', () => {
  for (const [manifest, group, ids] of [['build-health', 'hygiene', /format, lint/], ['hermetic-tests', 'tests', /test-hermetic/]]) {
    for (const tool of ['run_checks', 'run_checks_start']) {
      // no CW_MCP_REPO_CODE: the default carries the refusal
      const r = call(tool, { repo: GITREPO, manifest, group }, { CW_MCP_REPO_ROOTS: ROOT_A });
      assert.equal(r.isError, true, `${tool} ${manifest}:${group} ran`);
      assert.match(r.text, ids);
      assert.match(r.text, /is not a repo-code repository/);
      assert.match(r.text, /CW_MCP_REPO_CODE_REPOS/, 'the refusal names the grant and who makes it');
      assert.equal(r.ran, false);
    }
  }
});

test('repo code at opt-in: a repository the operator lists runs it, by realpath; an unlisted one is refused', () => {
  const env = { CW_MCP_REPO_ROOTS: ROOT_A, CW_MCP_REPO_CODE: 'opt-in' };
  for (const listed of [GITREPO, join(T, 'root-link', 'repo')]) {
    const ok = call('run_checks', { repo: GITREPO, manifest: 'build-health', group: 'hygiene' }, { ...env, CW_MCP_REPO_CODE_REPOS: listed });
    assert.equal(ok.isError, false, `${listed}: ${ok.text}`);
    assert.ok(ok.ran);
    const argv = readFileSync(ARGV, 'utf8').split('\n');
    assert.equal(argv[argv.indexOf('--manifest') + 1], 'build-health');
  }
  const other = join(ROOT_A, 'other');
  mkdirSync(other, { recursive: true });
  assert.equal(call('run_checks', { repo: GITREPO, manifest: 'build-health', group: 'hygiene' }, { ...env, CW_MCP_REPO_CODE_REPOS: other }).isError, true);
  assert.equal(call('run_checks', { repo: GITREPO, ...QG }, env).isError, false, 'a group without repo code needs no grant');
});

test('an unreadable repo-code grant grants nothing', () => {
  const r = call('run_checks', { repo: GITREPO, manifest: 'build-health', group: 'hygiene' }, { CW_MCP_REPO_ROOTS: ROOT_A, CW_MCP_REPO_CODE_REPOS: 'relative/repo' });
  assert.equal(r.isError, true);
  assert.match(r.text, /repo-code repositories cannot be read/);
  assert.equal(r.ran, false);
});

test('repo code at allow, which is not the default, runs the same group without the flag', () => {
  const r = call('run_checks', { repo: GITREPO, manifest: 'build-health', group: 'hygiene' },
    { CW_MCP_REPO_ROOTS: ROOT_A, CW_MCP_REPO_CODE: 'allow' });
  assert.equal(r.isError, false, r.text);
  assert.ok(r.ran);
});

test('allowRepoCode is no longer an input of either run tool, so a caller cannot grant itself repo code', () => {
  const tools = JSON.parse(execFileSync(process.execPath, [SERVER], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, HOME },
  }).split('\n').filter(Boolean)[0]).result.tools;
  for (const n of ['run_checks', 'run_checks_start']) assert.equal(tools.find((t) => t.name === n).inputSchema.properties.allowRepoCode, undefined, n);
  const r = call('run_checks', { repo: GITREPO, manifest: 'build-health', group: 'hygiene', allowRepoCode: true }, { CW_MCP_REPO_ROOTS: ROOT_A });
  assert.equal(r.isError, true);
  assert.match(r.text, /allowRepoCode/);
  assert.equal(r.ran, false);
});

test('roots past their review date: both run tools still run, and each result carries the warning', () => {
  mkdirSync(join(HOME, '.commitwork'), { recursive: true });
  const store = join(HOME, '.commitwork', 'settings.json');
  writeFileSync(store, JSON.stringify({ v: 1, settings: { runChecksRoots: { value: [ROOT_A], at: '2026-09-01T00:00:00.000Z', by: 'op' } } }));
  try {
    const late = { CW_NOW: '2026-10-13T00:00:00.000Z' };
    for (const tool of ['run_checks', 'run_checks_start']) {
      const r = call(tool, { repo: GITREPO, ...QG }, late);
      assert.equal(r.isError, false, `${tool}: ${r.text}`);
      const w = JSON.parse(r.text).warnings;
      assert.equal(w.length, 1, tool);
      assert.match(w[0], /past their review date \(2026-10-01T00:00:00\.000Z/);
    }
    assert.equal(JSON.parse(call('run_checks', { repo: GITREPO, ...QG }, { CW_NOW: '2026-09-15T00:00:00.000Z' }).text).warnings, undefined, 'inside the interval: no warning');
    assert.equal(JSON.parse(call('run_checks', { repo: GITREPO, ...QG }, { ...late, CW_MCP_REPO_ROOTS_REVIEW_DAYS: '0' }).text).warnings, undefined, '0 turns it off');
    assert.equal(JSON.parse(call('run_checks', { repo: GITREPO, ...QG }, { ...late, CW_MCP_REPO_ROOTS: ROOT_A }).text).warnings, undefined, 'env roots carry no save date');
  } finally { rmSync(store, { force: true }); }
});
