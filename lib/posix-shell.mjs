// Resolving a POSIX shell on Windows, and deciding when a command needs one at all.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// `bin/commitwork.mjs runShell()` spawned `sh -c <cmd>` unconditionally. Measured on a stock
// Windows 11 box (2026-09-04): `sh` and `bash` are both ABSENT from PATH. `spawnSync` then sets
// `r.error.code = 'ENOENT'` and leaves `r.status === null`, and the caller inspected `r.error` only
// for `'ETIMEDOUT'` — so the ENOENT fell through to `{ ok: r.status === 0 }`, i.e. `ok: false` with
// no reason attached. Every local check on Windows became an unexplained failure, shaped exactly
// like a check that ran and exited non-zero. A missing prerequisite wearing a result's clothes.
//
// ── WHY A SHELL IS STILL REQUIRED, AND WHY THAT IS NOT A CAPITULATION ───────────────────────────
// Measured on manifests/security-baseline.json: 68 of 68 `local` commands contain POSIX shell
// syntax — `> "$CW_REPORT_DIR/x.json"`, `; echo $? >`, `${CW_SEMGREP_PRO:+--pro-intrafile}`,
// `[ -n … ] || { …; exit 1; }`. Zero are plain `prog arg arg`. These are intentional shell
// one-liners, not accidents, so there is no classifier clever enough to make them run without a
// shell, and transliterating 68 of them into PowerShell would create a second dialect to keep in
// step with the first — a worse defect than the one being fixed.
//
// What makes stock Windows work anyway: **commitwork already hard-requires git**, and Git for
// Windows ships a full POSIX shell inside its own install tree. On the same box where `sh` and
// `bash` are absent from PATH, `C:\Program Files\Git\bin\bash.exe` is present — because `git.exe`
// is. So the shell is derived from the git installation that is already a prerequisite, and a
// standard `winget install Git.Git` box needs nothing further. Git for Windows, WSL and findutils
// remain optional in the sense that matters: their ABSENCE produces a named, clearable void rather
// than a crash or a false clean.
//
// ── WHY WSL IS DELIBERATELY NOT USED, EVEN WHEN PRESENT ─────────────────────────────────────────
// `wsl.exe` IS on PATH on the measured box, and using it would be a trap. WSL runs in a different
// filesystem namespace: `C:\Repositories\x` is `/mnt/c/Repositories/x` inside it. Every manifest
// command interpolates `$CW_ROOT` and `$CW_REPORT_DIR`, which this process sets to Windows paths —
// so the shell would resolve, the command would run, and the report would be written to a path the
// caller cannot read, or not at all. A shell that succeeds while putting the evidence somewhere
// nobody looks is strictly worse than no shell, because the first is silent. Git Bash does not have
// this problem: it accepts `C:/...` and `C:\...` and shares one filesystem with the caller.

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32, posix } from 'node:path';

const WIN = () => process.platform === 'win32';

// POSIX shell syntax that cannot survive an argv-direct spawn. Conservative BY DESIGN: a false
// "needs a shell" costs one process; a false "does not need a shell" silently changes what a
// command means (an unexpanded `$VAR`, a `>` arriving as a literal argument, a `;` swallowing the
// rest of the line into argv). So anything ambiguous keeps the shell.
const SHELL_META = /[|&;<>()$`\\"'*?\[\]{}~!\n\r]/;
// A leading `VAR=value` assignment, or a shell keyword, is shell syntax with no metacharacter in it.
const SHELL_WORD = /^(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|export|set|unset|source|\.|cd|test|eval|exec|trap|local|readonly|return|shift|time)$/;
const LEADING_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** True when `cmd` must go through a POSIX shell to mean what it says. */
export function needsPosixShell(cmd) {
  const s = String(cmd || '');
  if (!s.trim()) return false;
  if (SHELL_META.test(s)) return true;
  const words = s.trim().split(/\s+/);
  if (LEADING_ASSIGN.test(words[0])) return true;
  // COMMAND POSITION ONLY. Testing every word was the first version and it was wrong in the
  // direction that costs: `trivy fs .` tripped the `.` branch — POSIX's source command — and a
  // bare `.` meaning "this directory" is the single most common argument in this whole manifest.
  // A keyword anywhere but first can only follow a `;`, `&&` or newline, every one of which is
  // already a metacharacter caught above, so the first word is the whole exposure.
  return SHELL_WORD.test(words[0]);
}

/**
 * argv for a command that needs no shell, or null when it does.
 * Only ever called after needsPosixShell() said false, so there is nothing to unquote: the absence
 * of every quote and metacharacter is precisely what "simple" means here.
 */
export function simpleArgv(cmd) {
  if (needsPosixShell(cmd)) return null;
  const argv = String(cmd || '').trim().split(/\s+/).filter(Boolean);
  return argv.length ? argv : null;
}

/**
 * argv from an operator-supplied command STRING, honouring double quotes.
 *
 * Distinct from simpleArgv() above, and the difference is the point: that one refuses anything
 * quoted, because it exists to decide whether a POSIX shell is needed and "simple" there means the
 * absence of every quote and metacharacter. This one is for the `CW_*_CMD` override seams, which
 * are split straight into argv and never see a shell — so quoting is the ONLY way to express a path
 * containing a space, and there is no shell left to interpret it.
 *
 * Three production sites split these on a bare space until 2026-09-04, resting on a stated
 * assumption that "the default paths contain no spaces". False on Windows, where the default node
 * is `C:\Program Files\nodejs\node.exe`: the split yielded ['C:\Program', 'Files\nodejs\node.exe',
 * …] and the spawn failed. Not a test-only concern — an operator pointing CW_SWEEP_CMD at anything
 * under Program Files hit exactly this, and the panel reported a job that would not start.
 *
 * Unquoted input tokenises as before, except that runs of whitespace no longer emit empty argv
 * entries — `split(' ')` did, and an empty argument is not something any caller meant.
 */
export function quotedArgv(cmd) {
  const out = [];
  let cur = '';
  let quoted = false;
  let started = false;      // distinguishes "" (a deliberate empty argument) from no argument
  for (const ch of String(cmd || '')) {
    if (ch === '"') { quoted = !quoted; started = true; continue; }
    if (!quoted && /\s/.test(ch)) {
      if (started) { out.push(cur); cur = ''; started = false; }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) out.push(cur);
  return out;
}

// ── shell resolution ───────────────────────────────────────────────────────────────────────────

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

// `where.exe`, not PowerShell's `where` alias (which is Where-Object). spawnSync bypasses
// PowerShell entirely, so the .exe is what runs — named explicitly so a reader does not
// have to know that.
function onPath(name) {
  if (WIN()) {
    const r = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return null;
    const first = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first && isFile(first) ? first : null;
  }
  const r = spawnSync('sh', ['-c', 'command -v "$1" 2>/dev/null', 'sh', name], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const first = String(r.stdout || '').trim();
  return first || null;
}

// Git for Windows lays out as <root>\cmd\git.exe with the shell at <root>\bin\bash.exe and
// <root>\usr\bin\sh.exe. `git.exe` also appears at <root>\bin\git.exe in some installs, so both
// parents are tried rather than assuming the `cmd` layout.
// These are Windows paths on every host, so win32 parses them: POSIX's path module reads
// `C:\Program Files\Git\cmd\git.exe` as one file name whose dirname is `.`.
export function shellsNearGit(gitExe) {
  if (!gitExe) return [];
  const { join, dirname } = win32;
  const out = [];
  for (const root of [dirname(dirname(gitExe)), dirname(gitExe)]) {
    out.push(join(root, 'bin', 'bash.exe'), join(root, 'usr', 'bin', 'sh.exe'), join(root, 'usr', 'bin', 'bash.exe'));
  }
  return out;
}

function wellKnownWindowsShells(env = process.env) {
  const { join } = win32;
  const roots = [
    env.ProgramFiles && join(env.ProgramFiles, 'Git'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Git'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Git'),
    env.ProgramW6432 && join(env.ProgramW6432, 'Git'),
  ].filter(Boolean);
  const out = [];
  for (const r of roots) out.push(join(r, 'bin', 'bash.exe'), join(r, 'usr', 'bin', 'sh.exe'));
  return out;
}

// Memoised on the inputs that can change it, never at module load — the env-override rule. A
// `const SHELL = resolvePosixShell()` at import would defeat CW_POSIX_SHELL for every test that
// sets it afterwards, and the test would pass while proving nothing.
let _memo = null;

/**
 * -> { path, argv0Args, source, flavour } | null
 * `argv0Args` are the args that precede the command (`['-c']`), kept as data so a future shell
 * with a different invocation does not need a second call site.
 */
export function resolvePosixShell(opts = {}) {
  const { platform = process.platform, env = process.env } = opts;
  const override = env.CW_POSIX_SHELL || '';
  // Injected probes bypass the memo entirely: a cache shared between a real resolution and a
  // fixture one would let a test's answer leak into production code and the reverse. The tests
  // that exercise the OTHER platform's branch depend on this.
  if (opts.isFile || opts.onPath) {
    return _resolve(platform, override, opts.isFile || isFile, opts.onPath || onPath, env);
  }
  const key = `${platform}\u0000${override}`;
  if (_memo && _memo.key === key) return _memo.value;
  const value = _resolve(platform, override, isFile, onPath, env);
  _memo = { key, value };
  return value;
}

export function _clearShellMemo() { _memo = null; }

function _resolve(platform, override, fileExists, pathLookup, env) {
  if (override) {
    // An override that does not exist is a configuration error worth surfacing as "no shell" —
    // not silently ignored in favour of a different shell than the operator named.
    return fileExists(override) ? { path: override, argv0Args: ['-c'], source: 'env', flavour: 'override' } : null;
  }
  if (platform !== 'win32') {
    const sh = pathLookup('sh');
    return sh ? { path: 'sh', argv0Args: ['-c'], source: 'path', flavour: 'sh' } : null;
  }
  // 1. an actual sh/bash on PATH (Git Bash added to PATH, MSYS2, Cygwin)
  for (const name of ['sh.exe', 'bash.exe', 'sh', 'bash']) {
    const p = pathLookup(name);
    if (p) return { path: p, argv0Args: ['-c'], source: 'path', flavour: 'sh' };
  }
  // 2. next to the git that commitwork already requires — the case that makes a stock box work.
  //    Measured 2026-09-04 under the real PowerShell PATH, where `sh` and `bash` are both absent:
  //    this branch resolves C:\Program Files\Git\bin\bash.exe because git.exe is on PATH.
  const git = pathLookup('git.exe') || pathLookup('git');
  for (const p of shellsNearGit(git)) {
    if (fileExists(p)) return { path: p, argv0Args: ['-c'], source: 'git-adjacent', flavour: 'git-bash' };
  }
  // 3. standard Git for Windows install locations, in case git itself is not on PATH
  for (const p of wellKnownWindowsShells(env)) {
    if (fileExists(p)) return { path: p, argv0Args: ['-c'], source: 'well-known', flavour: 'git-bash' };
  }
  return null;
}

/** The one action that clears a missing shell. Phrased for the blocked-void reason line. */
export function posixShellHint(platform = process.platform) {
  // The wording is load-bearing: "not installed" is what bin/commitwork.mjs's CLEARABLE_VOID
  // regex matches on, which is how this void is classified as one A HUMAN ACTION CLEARS rather
  // than as a structural absence. Grey with an owner, not grey without one.
  if (platform !== 'win32') return 'POSIX shell (`sh`) not installed or not on PATH';
  return 'POSIX shell not installed — install Git for Windows (`winget install -e --id Git.Git`), '
    + 'which supplies bash.exe, or set CW_POSIX_SHELL to a bash.exe path. WSL is not used: it '
    + 'resolves paths in a separate namespace and would write reports where the caller cannot read them';
}

/**
 * The spawn plan for one manifest command: argv-direct when it needs no shell, through the
 * resolved shell when it does, or a NAMED VOID when no shell exists.
 * -> { kind: 'argv'|'shell', argv, shell? } | { kind: 'no-shell', reason }
 */
export function shellPlan(cmd, opts = {}) {
  const argv = simpleArgv(cmd);
  if (argv) return { kind: 'argv', argv };
  const shell = resolvePosixShell(opts);
  if (!shell) return { kind: 'no-shell', reason: posixShellHint(opts.platform || process.platform) };
  return { kind: 'shell', shell, argv: [shell.path, ...shell.argv0Args, String(cmd)] };
}

/** PATH-ish diagnostics for `commitwork doctor`, so a missing shell is visible before a scan. */
export function shellDiagnostics(opts = {}) {
  const { platform = process.platform, env = process.env } = opts;
  const shell = resolvePosixShell(opts);
  return {
    ok: !!shell,
    path: shell ? shell.path : null,
    source: shell ? shell.source : null,
    flavour: shell ? shell.flavour : null,
    hint: shell ? null : posixShellHint(platform),
    searched: platform === 'win32'
      ? ['sh/bash on PATH', 'bash.exe beside git.exe', ...wellKnownWindowsShells(env)]
      : ['sh on PATH'],
    pathEntries: String(env.PATH || '').split((platform === 'win32' ? win32 : posix).delimiter).length,
  };
}
