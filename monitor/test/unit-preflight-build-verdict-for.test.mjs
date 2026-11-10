// Dependency-scan readiness verdict for a repo root and its subtrees (monitor/preflight-build.mjs verdictFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFor } from '../preflight-build.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const MISSING_NOTE = 'declared or discovered but not on disk \u2014 a scan of it would be a void, never a clean';
const NO_MANIFEST_NOTE = 'no dependency manifest of any known ecosystem \u2014 nothing for the deps scanners to find, which is not the same as remediated';
const EMPTY_MANIFEST_NOTE = 'package.json declares no dependencies of any kind \u2014 there is no resolved tree to be missing, so this is not blindness and no lockfile should be built for it';
const NODE_WHY = 'without a lockfile the resolved tree does not exist on disk, so osv/npm audit have no versions to match advisories against';
const GO_WHY = 'go.sum is the checksum database the vulnerability scanners resolve module versions through';
const RUBY_WHY = 'a Gemfile without Gemfile.lock has no resolved gem versions. Not built here: `bundle lock` evaluates the Gemfile and each gemspec as Ruby on the host';
const NODE_BLIND = { eco: 'node', state: 'blind', lockMissing: 'package-lock.json', lockSource: null, buildable: true, why: NODE_WHY };
const GO_BLIND = { eco: 'go', state: 'blind', lockMissing: 'go.sum', lockSource: null, buildable: true, why: GO_WHY };
const RUBY_BLIND = { eco: 'ruby', state: 'blind', lockMissing: 'Gemfile.lock', lockSource: null, buildable: false, why: RUBY_WHY };
const WITH_DEPS = JSON.stringify({ name: 'pkg', dependencies: { left: '1.0.0' } });
const LOCKED_NODE = { 'package.json': WITH_DEPS, 'package-lock.json': '{}' };

const okEco = (eco, buildable) => ({ eco, state: 'ok', lockMissing: null, lockSource: 'repo', buildable, why: null });
const rootNote = (n, list) => `no dependency manifest at the root, but ${n} subtree(s) below it declare one (${list}) \u2014 the deps scanners read those, so this is neither no-surface nor a clean repo`;
const blindNote = (n, list) => `${n} subtree(s) below the root are blind (${list}) \u2014 the scanners read them, so their findings are partial, but they do not decide this repo's state`;
const goTrees = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}/go.mod`, 'module m\n']));
const goListing = (n) => Array.from({ length: n }, (_, i) => ({ dir: `p${i}`, ecosystems: [GO_BLIND] }));
const expected = (repo, rest) => ({ name: 'demo', path: repo, ...rest });

function scan(files) {
  const dir = mkdtempSync(join(tmpdir(), 'verdictFor-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    for (const [rel, body] of Object.entries(files)) {
      const target = join(repo, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
    const env = { CW_LOCKFILE_ROOT: join(dir, 'sidecar') };
    return { repo, r: verdictFor({ name: 'demo', path: repo }, { env }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a path that is null, absent, empty or not on disk is reported as missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verdictFor-'));
  try {
    const gone = join(dir, 'nope');
    const missing = { name: 'demo', state: 'missing', ecosystems: [], note: MISSING_NOTE };
    assert.deepEqual(verdictFor({ name: 'demo', path: gone }), { ...missing, path: gone });
    assert.deepEqual(verdictFor({ name: 'demo', path: null }), { ...missing, path: null });
    assert.deepEqual(verdictFor({ name: 'demo' }), { ...missing, path: null });
    assert.deepEqual(verdictFor({ name: 'demo', path: '' }), { ...missing, path: '' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty directory has no surface and carries no subtree keys', () => {
  const { repo, r } = scan({});
  assert.deepEqual(r, expected(repo, { state: 'no-surface', ecosystems: [], note: NO_MANIFEST_NOTE }));
});

test('a package.json declaring nothing has no surface and says the manifest is empty', () => {
  const { repo, r } = scan({ 'package.json': JSON.stringify({ name: 'pkg', dependencies: {} }) });
  assert.deepEqual(r, expected(repo, { state: 'no-surface', ecosystems: [], note: EMPTY_MANIFEST_NOTE }));
});

test('four subtrees are all listed with no ellipsis in either note', () => {
  const { repo, r } = scan(goTrees(4));
  assert.deepEqual(r, expected(repo, {
    state: 'subtree-only',
    ecosystems: [],
    note: rootNote(4, 'p0, p1, p2, p3'),
    subtrees: goListing(4),
    subtreeNote: blindNote(4, 'p0: go, p1: go, p2: go, p3: go'),
  }));
});

test('five subtrees list the first four and end both notes with an ellipsis', () => {
  const { repo, r } = scan(goTrees(5));
  assert.deepEqual(r, expected(repo, {
    state: 'subtree-only',
    ecosystems: [],
    note: rootNote(5, 'p0, p1, p2, p3, \u2026'),
    subtrees: goListing(5),
    subtreeNote: blindNote(5, 'p0: go, p1: go, p2: go, p3: go, \u2026'),
  }));
});

test('five subtrees with four blind truncate the root note but not the blind note', () => {
  const { repo, r } = scan({ ...goTrees(4), 'p4/go.mod': '', 'p4/go.sum': '' });
  assert.deepEqual(r, expected(repo, {
    state: 'subtree-only',
    ecosystems: [],
    note: rootNote(5, 'p0, p1, p2, p3, \u2026'),
    subtrees: [...goListing(4), { dir: 'p4', ecosystems: [okEco('go', true)] }],
    subtreeNote: blindNote(4, 'p0: go, p1: go, p2: go, p3: go'),
  }));
});

test('a locked subtree under an empty package.json is subtree-only with no blind note', () => {
  const { repo, r } = scan({ 'package.json': '{}', 'core/go.mod': '', 'core/go.sum': '' });
  assert.deepEqual(r, expected(repo, {
    state: 'subtree-only',
    ecosystems: [],
    note: rootNote(1, 'core'),
    subtrees: [{ dir: 'core', ecosystems: [okEco('go', true)] }],
  }));
});

test('a subtree note counts only blind subtrees and names only their blind ecosystems', () => {
  const { repo, r } = scan({
    ...LOCKED_NODE,
    'clean/Cargo.toml': '', 'clean/Cargo.lock': '',
    'mixed/go.mod': '', 'mixed/Cargo.toml': '', 'mixed/Cargo.lock': '',
    'two/go.mod': '', 'two/Gemfile': '',
  });
  assert.deepEqual(r, expected(repo, {
    state: 'ok',
    ecosystems: [okEco('node', true)],
    note: null,
    subtrees: [
      { dir: 'clean', ecosystems: [okEco('rust', false)] },
      { dir: 'mixed', ecosystems: [GO_BLIND, okEco('rust', false)] },
      { dir: 'two', ecosystems: [GO_BLIND, RUBY_BLIND] },
    ],
    subtreeNote: blindNote(2, 'mixed: go, two: go/ruby'),
  }));
});

test('the root decides ok or blind and its note names only the blind ecosystems', () => {
  const locked = scan(LOCKED_NODE);
  assert.deepEqual(locked.r, expected(locked.repo, { state: 'ok', ecosystems: [okEco('node', true)], note: null }));
  const bare = scan({ 'package.json': WITH_DEPS });
  assert.deepEqual(bare.r, expected(bare.repo, { state: 'blind', ecosystems: [NODE_BLIND], note: `node: ${NODE_WHY}` }));
  const both = scan({ 'package.json': WITH_DEPS, 'go.mod': '' });
  assert.deepEqual(both.r, expected(both.repo, {
    state: 'blind',
    ecosystems: [NODE_BLIND, GO_BLIND],
    note: `node: ${NODE_WHY} \u00b7 go: ${GO_WHY}`,
  }));
  const partial = scan({ ...LOCKED_NODE, 'go.mod': '' });
  assert.deepEqual(partial.r, expected(partial.repo, {
    state: 'blind',
    ecosystems: [okEco('node', true), GO_BLIND],
    note: `go: ${GO_WHY}`,
  }));
});

test('only the root reads a sidecar lock, so a subtree beside it stays blind', () => {
  const { repo, r } = scan({ 'go.mod': '', 'lib/go.mod': '', '../sidecar/repo/go.sum': '' });
  const lockDir = join(dirname(repo), 'sidecar', 'repo');
  assert.deepEqual(r, expected(repo, {
    state: 'ok',
    ecosystems: [{ ...okEco('go', true), lockSource: 'sidecar', lockDir }],
    note: null,
    subtrees: [{ dir: 'lib', ecosystems: [GO_BLIND] }],
    subtreeNote: blindNote(1, 'lib: go'),
  }));
});
