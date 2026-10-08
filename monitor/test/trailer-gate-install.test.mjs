// node --test monitor/test/  — the commit message gate's INSTALLER, and its independence from
// the registry.
//
// WHY THIS EXISTS, and why it is a separate file from install-git-hook.test.mjs. That suite
// self-skips with a stated reason when monitor/projects.json declares no entry for this checkout —
// honest, but it means the installer has ZERO coverage in exactly the condition this repo was in on
// 2026-09-01, when projects.json was absent on disk AND 0 in HEAD.
//
// That condition is not hypothetical and it broke the gate. The trailer gate and the post-commit
// self-monitor shared one script; selfArea() exits 2 when no registry entry declares the checkout,
// and it ran FIRST, so a missing registry made the gate uninstallable — a rule with no enforcement,
// silent about it. The fix was to install the gate before, and independently of, the self-monitor.
//
// So these tests must not inherit the dependency they exist to prove is gone. They drive the
// installer through CW_HOOKS_DIR (the documented fixture seam) and assert the gate lands and works
// whatever the registry says. A test that skipped here would reproduce the original defect.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALLER = join(CW, 'monitor', 'install-git-hook.mjs');
const TRAILER = 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>';

// The npm lifecycle path installs only when the checkout opts in, so these runs opt in.
const run = (args, hooksDir, env = { CW_INSTALL_HOOKS: '1' }) => spawnSync(process.execPath, [INSTALLER, ...args],
  { encoding: 'utf8', env: { ...process.env, CW_HOOKS_DIR: hooksDir, ...env } });
const scratch = () => mkdtempSync(join(tmpdir(), 'cw-gatehooks-'));

describe('the gate installs regardless of the registry', () => {
  test('--prepare installs commit-msg and exits 0 even when no registry declares this checkout', () => {
    // The exact 2026-09-01 condition. Exit 0 matters twice: npm install must not fail for everyone,
    // and the gate must still be there afterwards.
    const d = scratch();
    try {
      const r = run(['--write', '--prepare'], d);
      assert.equal(r.status, 0, `must not fail an install\n${r.stderr}`);
      assert.ok(existsSync(join(d, 'commit-msg')), 'the gate was not installed');
      assert.match(r.stdout, /commit message gate/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a self-monitor it cannot resolve is REPORTED, not silent', () => {
    // Tolerating the failure is right; hiding it is not. If the registry is missing the operator
    // needs to know the post-commit half is absent, or they will assume the sweep is running.
    const d = scratch();
    try {
      const r = run(['--write', '--prepare'], d);
      if (existsSync(join(d, 'post-commit'))) return; // registry present on this machine — nothing to assert
      assert.match(r.stderr, /self-monitor post-commit hook NOT installed/);
      assert.match(r.stderr, /commit message gate above is unaffected/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the installed hook actually refuses', () => {
  // Asserting the file exists is a marker test. What matters is that the thing it wrote enforces.
  test('it blocks a trailer, passes a clean message, and catches the space-before-colon variant', () => {
    const d = scratch();
    try {
      assert.equal(run(['--write', '--prepare'], d).status, 0);
      const hook = join(d, 'commit-msg');
      const msg = (text) => { const p = join(d, 'MSG'); writeFileSync(p, text); return p; };
      assert.notEqual(spawnSync(hook, [msg(`s\n\n${TRAILER}\n`)], { encoding: 'utf8' }).status, 0, 'plain trailer');
      // `Co-Authored-By : x` IS a trailer git honours and normalises — measured with
      // `git interpret-trailers --parse`. Anchoring on '^Co-Authored-By:' misses exactly this one.
      assert.notEqual(spawnSync(hook, [msg('s\n\nCo-Authored-By : x <y@z>\n')], { encoding: 'utf8' }).status, 0, 'space before colon');
      assert.equal(spawnSync(hook, [msg('fix(bin): refuse a forbidden trailer\n\nan ordinary body\n')], { encoding: 'utf8' }).status, 0, 'clean message must pass');
      assert.notEqual(spawnSync(hook, [msg('fix(bin): the gate refuses a trailer\n')], { encoding: 'utf8' }).status, 0, 'a declarative subject');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('it refuses to clobber, without failing the install', () => {
  test('a foreign commit-msg hook is left alone and --prepare still exits 0', () => {
    // Someone else's hook is theirs. Under npm install, refusing to overwrite must not become a
    // refusal to install the package — but it must say the gate is NOT in place, never imply it is.
    const d = scratch();
    try {
      const foreign = join(d, 'commit-msg');
      writeFileSync(foreign, '#!/bin/sh\n# somebody else wrote this\nexit 0\n'); chmodSync(foreign, 0o755);
      const r = run(['--write', '--prepare'], d);
      assert.equal(r.status, 0, 'must not fail the install');
      assert.match(readFileSync(foreign, 'utf8'), /somebody else wrote this/, 'the foreign hook was clobbered');
      assert.match(r.stderr, /refusing to clobber/);
      assert.match(r.stderr, /commit message gate is NOT installed here/, 'must not imply the gate is in place');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the two halves stay decoupled', () => {
  // THE REGRESSION GUARD. monitor/test/install-git-hook.test.mjs cannot be this test: it self-skips
  // when the registry declares no entry for this checkout, which is the exact condition being
  // asserted — it passes 5/5 today only because the registry happens to be present again. So the
  // coupling that broke the gate on 2026-09-01 would come back green there.
  //
  // What broke: selfArea() exits 2 when no registry declares the checkout, and it ran BEFORE the
  // commit-msg block, so a missing registry made the gate uninstallable. The fix was ordering, and
  // ordering is exactly the kind of thing a later edit reverts without noticing.
  test('the gate installs even when the self-monitor half cannot resolve an area', () => {
    const d = scratch();
    try {
      // CW_REGISTRY at a path with no registry => registryDeclaresSelf() is false => the
      // self-monitor must bail. The gate must be installed anyway, and BEFORE that bail.
      const r = spawnSync(process.execPath, [INSTALLER, '--write', '--prepare'], {
        encoding: 'utf8',
        env: { ...process.env, CW_HOOKS_DIR: d, CW_REGISTRY: join(d, 'no-such-registry.json'), CW_INSTALL_HOOKS: '1' },
      });
      assert.equal(r.status, 0, `--prepare must not fail an install\n${r.stderr}`);
      assert.ok(existsSync(join(d, 'commit-msg')),
        'the gate did not install — the self-monitor half is load-bearing for it again');
      assert.ok(!existsSync(join(d, 'post-commit')),
        'fixture precondition: the self-monitor should NOT have installed without a declared area');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the npm lifecycle is wired', () => {
  test('without CW_INSTALL_HOOKS, --prepare installs nothing and exits 0; --write alone still installs', () => {
    const d = scratch();
    try {
      const r = run(['--write', '--prepare'], d, { CW_INSTALL_HOOKS: '' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /npm `prepare` is opt-in/);
      assert.ok(!existsSync(join(d, 'commit-msg')), 'a consumer clone got a hook it did not ask for');
      // Not the exit code: with no registry declaring this checkout (CI, a fresh clone) the
      // self-monitor half fails closed AFTER the gate is written. The gate is the claim here.
      run(['--write'], d, { CW_INSTALL_HOOKS: '', CW_REGISTRY: join(d, 'no-such-registry.json') });
      assert.ok(existsSync(join(d, 'commit-msg')), 'an interactive --write must still install');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('package.json prepare runs the installer in --prepare mode', () => {
    // The installer runs on every npm install; whether it writes hooks is the checkout's choice
    // (CW_INSTALL_HOOKS=1), so a consumer clone gets none it did not ask for.
    const pkg = JSON.parse(readFileSync(join(CW, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts?.prepare, 'no prepare script — a fresh clone gets no gate');
    assert.match(pkg.scripts.prepare, /install-git-hook\.mjs/);
    assert.match(pkg.scripts.prepare, /--prepare/, 'must use the non-fatal mode, or a bad registry fails npm install');
    assert.match(pkg.scripts.prepare, /--write/, 'a dry run installs nothing');
  });
});
