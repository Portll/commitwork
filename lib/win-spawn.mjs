// Spawning a Windows batch shim safely — and the reason there is no third option.
//
// ── WHAT IS ACTUALLY BROKEN ─────────────────────────────────────────────────────────────────────
// On Windows, most developer CLIs are not executables. `npm` is `npm.cmd`; `npx`, `gem`, `composer`
// and every npm-installed scanner CLI land the same way. Measured on this box 2026-09-04:
//
//   spawnSync('npm',  ['--version'])                     -> error ENOENT
//   spawnSync('C:\\...\\npm.cmd', ['--version'])          -> error EINVAL
//   spawnSync('git',  ['--version'])                     -> ok      (git.exe is a real executable)
//
// The first fails because Node does not apply PATHEXT when `shell` is false — it looks for a file
// named exactly `npm`. The second fails because Node ≥18.20.2 REFUSES to spawn a `.cmd`/`.bat`
// without a shell, which is the fix for CVE-2024-27980 ("BatBadBut").
//
// So bin/setup.mjs's `npm` manager — `spawnSync('npm', ['install','-g',pkg])` — could never install
// anything on Windows. It is the only installer `socket` has. Someone hit this before and patched
// ONE case: `scoop` is special-cased to `cmd /c scoop install` right there in the same table, with
// no comment saying why and nothing generalising it.
//
// ── WHY THE OBVIOUS FIX IS THE VULNERABILITY ────────────────────────────────────────────────────
// The one-line repair is `shell: true`. That is precisely BatBadBut: with a shell, Node hands the
// command line to `cmd.exe`, whose parsing rules Node's quoting does not fully contain, so an
// argument carrying `&`, `|`, `^`, `<`, `>`, `"`, `%` or `!` can END the intended command and start
// another one. Node's own answer to that CVE was to refuse the spawn rather than to escape harder,
// which is the strongest available statement that escaping is not reliably solvable.
//
// That matters here beyond theory, and the AI-as-attacker framing is the sharp version of it. This
// tool is pointed at repositories it does not trust, and argv elements downstream of that include
// repository directory names, branch names, package names read out of a lockfile, and paths taken
// from scanner output. An agent driving commitwork over a hostile repo never types the malicious
// string — it passes it along, from a file, into a spawn. The operator's only involvement is having
// asked for a scan.
//
// ── SO: REFUSE, DO NOT ESCAPE ───────────────────────────────────────────────────────────────────
// This module runs a batch shim through `cmd.exe /d /s /c` with explicit quoting, and REFUSES
// outright if any argument contains a cmd.exe metacharacter. That is safe here because it is not a
// general-purpose shell wrapper: the arguments are package ids and filesystem paths, and none of
// those legitimately needs `&|<>^"%!`. Refusing is a loud, named, testable failure; escaping is a
// silent bet against a parser whose maintainer already declined to make that bet.
//
// Paths with SPACES and PARENTHESES must keep working — `C:\Program Files (x86)\…` is not exotic,
// it is where half of Windows lives — so those are quoted, not refused.

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { extname } from 'node:path';

/** A `.cmd`/`.bat` is executed BY cmd.exe, which is what makes it dangerous and what makes it fail. */
export function isBatchShim(p) {
  return /^\.(cmd|bat)$/i.test(extname(String(p || '')));
}

// cmd.exe metacharacters. `"` is included because a quote inside a quoted argument ends the quoting
// and hands the rest to the parser as syntax; `%` and `!` are variable expansion (the second only
// with delayed expansion enabled, which we cannot rule out for a shim we did not write).
const CMD_META = /[&|<>^"%!\r\n\u0000]/;
// A NUL or a newline in an argv element is never legitimate and is refused everywhere, not just on
// the batch path — an embedded newline is how one command becomes two.
const ALWAYS_ILLEGAL = /[\r\n\u0000]/;

/**
 * -> null when `arg` is safe to pass to a batch shim, else the reason it is not.
 * Exported so a caller can validate BEFORE building a plan and give a better error than "refused".
 */
export function unsafeForCmd(arg) {
  const s = String(arg);
  if (ALWAYS_ILLEGAL.test(s)) return 'contains a newline or NUL byte';
  const m = CMD_META.exec(s);
  return m ? `contains the cmd.exe metacharacter ${JSON.stringify(m[0])}` : null;
}

/**
 * Quote one argument for `cmd.exe /c`. Only reached for arguments that already passed
 * unsafeForCmd(), so there is no metacharacter left to escape — this is purely about whitespace
 * and the trailing-backslash rule, and it is deliberately not a general escaper.
 */
export function quoteForCmd(arg) {
  const s = String(arg);
  if (s === '') return '""';
  if (!/[ \t()]/.test(s)) return s;
  // A backslash run immediately before the closing quote would escape it, so it is doubled.
  return `"${s.replace(/(\\+)$/, '$1$1')}"`;
}

// PATHEXT order decides which of npm.ps1 / npm / npm.cmd actually runs. `.exe` is preferred over a
// shim wherever both exist, because a real executable needs none of this machinery.
const EXT_PREFERENCE = ['.exe', '.com', '.cmd', '.bat'];

function isFileSync(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/**
 * What does `name` actually resolve to on this box?
 * -> { path, kind: 'exe' | 'batch' | 'absent' }
 */
export function resolveWindowsExecutable(name, { spawn = nodeSpawnSync, isFile = isFileSync } = {}) {
  const s = String(name);
  // An explicit path is taken as given — we are told what to run, not asked to search PATH. But
  // "taken as given" is not "assumed to exist": the first version returned the path unconditionally
  // for anything containing a separator, so a caller probing whether a tool is installed was told
  // yes about a file that was not there. bin/scanner-preflight.mjs uses exactly that probe to
  // decide MISSING, and its "a tool that is not installed reads as MISSING" test caught it.
  //
  // PATHEXT still applies to an extensionless explicit path — `C:\tools\gitleaks` may be
  // `gitleaks.exe` — so the known extensions are tried before giving up.
  if (/[\\/]/.test(s) || extname(s)) {
    if (isFile(s)) return { path: s, kind: isBatchShim(s) ? 'batch' : 'exe' };
    if (!extname(s)) {
      for (const ext of EXT_PREFERENCE) {
        if (isFile(s + ext)) return { path: s + ext, kind: isBatchShim(s + ext) ? 'batch' : 'exe' };
      }
    }
    return { path: null, kind: 'absent' };
  }
  const r = spawn('where.exe', [s], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) return { path: null, kind: 'absent' };
  const hits = String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!hits.length) return { path: null, kind: 'absent' };
  for (const ext of EXT_PREFERENCE) {
    const hit = hits.find((h) => extname(h).toLowerCase() === ext);
    if (hit) return { path: hit, kind: isBatchShim(hit) ? 'batch' : 'exe' };
  }
  // Something with no recognised extension (a bare `npm` shell script). Windows cannot execute it
  // directly, and guessing is how you run the wrong file.
  return { path: hits[0], kind: 'unrunnable' };
}

/**
 * The spawn plan for (command, args) on this platform.
 *
 * -> { file, args, viaCmd }            spawn this
 *  | { refused: true, reason, arg }    do NOT spawn; the reason names the offending argument
 *  | { absent: true, reason }          the command is not installed
 *
 * On anything but win32 this is a pass-through: POSIX has no batch shims and no cmd.exe.
 */
export function windowsSpawnPlan(command, args = [], opts = {}) {
  const platform = opts.platform || process.platform;
  for (const a of args) {
    if (ALWAYS_ILLEGAL.test(String(a))) {
      return { refused: true, arg: a, reason: `argument ${JSON.stringify(String(a).slice(0, 80))} contains a newline or NUL byte` };
    }
  }
  if (platform !== 'win32') return { file: command, args: [...args], viaCmd: false };

  const resolved = resolveWindowsExecutable(command, opts);
  if (resolved.kind === 'absent') {
    return { absent: true, reason: `${command} is not installed or not on PATH` };
  }
  if (resolved.kind !== 'batch') return { file: resolved.path, args: [...args], viaCmd: false };

  // A batch shim. Every argument must be inert before it goes anywhere near cmd.exe.
  for (const a of args) {
    const why = unsafeForCmd(a);
    if (why) {
      return {
        refused: true, arg: a,
        reason: `refusing to run the batch shim ${resolved.path}: argument `
          + `${JSON.stringify(String(a).slice(0, 80))} ${why}. A .cmd/.bat runs THROUGH cmd.exe, `
          + 'where that character can end this command and begin another (CVE-2024-27980). '
          + 'Escaping is not reliably solvable, which is why node itself refuses this spawn.',
      };
    }
  }
  // /d skips AutoRun (a registry-configured command that would otherwise run first, inside our
  // process, on every single spawn). /s with the whole command line wrapped fixes cmd's otherwise
  // surprising quote-stripping. /c runs and exits.
  const line = [resolved.path, ...args].map(quoteForCmd).join(' ');
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], viaCmd: true, target: resolved.path };
}

/**
 * spawnSync that works on Windows for batch shims and refuses rather than escaping.
 * Returns node's own result shape, with `refused`/`absent` added so a caller can tell a REFUSAL
 * from a command that ran and failed — those are different facts and must not share an exit code.
 */
export function safeSpawnSync(command, args = [], options = {}) {
  const plan = windowsSpawnPlan(command, args, options);
  if (plan.refused) return { status: null, error: new Error(plan.reason), refused: true, reason: plan.reason };
  if (plan.absent) return { status: null, error: Object.assign(new Error(plan.reason), { code: 'ENOENT' }), absent: true, reason: plan.reason };
  const { platform, spawn, isFile, ...spawnOptions } = options;
  const run = spawn || nodeSpawnSync;
  // `windowsVerbatimArguments` because the command line was built and quoted HERE. Letting node
  // re-quote a line that is already correct is how a working command becomes a broken one.
  return run(plan.file, plan.args, plan.viaCmd ? { ...spawnOptions, windowsVerbatimArguments: true } : spawnOptions);
}
