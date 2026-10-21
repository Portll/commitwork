// bin/test/npm-update.test.mjs — dependency-update proposals and merges, on real git repositories
// with a stand-in npm (fixtures/npm-stub.mjs) answering from a registry fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { proposeUpdates, lockDiff, proposalId, commitMessage } from '../lib/npm-update.mjs';
import { resolvePolicy } from '../lib/update-policy.mjs';
import { readLedger, appendEvent } from '../lib/deps-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-10-10T00:00:00.000Z');
const DAY = 86_400_000;
const ago = (d) => new Date(NOW - d * DAY).toISOString();
const skip = process.platform === 'win32' ? 'the stand-in npm is a POSIX shell wrapper' : false;

const REGISTRY = {
  packages: {
    alpha: { versions: { '1.0.0': ago(400), '1.0.1': ago(60), '1.1.0': ago(30), '2.0.0': ago(20) } },
    beta: { versions: { '2.0.0': ago(400), '2.0.1': ago(3) } },
    gamma: { versions: { '1.0.0': ago(400), '1.0.5': ago(40), '1.0.6': ago(2) } },
    tiny: { versions: { '1.0.0': ago(400), '1.0.2': ago(50) } },
    hb: { versions: { '4.7.6': ago(400), '4.7.9': ago(40), '4.7.10': ago(1) } },
  },
  advisories: [{ name: 'hb', range: '<4.7.10', severity: 'critical', title: 'template injection', fixedIn: '4.7.10' }],
};

function env(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-npmstub-'));
  writeFileSync(join(dir, 'registry.json'), JSON.stringify({ ...REGISTRY, ...extra }));
  const bin = join(dir, 'npm');
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${join(HERE, 'fixtures', 'npm-stub.mjs')}" "$@"\n`);
  chmodSync(bin, 0o755);
  process.env.CW_NPM = bin;
  process.env.CW_NPM_STUB_REGISTRY = join(dir, 'registry.json');
  process.env.CW_NPM_STUB_LOG = join(dir, 'calls.jsonl');
  process.env.CW_DEPS_LEDGER = join(dir, 'ledger', 'deps-ledger.jsonl');
  return dir;
}

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

function repo({ testScript = 'node -e 0', npmrc = false, hook = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-deps-repo-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'user.email', 't@example.invalid');
  const pkg = { name: 'fixture', version: '1.0.0', ...(testScript ? { scripts: { test: testScript } } : {}),
    dependencies: { alpha: '^1.0.0', beta: '~2.0.0' }, devDependencies: { hb: '^4.7.6', tiny: '1.0.0' } };
  const lock = { name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture' },
    'node_modules/alpha': { version: '1.0.0' }, 'node_modules/beta': { version: '2.0.0' }, 'node_modules/gamma': { version: '1.0.0' },
    'node_modules/hb': { version: '4.7.6', dev: true }, 'node_modules/tiny': { version: '1.0.0', dev: true } } };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  if (npmrc) writeFileSync(join(dir, '.npmrc'), 'registry=https://example.invalid/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  if (hook) {
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${join(dir, 'HOOK-RAN')}"\n`);
    chmodSync(join(dir, '.git', 'hooks', 'pre-commit'), 0o755);
  }
  return dir;
}

const policy = (over = {}) => resolvePolicy({ prod: ['patch', 'minor'], dev: ['patch', 'minor', 'lockfile', 'advisories'], automerge: ['patch', 'minor', 'lockfile', 'advisories'], cooldown: 7, ...over }, null);
const lockAt = (dir, ref) => JSON.parse(git(dir, 'show', `${ref}:package-lock.json`)).packages;

test('a proposal branch carries the chosen updates, the advisory fix and the trailers, and leaves the checkout alone', { skip }, async () => {
  env();
  const dir = repo();
  const r = await proposeUpdates({ dir, policy: policy(), nowMs: NOW, record: appendEvent });
  assert.equal(r.state, 'proposed', r.reason);
  assert.deepEqual(r.direct.map((d) => `${d.name} ${d.version} ${d.type}`), ['alpha 1.1.0 minor', 'hb 4.7.9 patch', 'tiny 1.0.2 patch']);
  const pk = lockAt(dir, r.branch);
  assert.equal(pk['node_modules/alpha'].version, '1.1.0');
  assert.equal(pk['node_modules/hb'].version, '4.7.10', 'the advisory fix raises the chosen 4.7.9, cooldown or not');
  assert.equal(r.changes.find((c) => c.name === 'hb').step, 'advisories');
  assert.equal(pk['node_modules/beta'].version, '2.0.0', 'beta 2.0.1 is three days old and stays held');
  const msg = git(dir, 'log', '-1', '--format=%B', r.branch);
  assert.match(msg, /^chore\(deps\): update \d+ npm packages/);
  assert.match(msg, new RegExp(`Commitwork-Deps-Proposal: ${r.proposal}`));
  assert.equal(git(dir, 'rev-parse', 'main'), r.base, 'nothing merged without --merge');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'the operator\'s checkout is untouched');
  assert.equal(git(dir, 'worktree', 'list').split('\n').length, 1, 'the scratch worktree is gone');
  const ev = readLedger().events.map((e) => e.event);
  assert.deepEqual(ev, ['audit', 'proposed']);
});

test('the same selection on the same commit is proposed once', { skip }, async () => {
  env();
  const dir = repo();
  const a = await proposeUpdates({ dir, policy: policy(), nowMs: NOW });
  const b = await proposeUpdates({ dir, policy: policy(), nowMs: NOW });
  assert.equal(a.state, 'proposed');
  assert.equal(b.state, 'exists');
  assert.equal(b.branch, a.branch);
  assert.equal(git(dir, 'for-each-ref', '--format=%(refname)', 'refs/heads/commitwork').split('\n').length, 1);
});

test('a lockfile refresh resolves with --before, so a transitive release inside the cooldown is not pulled in', { skip }, async () => {
  env();
  const dir = repo();
  const r = await proposeUpdates({ dir, policy: policy({ prod: ['lockfile'], dev: ['lockfile'] }), nowMs: NOW });
  assert.equal(r.state, 'proposed', r.reason);
  const pk = lockAt(dir, r.branch);
  assert.equal(pk['node_modules/gamma'].version, '1.0.5', 'gamma 1.0.6 is two days old');
  const calls = readFileSync(process.env.CW_NPM_STUB_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l).args);
  const upd = calls.find((a) => a[0] === 'update');
  assert.ok(upd.some((a) => a === `--before=${new Date(NOW - 7 * DAY).toISOString()}`), JSON.stringify(upd));
  assert.ok(upd.includes('--ignore-scripts'));
});

test('a step whose changes the policy does not permit is undone as a whole and named', { skip }, async () => {
  env();
  const dir = repo();
  // dev may refresh the lockfile, prod may not: the refresh would move gamma (prod) and is undone.
  const r = await proposeUpdates({ dir, policy: policy({ prod: [], dev: ['lockfile'] }), nowMs: NOW });
  assert.equal(r.state, 'nothing');
  assert.match(r.reason, /lockfile step undone: .*gamma 1\.0\.0 → 1\.0\.5 \(prod\)/);
});

test('--merge is refused without trust, and when automerge does not cover a change', { skip }, async () => {
  env();
  const a = await proposeUpdates({ dir: repo(), policy: policy(), merge: true, nowMs: NOW });
  assert.equal(a.state, 'proposed');
  assert.match(a.mergeRefused, /--trust-repo-manifest/);
  const b = await proposeUpdates({ dir: repo(), policy: policy({ automerge: ['patch'] }), merge: true, trustRepo: true, nowMs: NOW });
  assert.match(b.mergeRefused, /automerge does not permit .*alpha 1\.0\.0 → 1\.1\.0 \(minor, prod\)/);
});

test('a trusted merge runs the gate, fast-forwards, verifies against the branch, and records it', { skip }, async () => {
  env();
  const dir = repo();
  const r = await proposeUpdates({ dir, policy: policy(), merge: true, trustRepo: true, nowMs: NOW, record: appendEvent });
  assert.equal(r.state, 'merged', r.mergeRefused || r.reason);
  assert.equal(r.gate.rung, 'npm-test');
  assert.deepEqual(r.verified, { landed: true, pinned: true });
  assert.equal(git(dir, 'rev-parse', 'main'), r.head);
  assert.equal(JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages['node_modules/alpha'].version, '1.1.0', 'the checked-out branch moved with its files');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', `refs/heads/${r.branch}`], { cwd: dir }).status, 1, 'the merged proposal branch is deleted');
  assert.deepEqual(readLedger().events.map((e) => e.event), ['audit', 'proposed', 'merged', 'verified']);
});

test('a failing gate, a missing gate and a dirty checkout each refuse the merge and keep the proposal', { skip }, async () => {
  env({ test: { exit: 1 } });
  const failing = await proposeUpdates({ dir: repo(), policy: policy(), merge: true, trustRepo: true, nowMs: NOW });
  assert.equal(failing.state, 'proposed');
  assert.match(failing.mergeRefused, /npm test exited 1/);
  env();
  const none = await proposeUpdates({ dir: repo({ testScript: null }), policy: policy(), merge: true, trustRepo: true, nowMs: NOW });
  assert.equal(none.gate.result, 'undetermined');
  assert.match(none.mergeRefused, /nothing to merge on/);
  const dir = repo();
  writeFileSync(join(dir, 'package.json'), readFileSync(join(dir, 'package.json'), 'utf8').replace('"fixture"', '"edited"'));
  const dirty = await proposeUpdates({ dir, policy: policy(), merge: true, trustRepo: true, nowMs: NOW });
  assert.match(dirty.mergeRefused, /uncommitted changes/);
  assert.equal(git(dir, 'rev-parse', 'main'), dirty.base);
});

test('a project shipping a .npmrc is refused unless trusted, and the repository\'s hooks never run', { skip }, async () => {
  env();
  const r = await proposeUpdates({ dir: repo({ npmrc: true }), policy: policy(), nowMs: NOW });
  assert.equal(r.state, 'refused');
  assert.match(r.reason, /\.npmrc/);
  const dir = repo({ hook: true });
  const p = await proposeUpdates({ dir, policy: policy(), nowMs: NOW });
  assert.equal(p.state, 'proposed');
  assert.equal(existsSync(join(dir, 'HOOK-RAN')), false, 'the pre-commit hook of the repository under update ran');
});

test('lockDiff, proposalId and the commit message are pure and stable', () => {
  const a = { packages: { '': {}, 'node_modules/x': { version: '1.0.0' }, 'node_modules/y': { version: '2.0.0', dev: true } } };
  const b = { packages: { '': {}, 'node_modules/x': { version: '1.0.1' }, 'node_modules/z': { version: '3.0.0' } } };
  assert.deepEqual(lockDiff(a, b).map((c) => `${c.name} ${c.from}→${c.to} ${c.exposure} ${c.type}`), ['x 1.0.0→1.0.1 prod patch', 'y 2.0.0→null dev null', 'z null→3.0.0 prod null']);
  const sel = { base: 'b', pkgPath: '.', direct: [{ name: 'x', version: '1' }, { name: 'a', version: '2' }], lockfile: true, advisories: false };
  assert.equal(proposalId(sel), proposalId({ ...sel, direct: [...sel.direct].reverse() }), 'order of selection does not change the id');
  assert.notEqual(proposalId(sel), proposalId({ ...sel, base: 'c' }));
  const msg = commitMessage({ id: 'abc', pkgPath: 'web', sel: { direct: [{ name: 'x', type: 'patch' }] }, changes: [{ name: 'x', path: 'node_modules/x', from: '1.0.0', to: '1.0.1', exposure: 'prod', step: 'direct' }], after: { advisories: { error: 'offline' } } });
  assert.match(msg, /^chore\(deps\): update 1 npm package in web\n\n- x 1\.0\.0 → 1\.0\.1 \(patch, prod\)\n\nCommitwork-Deps-Proposal: abc\nCommitwork-Deps-Path: web$/);
});

test.after(() => { for (const k of ['CW_NPM', 'CW_NPM_STUB_REGISTRY', 'CW_NPM_STUB_LOG', 'CW_DEPS_LEDGER']) delete process.env[k]; });
