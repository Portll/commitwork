import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  needsPosixShell, simpleArgv, resolvePosixShell, posixShellHint, shellPlan,
  shellDiagnostics, shellsNearGit, _clearShellMemo, quotedArgv } from '../posix-shell.mjs';

// ── needsPosixShell: the classifier ────────────────────────────────────────────────────────────
// The direction that LIES is the false negative: declaring a shell command simple silently changes
// what it means (an unexpanded $VAR, a `>` arriving as a literal argument). So false negatives are
// asserted separately and in bulk against the real manifest below.

test('POSITIVE — every shape of POSIX syntax is recognised as needing a shell', () => {
  const needs = [
    'echo $? > f',                       // redirection + expansion
    'a && b',                            // conjunction
    'a || true',                         // the manifests use this constantly
    'a; b',                              // sequence
    'a | b',                             // pipeline
    'x=$(cmd)',                          // substitution
    'foo "$CW_ROOT/bin/x.sh"',           // quoting + variable
    'test -r x || exit 1',               // keyword
    '[ -n "$V" ] && y',                  // bracket test
    'export A=1',                        // keyword
    'CW_X=1 prog',                       // leading assignment, no metacharacter at all
    'ls *.json',                         // glob
    'cmd 2>&1',                          // fd redirection
    'cmd ${V:-d}',                       // default expansion
    'cmd `back`',                        // backtick
    'cmd \\\n more',                     // continuation
    'if x; then y; fi',
  ];
  for (const cmd of needs) {
    assert.equal(needsPosixShell(cmd), true, `must need a shell: ${JSON.stringify(cmd)}`);
    assert.equal(simpleArgv(cmd), null, `must refuse argv-direct: ${JSON.stringify(cmd)}`);
  }
});

test('NEGATIVE — a genuinely plain command is argv-direct, and splits correctly', () => {
  assert.equal(needsPosixShell('node bin/x.mjs --out reports'), false);
  assert.deepEqual(simpleArgv('node bin/x.mjs --out reports'), ['node', 'bin/x.mjs', '--out', 'reports']);
  assert.deepEqual(simpleArgv('  trivy   fs   .  '), ['trivy', 'fs', '.'], 'runs of whitespace collapse');
  assert.equal(needsPosixShell(''), false, 'empty is not a shell command');
  assert.equal(simpleArgv(''), null, 'empty yields no argv rather than an empty one');
  assert.equal(needsPosixShell('   '), false);
});

test('the real manifest is 100% shell-requiring — the classifier is not quietly downgrading it', () => {
  // This is the measurement that made W1 a resolution problem rather than a translation problem,
  // and it is asserted rather than remembered: if a future manifest command becomes argv-direct,
  // that is a real change and someone should look at it deliberately.
  const manifest = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
  const cmds = manifest.checks.flatMap((c) => c.local || []);
  assert.ok(cmds.length >= 60, `expected the baseline's local commands, got ${cmds.length}`);
  const simple = cmds.filter((c) => !needsPosixShell(c));
  assert.deepEqual(simple, [], 'no baseline command is argv-direct; if one now is, verify it by hand');
});

// ── resolution ─────────────────────────────────────────────────────────────────────────────────

test('POSIX: sh on PATH resolves; sh absent is a NULL, never a guess', () => {
  const found = resolvePosixShell({ platform: 'linux', env: {}, onPath: (n) => (n === 'sh' ? '/bin/sh' : null), isFile: () => true });
  assert.equal(found.path, 'sh');
  assert.equal(found.source, 'path');
  const none = resolvePosixShell({ platform: 'linux', env: {}, onPath: () => null, isFile: () => false });
  assert.equal(none, null, 'no shell is null — the caller must render a void, not fall back');
});

test('WINDOWS: with sh and bash both absent from PATH, the shell is found beside git.exe', () => {
  // This is the stock-Windows-11 case measured on 2026-09-04, reproduced as a fixture.
  const git = 'C:\\Program Files\\Git\\cmd\\git.exe';
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const r = resolvePosixShell({
    platform: 'win32',
    env: {},
    onPath: (n) => (n === 'git.exe' ? git : null),   // sh/bash absent, exactly as measured
    isFile: (p) => p === bash,
  });
  assert.equal(r.path, bash);
  assert.equal(r.source, 'git-adjacent', 'the git install is the source of the shell on a stock box');
  assert.equal(r.flavour, 'git-bash');
});

test('WINDOWS: no git and no Git-for-Windows install is a named void, not a crash', () => {
  const r = resolvePosixShell({ platform: 'win32', env: {}, onPath: () => null, isFile: () => false });
  assert.equal(r, null);
  const hint = posixShellHint('win32');
  assert.match(hint, /Git for Windows/, 'the hint names the one action that clears it');
  assert.match(hint, /not installed/, 'CLEARABLE_VOID in bin/commitwork.mjs matches on this phrase');
  assert.match(hint, /CW_POSIX_SHELL/, 'the override is discoverable from the error');
});

test('WSL is never selected, even when wsl.exe is the only thing available', () => {
  // Deliberate: WSL resolves C:\x as /mnt/c/x, so $CW_REPORT_DIR would be written inside the WSL
  // namespace — the report lands where the caller cannot read it. A silent wrong answer.
  const probed = [];
  const r = resolvePosixShell({
    platform: 'win32', env: {},
    onPath: (n) => { probed.push(n); return n.startsWith('wsl') ? 'C:\\WINDOWS\\system32\\wsl.exe' : null; },
    isFile: () => false,
  });
  assert.equal(r, null, 'wsl.exe present must NOT satisfy the shell requirement');
  assert.ok(!probed.some((n) => n.includes('wsl')), 'wsl is not even probed for');
});

test('CW_POSIX_SHELL wins, and an override that does not exist is a void — not a silent fallback', () => {
  const ok = resolvePosixShell({ platform: 'win32', env: { CW_POSIX_SHELL: 'D:\\sh.exe' }, isFile: (p) => p === 'D:\\sh.exe', onPath: () => null });
  assert.equal(ok.path, 'D:\\sh.exe');
  assert.equal(ok.source, 'env');
  const bad = resolvePosixShell({ platform: 'win32', env: { CW_POSIX_SHELL: 'D:\\nope.exe' }, isFile: () => false, onPath: () => 'C:\\Program Files\\Git\\bin\\bash.exe' });
  assert.equal(bad, null, 'an operator who named a shell must not silently get a different one');
});

test('the env is read at CALL time, so an override set after import still takes effect', () => {
  _clearShellMemo();
  const before = resolvePosixShell();
  const saved = process.env.CW_POSIX_SHELL;
  try {
    process.env.CW_POSIX_SHELL = join(tmpdir(), 'definitely-not-a-shell-' + process.pid);
    const after = resolvePosixShell();
    assert.equal(after, null, 'a module-load capture would have returned the cached real shell here');
    assert.notDeepEqual(after, before);
  } finally {
    if (saved === undefined) delete process.env.CW_POSIX_SHELL; else process.env.CW_POSIX_SHELL = saved;
    _clearShellMemo();
  }
});

test('shellsNearGit covers both Git-for-Windows layouts and tolerates no git at all', () => {
  const c = shellsNearGit('C:\\Program Files\\Git\\cmd\\git.exe');
  assert.ok(c.includes('C:\\Program Files\\Git\\bin\\bash.exe'));
  assert.ok(c.includes('C:\\Program Files\\Git\\usr\\bin\\sh.exe'));
  assert.deepEqual(shellsNearGit(null), [], 'no git is an empty candidate list, not a throw');
});

// ── shellPlan: what the runner actually does ───────────────────────────────────────────────────

test('shellPlan returns a NAMED VOID rather than an unexplained failure when no shell exists', () => {
  const p = shellPlan('echo $? > f', { platform: 'win32', env: {}, onPath: () => null, isFile: () => false });
  assert.equal(p.kind, 'no-shell');
  assert.match(p.reason, /not installed/);
  assert.equal(p.argv, undefined, 'there is no argv to run — the caller must not spawn anything');
});

test('shellPlan passes the command as ONE bounded argument, never interpolated', () => {
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const cmd = 'trivy fs . > "$CW_REPORT_DIR/t.json"; echo $? > "$CW_REPORT_DIR/t.json.exit"';
  const p = shellPlan(cmd, {
    platform: 'win32', env: {},
    onPath: (n) => (n === 'git.exe' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : null),
    isFile: (x) => x === bash,
  });
  assert.equal(p.kind, 'shell');
  assert.deepEqual(p.argv, [bash, '-c', cmd]);
  assert.equal(p.argv.length, 3, 'exactly three argv elements: the shell, -c, and the whole command');
});

test('shellPlan uses no shell at all for a plain command', () => {
  const p = shellPlan('node bin/x.mjs --out r', { platform: 'win32', env: {}, onPath: () => null, isFile: () => false });
  assert.equal(p.kind, 'argv', 'a simple command must not be blocked by a missing shell');
  assert.deepEqual(p.argv, ['node', 'bin/x.mjs', '--out', 'r']);
});

// ── second witness: the resolved shell actually runs POSIX syntax on THIS box ───────────────────
// A resolver that returns a plausible path is not a resolver that returns a working shell. This
// asserts the EFFECT — a POSIX-only construct evaluating correctly — through the same plan the
// runner uses, and cannot share a failure mode with the path-probing above.

test('EFFECT: the resolved shell evaluates POSIX syntax, writes where told, and reports $?', (t) => {
  const plan = shellPlan('printf %s "$CW_TEST_V" > "$CW_TEST_OUT"; echo $? > "$CW_TEST_OUT.exit"');
  if (plan.kind === 'no-shell') {
    t.skip(`no POSIX shell on this box: ${plan.reason}`);
    return;
  }
  assert.equal(plan.kind, 'shell');
  const dir = mkdtempSync(join(tmpdir(), 'cw-shell-'));
  const out = join(dir, 'v.txt');
  const [file, ...args] = plan.argv;
  const r = spawnSync(file, args, {
    encoding: 'utf8',
    env: { ...process.env, CW_TEST_V: 'hello-from-posix', CW_TEST_OUT: out },
  });
  assert.equal(r.error, undefined, `the resolved shell must be executable: ${r.error && r.error.code}`);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  // The effect, not a marker: variable expansion, redirection to a Windows path, and $? capture.
  assert.equal(readFileSync(out, 'utf8'), 'hello-from-posix', 'expansion and redirection both worked');
  assert.equal(readFileSync(`${out}.exit`, 'utf8').trim(), '0', '$? was captured, as every manifest command does');
});

test('diagnostics name where we looked, so an absence is diagnosable rather than mysterious', () => {
  const d = shellDiagnostics({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, onPath: () => null, isFile: () => false });
  assert.equal(d.ok, false);
  assert.ok(d.searched.length >= 3);
  assert.ok(d.searched.some((s) => /git\.exe/.test(s)), 'the git-adjacent probe is disclosed');
  assert.match(d.hint, /Git for Windows/);
  const good = shellDiagnostics();
  assert.equal(typeof good.ok, 'boolean');
});

// ── quotedArgv: the CW_*_CMD override seams ─────────────────────────────────────────────────────
// Distinct from simpleArgv above, which REFUSES quoted input because it decides whether a POSIX
// shell is needed. These seams are split straight into argv and never reach a shell, so a double
// quote is the only way to express a path containing a space and nothing downstream will undo it.

test('quotedArgv: an unquoted command tokenises exactly as the old bare split did', () => {
  assert.deepEqual(quotedArgv('node script.mjs'), ['node', 'script.mjs']);
  assert.deepEqual(quotedArgv('npm test'), ['npm', 'test']);
  assert.deepEqual(quotedArgv('node monitor/sweep.mjs all --dry'),
    ['node', 'monitor/sweep.mjs', 'all', '--dry']);
});

test('quotedArgv: THE REGRESSION — a Windows path with a space survives as ONE argument', () => {
  // `C:\Program Files\nodejs\node.exe` under the old `.split(' ')` became ['C:\Program', ...] and
  // the spawn failed. Three production seams did this, and the panel reported a job that would not
  // start rather than a command it could not parse.
  const argv = quotedArgv('"C:\Program Files\nodejs\node.exe" "C:\a b\stub.mjs" --flag');
  assert.deepEqual(argv, ['C:\Program Files\nodejs\node.exe', 'C:\a b\stub.mjs', '--flag']);
  assert.equal(argv.length, 3, 'a quoted path must not be split at its spaces');
});

test('quotedArgv: the old split is genuinely broken on that input — this is not a no-op fix', () => {
  // The negative control. If this ever stops failing, the fix above is protecting nothing.
  const naive = '"C:\Program Files\nodejs\node.exe" x.mjs'.split(' ');
  assert.notEqual(naive.length, 2, 'the bare split must be shown to mis-tokenise the case fixed here');
  assert.equal(naive[0], '"C:\Program', 'and this is exactly what reached spawn as the executable');
});

test('quotedArgv: whitespace runs, empties and an explicit empty argument', () => {
  assert.deepEqual(quotedArgv('a  b'), ['a', 'b'], 'a run of spaces emits no empty argv entry');
  assert.deepEqual(quotedArgv('a\tb'), ['a', 'b'], 'tabs separate too');
  assert.deepEqual(quotedArgv(''), []);
  assert.deepEqual(quotedArgv('   '), []);
  assert.deepEqual(quotedArgv(undefined), [], 'an unset env var is no command, never a crash');
  assert.deepEqual(quotedArgv('a "" b'), ['a', '', 'b'],
    'an explicitly quoted empty string IS an argument, and is distinguishable from absence');
});
