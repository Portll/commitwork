// Records that a gate's reading was OBTAINED, not remembered. `digest` is of the RAW source
// output before parsing, so:
//   digest changed, reading unchanged → HEALTHY-STATIC (a corpse cannot be told apart otherwise)
//   digest unchanged across differing headSha → the source did not move (direct, not a proxy)
// `ms` cannot be produced without running. Absent is not fresh: a gate that cannot produce this
// block records measured:null, which is UNKNOWN and must never render as measured.
import { nowISO } from '../lib/clock.mjs';
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { rethrowIfBug } from './rethrow.mjs';


/** Digest of a source's raw output (16 hex chars — an equality check, not a security claim). null
 *  for null/undefined: an absent output has no digest. */
export function digestOf(raw) {
  if (raw === null || raw === undefined) return null;
  return `sha256:${createHash('sha256').update(String(raw)).digest('hex').slice(0, 16)}`;
}

/**
 * Run a measurement source and record the ACT of measuring alongside its output. `ms` is
 * wall-clock around the child, never threshold-compared. Never throws: a failed source still
 * yields a `measured` block with ok:false — an attempted-and-failed measurement is evidence.
 */
export function measuredRun(source, argv, { cwd, timeout = 300_000, now = nowISO, okExit = [0] } = {}) {
  const startedAt = now();
  const t0 = Date.now();
  let out = null;
  let code = 0;
  let ok = true;
  let detail = null;
  try {
    out = execFileSync(process.execPath, argv, {
      cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // A bug in this module rethrows; a non-zero exit or timeout is the expected failure.
    rethrowIfBug(e);
    code = typeof e.status === 'number' ? e.status : 1;
    out = typeof e.stdout === 'string' ? e.stdout : null;
    // A non-zero exit is normal for a gate-shaped source, so the caller declares which codes mean
    // "ran fine". A signal-killed child (status null → 1) must never digest its partial output as ok.
    ok = okExit.includes(code) && typeof e.stdout === 'string' && !e.signal;
    if (!ok) detail = String((e && (e.stderr || e.message)) || 'unknown').split('\n')[0].slice(0, 160);
  }
  return {
    out,
    code,
    measured: {
      source,
      at: startedAt,
      // Date.now(), not CW_NOW: the one field that proves work happened must not be env-fakeable.
      ms: Date.now() - t0,
      ok,
      exit: code,
      digest: digestOf(out),
      detail,
    },
  };
}

/**
 * measuredRun for a shell command STRING rather than a node argv (gate-tests' `npm test`). Same
 * contract, except on a nonzero exit stdout AND stderr are the output — a failing suite's output
 * IS the measurement.
 *
 * THE CALLER OWNS THE QUOTING, and on Windows that is not a formality. `execSync` runs this through
 * **cmd.exe**, which reads `>` `<` `|` `&` `^` anywhere in the line — including inside text the
 * caller meant as a payload — and does NOT treat single quotes as quoting at all.
 *
 * Measured 2026-09-04: this module's own test passed `node -e 'setInterval(()=>{},1000)'`, and
 * cmd.exe read the `>` of the ARROW FUNCTION as an output redirection. It created a file literally
 * named `{}` in the working directory — the repository root — on every test run, and the command
 * under measurement never ran as written. The unquoted `process.execPath` had already split at the
 * space in "C:\Program Files".
 *
 * That is the failure mode to keep in mind here: a mangled command still RETURNS, with an exit code
 * and output, and gets recorded as a measurement of the thing it never ran. So pass a command whose
 * every path is double-quoted (cmd.exe and sh both honour `"`), and keep program text out of the
 * command line — put it in a file. `npm test`, the only production caller, has no metacharacters
 * and is safe as written.
 */
export function measuredExec(source, cmd, { cwd, timeout = 300_000, now = nowISO, okExit = [0] } = {}) {
  const startedAt = now();
  const t0 = Date.now();
  let out = null;
  let code = 0;
  let ok = true;
  let detail = null;
  try {
    out = execSync(cmd, {
      cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    rethrowIfBug(e);
    code = typeof e.status === 'number' ? e.status : 1;
    out = `${String(e.stdout || '')}\n${String(e.stderr || '')}`;
    // Same rules as measuredRun: caller-declared exits, and a signal-killed child is never ok.
    ok = okExit.includes(code) && !e.signal;
    if (!ok) detail = String((e && (e.stderr || e.message)) || 'unknown').split('\n')[0].slice(0, 160);
  }
  return {
    out,
    code,
    measured: { source, at: startedAt, ms: Date.now() - t0, ok, exit: code, digest: digestOf(out), detail },
  };
}

/**
 * The `measured` block for a reading obtained IN THIS PROCESS (a gate that is its own scanner, or
 * one handed its reading on argv). `raw` must already be the STABLE form — strip volatile fields
 * before calling, or the digest moves every run and can never say "stuck". `ms` defaults to 0.
 */
export function measuredInProcess(source, raw, { ms = 0, ok = true, detail = null, now = nowISO } = {}) {
  return { source, at: now(), ms, ok, exit: ok ? 0 : 1, digest: digestOf(raw), detail };
}

/** The `measured` block for a reading taken from a FILE. The `artifact:` prefix on `source` is
 *  load-bearing — a pinned fixture is the state a stuck gate is IN, and the canary asserts on it. */
export function measuredFromArtifact(path, raw, { ok = raw !== null, now = nowISO } = {}) {
  return { source: `artifact:${path}`, at: now(), ms: 0, ok, exit: ok ? 0 : 1, digest: digestOf(raw), detail: null };
}

/** True when two records observed the same source output. Null-safe: unknown never equals unknown. */
export function sameSource(a, b) {
  const da = a && a.digest;
  const db = b && b.digest;
  if (!da || !db) return null;      // one of them did not record — UNKNOWN, never "different"
  return da === db;
}
