// Where the release-name gates find their private manifest. The working-tree gate used to read it
// through monitor/private, a gitignored symlink, so in a fresh worktree or a nested agent worktree
// it skipped as if it were a public clone; and one ref variable chose both commitwork's commit and
// the sidecar's, so naming a commitwork commit made the sidecar lookup fail closed.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sidecarFor, loadManifest, MANIFEST_REL } from '../lib/release-names-head-scan.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-release-sidecar-')));
after(() => rmSync(TMP, { recursive: true, force: true }));

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=f@example.com', '-c', 'user.name=f', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

test('the sidecar is CW_SIDECAR, else beside the checkout, else beside the main checkout of a nested worktree', () => {
  const main = join(TMP, 'tree', 'main');
  mkdirSync(main, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', main]);
  writeFileSync(join(main, 'a'), 'a\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'a');
  const nested = join(main, '.claude', 'worktrees', 'agent-x');
  git(main, 'worktree', 'add', '-q', '--detach', nested);
  const sidecar = join(TMP, 'tree', 'commitwork-sidecar');
  mkdirSync(sidecar);

  assert.equal(sidecarFor(main, {}), sidecar);
  assert.equal(sidecarFor(nested, {}), sidecar, 'a nested worktree finds the main checkout\'s sidecar');
  assert.equal(sidecarFor(nested, { CW_SIDECAR: '/elsewhere' }), '/elsewhere');
});

test('the sidecar\'s manifest is read at its own ref, whatever ref the commitwork scan uses', () => {
  const sidecar = join(TMP, 'sidecar-ref');
  mkdirSync(join(sidecar, 'monitor'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', sidecar]);
  writeFileSync(join(sidecar, MANIFEST_REL), JSON.stringify({ names: [{ name: 'first' }] }));
  git(sidecar, 'add', '-A');
  git(sidecar, 'commit', '-q', '-m', 'first');
  const first = git(sidecar, 'rev-parse', 'HEAD');
  writeFileSync(join(sidecar, MANIFEST_REL), JSON.stringify({ names: [{ name: 'second' }] }));
  git(sidecar, 'commit', '-q', '-am', 'second');

  const saved = { ...process.env };
  try {
    delete process.env.CW_RELEASE_REDACTIONS;
    process.env.CW_SIDECAR = sidecar;
    process.env.CW_RELEASE_NAMES_HEAD_REF = 'some-commitwork-ref-the-sidecar-does-not-have';
    delete process.env.CW_RELEASE_NAMES_SIDECAR_REF;
    assert.equal(loadManifest().names[0].name, 'second', 'the commitwork ref no longer reaches the sidecar');
    process.env.CW_RELEASE_NAMES_SIDECAR_REF = first;
    assert.equal(loadManifest().names[0].name, 'first');
    process.env.CW_RELEASE_NAMES_SIDECAR_REF = 'no-such-ref';
    assert.throws(() => loadManifest(), /is not in no-such-ref of .* refusing to scan with no identity list/);
  } finally {
    for (const k of ['CW_RELEASE_REDACTIONS', 'CW_SIDECAR', 'CW_RELEASE_NAMES_HEAD_REF', 'CW_RELEASE_NAMES_SIDECAR_REF']) {
      if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
    }
  }
});

// The gate is a test file, so it is run as one: importing it would register its tests in this run.
function runGate(env) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.CW_RELEASE_REDACTIONS;
  return spawnSync(process.execPath, ['--test', '--test-reporter=spec', join(REPO, 'bin', 'test', 'release-names.test.mjs')],
    { env: childEnv, encoding: 'utf8', timeout: 120_000 });
}

test('the working-tree gate skips only where no sidecar exists, and fails when a sidecar lacks the map', () => {
  const absent = runGate({ CW_SIDECAR: join(TMP, 'no-sidecar-here') });
  assert.equal(absent.status, 0, absent.stdout + absent.stderr);
  assert.match(absent.stdout, /no sidecar at .*no-sidecar-here \(set CW_SIDECAR\)/);

  const empty = join(TMP, 'empty-sidecar');
  mkdirSync(empty);
  const missing = runGate({ CW_SIDECAR: empty });
  assert.notEqual(missing.status, 0, 'a present sidecar without the map must not pass');
  assert.match(missing.stdout, /release manifest absent at .*empty-sidecar\/monitor\/release-redactions\.json — a sidecar is present, so this is a missing input/);
});
