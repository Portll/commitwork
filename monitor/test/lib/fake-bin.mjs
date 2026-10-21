// Fake CLIs for the images/* suites, emitted for whichever shell the platform actually has.
//
// WHY THIS EXISTS. Both suites wrote their fakes as `#!/bin/sh` scripts and made them executable
// with `chmod 0o755`. Neither half of that does anything on Windows: chmod is a no-op on NTFS, and
// a shebang script is not something CreateProcess can run — so `CW_DOCKER` pointed at a file the
// spawn could not execute and eleven tests failed for one reason that had nothing to do with what
// they assert. bash is an OPTIONAL install on this platform by standing instruction, so "require sh"
// was not an available answer.
//
// The behaviour is described ONCE, declaratively, and emitted as sh or as cmd. A single source
// means the two dialects cannot drift into asserting different things — which is the failure mode
// that makes per-platform test fixtures worse than no fixtures.
//
// The Windows form is a `.cmd`, which node REFUSES to spawn without a shell (the CVE-2024-27980
// mitigation, EINVAL). monitor/images.mjs therefore goes through lib/win-spawn.mjs, which routes a
// batch shim via `cmd.exe /d /s /c` with every argument validated. That is a real fix in its own
// right — an operator pointing CW_DOCKER at a wrapper .cmd hit exactly the same wall.

import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const WIN = () => process.platform === 'win32';

/**
 * Write `body` as an executable fake named `name`, logging its argv to $FAKE_LOG first.
 *
 * The log line is `<name> <args>` in both dialects. In cmd the redirection is written BEFORE the
 * echo (`>>"%FAKE_LOG%" echo ...`): the trailing-token form (`echo x>>file`) binds a final digit to
 * the redirection operator, and image tags routinely end in one.
 */
function emit(dir, name, { sh, cmd }) {
  if (WIN()) {
    const p = join(dir, `${name}.cmd`);
    writeFileSync(p, ['@echo off', `>>"%FAKE_LOG%" echo ${name} %*`, ...cmd, ''].join('\r\n'));
    return p;
  }
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\necho "${name} $@" >> "$FAKE_LOG"\n${sh.join('\n')}\n`);
  chmodSync(p, 0o755);
  return p;
}

/**
 * A fake with no dispatch: it may touch the shared `up` marker, may write to stderr, and exits.
 * Covers colima, open and osascript.
 */
export function fakeSimple(dir, name, { exit = 0, stderr = null, touchUp = false } = {}) {
  const sh = [];
  const cmd = [];
  if (touchUp) { sh.push('touch "$FAKE_DIR/up"'); cmd.push('type nul >"%FAKE_DIR%\\up"'); }
  if (stderr) { sh.push(`echo "${stderr}" >&2`); cmd.push(`>&2 echo ${stderr}`); }
  sh.push(`exit ${exit}`);
  cmd.push(`exit /b ${exit}`);
  return emit(dir, name, { sh, cmd });
}

/**
 * A fake `docker` dispatching on argv[0], covering the three subcommands these suites drive.
 *
 * info    'ok' | 'down' | 'marker'  — 'marker' answers 0 only once $FAKE_DIR/up exists, which is
 *                                     how the restart suite proves a daemon came back rather than
 *                                     taking `colima start` exiting 0 as the witness.
 * digests  a JSON array literal, or null to make `image` exit 1 outright.
 * pull     { exit, stderr, sleepSec } — sleepSec drives the pull-timeout case.
 *
 * Anything not dispatched exits 1, exactly as the hand-written `esac; exit 1` tail did.
 */
export function fakeDocker(dir, { info = 'ok', digests = '[]', pull = {} } = {}) {
  const { exit: pullExit = 0, stderr: pullStderr = null, sleepSec = 0 } = pull;

  const infoSh = info === 'marker' ? '[ -f "$FAKE_DIR/up" ] && exit 0 || exit 1'
    : `exit ${info === 'ok' ? 0 : 1}`;
  const infoCmd = info === 'marker' ? 'if exist "%FAKE_DIR%\\up" (exit /b 0) else (exit /b 1)'
    : `exit /b ${info === 'ok' ? 0 : 1}`;

  // `image inspect --format {{json .RepoDigests}}` asks for the digest list; every other `image`
  // call wants the id. The discriminator is the same in both dialects: does the argv mention
  // RepoDigests.
  const imageSh = digests === null ? 'exit 1'
    : `case "$*" in *RepoDigests*) echo '${digests}';; *) echo sha256:id;; esac; exit 0`;
  const imageCmd = digests === null ? ['exit /b 1'] : [
    'echo %*| findstr /C:"RepoDigests" >nul',
    `if errorlevel 1 (echo sha256:id) else (echo ${digests})`,
    'exit /b 0',
  ];

  const pullSh = [];
  const pullCmd = [];
  // `ping -n <n+1> 127.0.0.1` is the portable cmd sleep. `timeout /t` reads the console and errors
  // with "Input redirection is not supported" the moment stdin is a pipe, which it always is here.
  if (sleepSec) { pullSh.push(`sleep ${sleepSec}`); pullCmd.push(`ping -n ${sleepSec + 1} 127.0.0.1 >nul`); }
  if (pullStderr) { pullSh.push(`echo "${pullStderr}" >&2`); pullCmd.push(`>&2 echo ${pullStderr}`); }
  pullSh.push(`exit ${pullExit}`);
  pullCmd.push(`exit /b ${pullExit}`);

  const sh = [
    'case "$1" in',
    `  info) ${infoSh};;`,
    `  image) ${imageSh};;`,
    `  pull) ${pullSh.join('; ')};;`,
    'esac; exit 1',
  ];

  // GOTO LABELS, not parenthesised if-blocks. cmd parses a whole `( … )` block before running it,
  // so a nested `if errorlevel 1 (…) else (…)` inside one is a parse hazard for no benefit. Labels
  // keep each branch a plain sequence of statements.
  const cmd = [
    'if "%1"=="info" goto :cw_info',
    'if "%1"=="image" goto :cw_image',
    'if "%1"=="pull" goto :cw_pull',
    'exit /b 1',
    ':cw_info',
    infoCmd,
    ':cw_image',
    ...imageCmd,
    ':cw_pull',
    ...pullCmd,
  ];

  return emit(dir, 'docker', { sh, cmd });
}
