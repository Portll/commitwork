// lib/win-spawn.mjs — spawning a Windows batch shim, and refusing rather than escaping.
//
// The measurement this exists for, taken on this box 2026-09-04 with node v24.14.1:
//   spawnSync('npm', ['--version'])            -> error ENOENT   (no PATHEXT when shell is false)
//   spawnSync('…\\npm.cmd', ['--version'])      -> error EINVAL   (node refuses; CVE-2024-27980 fix)
// So bin/setup.mjs's npm manager could never install anything on Windows, and `socket` has no
// other installer. The obvious repair — `shell: true` — IS the CVE.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isBatchShim, unsafeForCmd, quoteForCmd, resolveWindowsExecutable, windowsSpawnPlan, safeSpawnSync,
} from '../win-spawn.mjs';

const BS = String.fromCharCode(92);

describe('what is a batch shim', () => {
  test('extension decides, case-insensitively', () => {
    assert.equal(isBatchShim('C:/x/npm.cmd'), true);
    assert.equal(isBatchShim('C:/x/npm.CMD'), true);
    assert.equal(isBatchShim('C:/x/thing.bat'), true);
    assert.equal(isBatchShim('C:/x/node.exe'), false);
    assert.equal(isBatchShim('/usr/bin/npm'), false);
    assert.equal(isBatchShim(''), false);
    assert.equal(isBatchShim(null), false);
    // NEGATIVE: a name merely CONTAINING .cmd is not a shim.
    assert.equal(isBatchShim('C:/x/npm.cmd.exe'), false);
  });
});

describe('argument screening', () => {
  test('POSITIVE — every cmd.exe metacharacter is caught', () => {
    // Each of these can end the intended command and begin another one inside cmd.exe.
    for (const ch of ['&', '|', '<', '>', '^', '"', '%', '!']) {
      const why = unsafeForCmd(`pkg${ch}calc.exe`);
      assert.ok(why, `${JSON.stringify(ch)} must be refused`);
      assert.match(why, /metacharacter/);
    }
    // Newlines and NUL are refused with their own reason — an embedded newline is how one
    // command becomes two, and a NUL truncates in whatever consumes it next.
    for (const ch of ['\n', '\r', '\u0000']) {
      assert.match(unsafeForCmd(`a${ch}b`), /newline or NUL/);
    }
    // The classic payloads, whole.
    assert.ok(unsafeForCmd('a&echo INJECTED'));
    assert.ok(unsafeForCmd('a"&echo INJECTED&'));
    assert.ok(unsafeForCmd('%CD%'));
    assert.ok(unsafeForCmd('!DELAYED!'));
  });

  test('NEGATIVE — ordinary package ids and Windows paths pass', () => {
    // If these were refused the guard would be useless, because this is what the arguments ARE.
    for (const ok of [
      '@socketsecurity/cli',
      'cargo-audit',
      'vimeo/psalm:6.x-dev',
      'golang.org/x/vuln/cmd/govulncheck@latest',
      '--locked',
      '-g',
      'C:/Program Files (x86)/Some App/pkg.tgz',
      `C:${BS}Users${BS}jhancock${BS}AppData${BS}Local${BS}pkg.tgz`,
      "O'Brien/package",
      'a.b-c_d+e~f',
      '',
    ]) {
      assert.equal(unsafeForCmd(ok), null, `must be allowed: ${JSON.stringify(ok)}`);
    }
  });

  test('quoting covers whitespace and parens without inventing escapes', () => {
    assert.equal(quoteForCmd('plain'), 'plain');
    assert.equal(quoteForCmd('has space'), '"has space"');
    assert.equal(quoteForCmd('C:/Program Files (x86)/x'), '"C:/Program Files (x86)/x"');
    assert.equal(quoteForCmd('(parens)'), '"(parens)"');
    assert.equal(quoteForCmd(''), '""');
    // Only whitespace and parens force quoting; an unquoted argument has no closing quote to
    // protect, so a trailing backslash is left exactly as given.
    assert.equal(quoteForCmd(`C:${BS}dir${BS}`), `C:${BS}dir${BS}`);
    // When quoting IS needed, a trailing backslash run would escape the closing quote — so it is
    // doubled. This is the one place the rule bites, and it is the case that silently eats the
    // quote and swallows the next argument when it is got wrong.
    assert.equal(quoteForCmd(`C:${BS}Program Files${BS}`), `"C:${BS}Program Files${BS}${BS}"`);
  });
});

describe('resolution', () => {
  const fixture = (hits) => ({
    spawn: () => ({ status: hits.length ? 0 : 1, stdout: hits.join('\r\n') }),
    isFile: () => true,
  });

  test('.exe is preferred over a shim when PATH offers both', () => {
    const r = resolveWindowsExecutable('thing', fixture(['C:/a/thing.cmd', 'C:/b/thing.exe']));
    assert.equal(r.kind, 'exe');
    assert.equal(r.path, 'C:/b/thing.exe');
  });

  test('the real npm layout resolves to the .cmd, not the .ps1 or the extensionless script', () => {
    // Exactly what `where.exe npm` prints on this box.
    const r = resolveWindowsExecutable('npm', fixture([
      'C:/Program Files/nodejs/npm.ps1',
      'C:/Program Files/nodejs/npm',
      'C:/Program Files/nodejs/npm.cmd',
    ]));
    assert.equal(r.kind, 'batch');
    assert.equal(r.path, 'C:/Program Files/nodejs/npm.cmd', 'PATHEXT order, not first-line order');
  });

  test('absent is its own answer, never a guess', () => {
    const r = resolveWindowsExecutable('nope', fixture([]));
    assert.equal(r.kind, 'absent');
    assert.equal(r.path, null);
  });

  test('an EXPLICIT path that does not exist is ABSENT — "given" is not "assumed to exist"', () => {
    // The first version returned the path unconditionally for anything containing a separator, so a
    // caller probing whether a tool is installed was told yes about a file that was not there.
    // bin/scanner-preflight.mjs uses exactly that probe to decide MISSING, and its "a tool that is
    // not installed reads as MISSING — a visible absence, never a pass" test caught it. A probe
    // that cannot say "no" is the grey-as-green shape, in the one file written to refuse it.
    const gone = resolveWindowsExecutable(`C:${BS}nope${BS}missing.exe`, { isFile: () => false, spawn: () => ({ status: 1 }) });
    assert.equal(gone.kind, 'absent');
    assert.equal(gone.path, null);

    // …and one that DOES exist is still taken as given, without consulting PATH.
    const there = `C:${BS}tools${BS}real.exe`;
    const found = resolveWindowsExecutable(there, {
      isFile: (p) => p === there,
      spawn: () => { throw new Error('PATH must not be searched for an explicit path'); },
    });
    assert.equal(found.path, there);
    assert.equal(found.kind, 'exe');

    // PATHEXT still applies to an EXTENSIONLESS explicit path — `C:\tools\gitleaks` may be
    // `gitleaks.exe`, and refusing that would be the opposite error.
    const base = `C:${BS}tools${BS}gitleaks`;
    const ext = resolveWindowsExecutable(base, { isFile: (p) => p === `${base}.exe`, spawn: () => ({ status: 1 }) });
    assert.equal(ext.path, `${base}.exe`);
    assert.equal(ext.kind, 'exe');
  });

  test('a name with no runnable extension is UNRUNNABLE, not assumed executable', () => {
    const r = resolveWindowsExecutable('thing', fixture(['C:/a/thing.ps1']));
    assert.equal(r.kind, 'unrunnable', 'guessing here is how you run the wrong file');
  });
});

describe('the spawn plan', () => {
  const asBatch = { platform: 'win32', spawn: () => ({ status: 0, stdout: 'C:\\n\\npm.cmd' }), isFile: () => true };
  const asExe = { platform: 'win32', spawn: () => ({ status: 0, stdout: 'C:\\n\\node.exe' }), isFile: () => true };

  test('POSIX is an untouched pass-through — there are no batch shims there', () => {
    const p = windowsSpawnPlan('npm', ['install', '-g', 'x&y'], { platform: 'linux' });
    assert.equal(p.viaCmd, false);
    assert.equal(p.file, 'npm');
    assert.deepEqual(p.args, ['install', '-g', 'x&y'], 'an & is not special to execve — refusing it would be theatre');
    assert.ok(!p.refused);
  });

  test('a real executable is spawned directly even on Windows', () => {
    const p = windowsSpawnPlan('node', ['-v'], asExe);
    assert.equal(p.viaCmd, false);
    assert.equal(p.file, 'C:\\n\\node.exe');
    assert.deepEqual(p.args, ['-v']);
  });

  test('a batch shim is routed through cmd.exe with /d /s /c', () => {
    const p = windowsSpawnPlan('npm', ['install', '-g', '@socketsecurity/cli'], asBatch);
    assert.equal(p.viaCmd, true);
    assert.equal(p.file, 'cmd.exe');
    assert.equal(p.args[0], '/d', '/d skips AutoRun — a registry command would otherwise run first, in our process');
    assert.equal(p.args[1], '/s');
    assert.equal(p.args[2], '/c');
    assert.match(p.args[3], /npm\.cmd/);
    assert.match(p.args[3], /@socketsecurity\/cli/);
  });

  test('REFUSED, not escaped — and the reason names the argument and the risk', () => {
    const p = windowsSpawnPlan('npm', ['install', '-g', 'pkg&calc.exe'], asBatch);
    assert.equal(p.refused, true);
    assert.equal(p.arg, 'pkg&calc.exe');
    assert.match(p.reason, /pkg&calc\.exe/, 'the operator is told WHICH argument');
    assert.match(p.reason, /CVE-2024-27980/, 'and why this is not pedantry');
    assert.equal(p.file, undefined, 'there is nothing to spawn — the caller must not fall through');
  });

  test('a newline in an argument is refused on EVERY platform', () => {
    // Not a cmd.exe-specific concern: an embedded newline is how one command becomes two, and
    // nothing downstream of here should have to think about it.
    for (const platform of ['linux', 'darwin', 'win32']) {
      const p = windowsSpawnPlan('npm', ['install', 'a\nrm -rf /'], { ...asBatch, platform });
      assert.equal(p.refused, true, `${platform} must refuse an embedded newline`);
    }
  });

  test('an absent command is ABSENT, not refused — those are different facts', () => {
    const p = windowsSpawnPlan('nope', [], { platform: 'win32', spawn: () => ({ status: 1, stdout: '' }), isFile: () => false });
    assert.equal(p.absent, true);
    assert.ok(!p.refused, 'not installed is not the same as dangerous, and must not read as it');
  });
});

// ── SECOND WITNESS: the real box ───────────────────────────────────────────────────────────────
// Everything above is fixtures. These run against the real Windows loader, and one of them proves
// the THREAT is real rather than quoted from an advisory.
describe('effect on this machine', () => {
  test('EFFECT: npm is a batch shim here, and safeSpawnSync runs it where spawnSync cannot', (t) => {
    if (process.platform !== 'win32') { t.skip('windows only'); return; }
    const resolved = resolveWindowsExecutable('npm');
    if (resolved.kind === 'absent') { t.skip('npm is not installed on this box'); return; }
    assert.equal(resolved.kind, 'batch', 'npm on Windows is npm.cmd — if this ever changes, so does the premise');

    // The defect, reproduced: node's own spawnSync cannot run it either way.
    const direct = spawnSync('npm', ['--version'], { encoding: 'utf8' });
    assert.ok(direct.error, 'bare spawnSync must still fail — this is what was broken');
    const explicit = spawnSync(resolved.path, ['--version'], { encoding: 'utf8' });
    assert.ok(explicit.error, 'and the explicit .cmd path is refused by node (the CVE fix)');
    assert.ok(['ENOENT', 'EINVAL'].includes(direct.error.code), `unexpected: ${direct.error.code}`);

    // The fix.
    const via = safeSpawnSync('npm', ['--version'], { encoding: 'utf8' });
    assert.ok(!via.error, `safeSpawnSync must succeed: ${via.error && via.error.code}`);
    assert.equal(via.status, 0);
    assert.match(String(via.stdout).trim(), /^\d+\.\d+\.\d+/, 'and it is npm answering, not an empty success');
  });

  test('EFFECT: the injection is real through a shell, and inert through this wrapper', (t) => {
    if (process.platform !== 'win32') { t.skip('windows only'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'cw-batbadbut-'));
    try {
      // A harmless shim that echoes its first argument. The payload only ever runs `echo`.
      const shim = join(dir, 'echoarg.cmd');
      writeFileSync(shim, '@echo off\r\necho ARG=[%~1]\r\n');
      const payload = 'safe&echo PWNED';
      const noise = /ARG=\[[^\]]*\]/g;

      // 1. THE THREAT IS REAL. With a shell, the payload executes as a second command.
      // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- test proves that a shell executes a payload; the payload is a literal in the test
      const viaShell = spawnSync(shim, [payload], { encoding: 'utf8', shell: true });
      const shellOut = `${viaShell.stdout || ''}${viaShell.stderr || ''}`.replace(noise, '');
      assert.match(shellOut, /PWNED/,
        'if this stops reproducing, node has changed its shell quoting — verify before relaxing anything here');

      // 2. AND IT IS REFUSED HERE. Not escaped, not sanitised — refused, with a reason.
      const viaGuard = safeSpawnSync(shim, [payload], { encoding: 'utf8' });
      assert.equal(viaGuard.refused, true);
      assert.equal(viaGuard.status, null, 'nothing ran at all');
      assert.match(viaGuard.reason, /metacharacter/);

      // 3. AND THE BENIGN CASE STILL WORKS through the same path — a guard that refuses
      //    everything is not a guard, it is an outage.
      const benign = safeSpawnSync(shim, ['C:/Program Files (x86)/ok'], { encoding: 'utf8' });
      assert.ok(!benign.refused, `benign argument was refused: ${benign.reason}`);
      assert.equal(benign.status, 0);
      assert.match(String(benign.stdout), /ARG=\[C:\/Program Files \(x86\)\/ok\]/,
        'the argument arrives INTACT — quoting must not corrupt what it protects');
      assert.doesNotMatch(String(benign.stdout).replace(noise, ''), /PWNED/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
