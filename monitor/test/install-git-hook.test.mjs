// monitor/install-git-hook.mjs — the on-commit self-monitor installer: never writes on a dry run,
// never clobbers a foreign hook, bakes the absolute node path and the registry-resolved area.
// CW_HOOKS_DIR is the fixture seam; the hook is inspected, not executed. From an undeclared
// checkout the suite SKIPS with the reason — never a silent pass.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, areaOf } from '../registry.mjs';
import { expandHome } from '../discover.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '../..');
const INSTALLER = join(CW, 'monitor', 'install-git-hook.mjs');

const run = (dir, ...args) => spawnSync(process.execPath, [INSTALLER, ...args],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_HOOKS_DIR: dir } });

// the area the installer must bake: resolved the same way it resolves it
const REG = loadRegistry({ quiet: true });
const SELF = (REG.projects || []).find((p) => p.path && resolve(expandHome(p.path)) === CW);
const AREA = SELF ? areaOf(SELF.name, REG) : null;

// Undeclared is a legitimate state of the world, not a defect — report once and stand down.
// undefined, NOT null: node:test reads `{ skip: null }` as SKIP.
const UNDECLARED = AREA
  ? undefined
  : `this checkout (${CW}) is declared in no monitor/projects.json projects[].path entry, so the `
    + 'installer has no area to bake and these assertions have nothing to assert. Remedy: run from '
    + 'the declared checkout, or declare this path in the registry.';

describe('install-git-hook — declaration-driven, fail-closed', { skip: UNDECLARED }, () => {
  test('this checkout is declared in the registry (the installer depends on it)', () => {
    assert.ok(AREA, 'no projects[] entry declares this checkout — the self-monitor cannot know its area');
  });

  test('dry run prints the hook and writes NOTHING', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-hook-'));
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN/);
    assert.equal(existsSync(join(dir, 'post-commit')), false, 'a dry run must not install');
  });

  test('--write installs an executable hook with the resolved area and the absolute node path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-hook-'));
    const r = run(dir, '--write');
    assert.equal(r.status, 0, r.stderr);
    const hook = join(dir, 'post-commit');
    const text = readFileSync(hook, 'utf8');
    assert.ok(statSync(hook).mode & 0o111, 'the hook must be executable');
    assert.match(text, new RegExp(`sweep\\.mjs" fast ${AREA}\\b`), 'the baked area must be the registry-resolved one');
    assert.ok(text.includes(process.execPath), 'the ABSOLUTE node path must be baked — GUI commits have no shell PATH');
    assert.match(text, /CW_SELF_SWEEP/, 'the runtime disable seam must exist');
    assert.match(text, /^CW_PROJECTSTATUS=0 nohup /m,
      'the hook must keep every commit from regenerating the status document');
    assert.match(text, /nohup .*&$/m, 'the sweep must detach — a commit never waits on a scan');
    // A linked worktree exports an absolute GIT_DIR to hooks; the sweep's git calls would inherit
    // it and act on this repository whatever -C names. The unset must run after CW is resolved
    // (that needs GIT_DIR) and before the sweep starts. Run the real line, not a pattern match.
    const unsetLine = text.split('\n').find((l) => l.startsWith('unset '));
    assert.ok(unsetLine, 'the hook no longer clears the repository-locating variables');
    const at = (s) => text.indexOf(s);
    assert.ok(at('CW="$(git rev-parse --show-toplevel') < at(unsetLine) && at(unsetLine) < at('nohup'), 'the unset must sit between resolving CW and starting the sweep');
    const probe = spawnSync('sh', ['-c', `${unsetLine}; env`], { encoding: 'utf8', env: { ...process.env, GIT_DIR: '/x/.git/worktrees/w', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x/i', GIT_OBJECT_DIRECTORY: '/x/o' } });
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) {
      assert.doesNotMatch(probe.stdout, new RegExp(`^${k}=`, 'm'), `${k} survives into the sweep`);
    }
    // idempotent: a second --write replaces our own hook without complaint
    const r2 = run(dir, '--write');
    assert.equal(r2.status, 0, r2.stderr);
  });

  test('the self-sweep runs from the main checkout and never from a linked worktree', () => {
    const hooks = mkdtempSync(join(tmpdir(), 'cw-hook-'));
    assert.equal(run(hooks, '--write').status, 0);
    const base = mkdtempSync(join(tmpdir(), 'cw-hook-repo-'));
    const repo = join(base, 'main');
    const wt = join(base, 'wt');
    const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=Portll', '-c', 'user.email=john@portll.net',
      '-c', `core.hooksPath=${hooks}`, ...a], { cwd, encoding: 'utf8', env: { ...process.env, CW_SELF_SWEEP: '1' } });
    try {
      assert.equal(git(base, 'init', '-q', repo).status, 0);
      assert.equal(git(repo, 'commit', '-q', '--allow-empty', '-m', 'test: add main').status, 0);
      assert.equal(git(repo, 'worktree', 'add', '-q', '--detach', wt).status, 0);
      assert.equal(git(wt, 'commit', '-q', '--allow-empty', '-m', 'test: add worktree').status, 0);
      // the hook creates reports/ synchronously before the detached sweep, so its presence is the effect
      assert.equal(existsSync(join(repo, 'reports')), true, 'positive control: the main checkout commit reached the sweep');
      assert.equal(existsSync(join(wt, 'reports')), false, 'the worktree commit reached the sweep');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('a hook this script did NOT write is never clobbered — and never uninstalled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-hook-'));
    const foreign = '#!/bin/sh\necho my own hook\n';
    writeFileSync(join(dir, 'post-commit'), foreign);
    const w = run(dir, '--write');
    assert.equal(w.status, 2, 'clobbering a foreign hook must be refused');
    assert.match(w.stderr, /refusing to clobber/);
    assert.equal(readFileSync(join(dir, 'post-commit'), 'utf8'), foreign, 'the foreign hook must be untouched');
    const u = run(dir, '--uninstall');
    assert.equal(u.status, 2, 'uninstalling a foreign hook must be refused');
    assert.equal(readFileSync(join(dir, 'post-commit'), 'utf8'), foreign);
    // --force is a --write override only; the operator who means it, means it
    const f = run(dir, '--write', '--force');
    assert.equal(f.status, 0, f.stderr);
    assert.match(readFileSync(join(dir, 'post-commit'), 'utf8'), /commitwork self-monitor/);
  });

  test('--uninstall removes our hook, and says so when nothing is installed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-hook-'));
    run(dir, '--write');
    const u = run(dir, '--uninstall');
    assert.equal(u.status, 0, u.stderr);
    assert.equal(existsSync(join(dir, 'post-commit')), false);
    const again = run(dir, '--uninstall');
    assert.equal(again.status, 0);
    assert.match(again.stdout, /nothing installed/);
  });
});
