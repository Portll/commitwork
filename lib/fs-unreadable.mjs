// Make a path genuinely unreadable, on whichever platform the test is running on.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// This repository asserts "an unreadable X is UNKNOWN, never empty" in a dozen places, and every one
// of them constructed the unreadable X with `chmodSync(p, 0o000)`. On Windows that is a NO-OP:
// node's chmod maps only the read-only bit, and read access is not removable that way. Measured
// 2026-09-04 — `mkdir` inside a 0555 directory succeeds, and a 0000 file reads back fine.
//
// So the jail was not a jail. The code under test read the file, parsed it, and returned a normal
// result; the assertion then failed with `true !== false` and looked like a defect in the module
// being tested rather than in the fixture. Four separate suites were failing this way before this
// helper existed (lockfile, scan-scope, secrets-sweep, verdict-journal), and the temptation each
// time was to skip the test on Windows — which would have deleted the coverage rather than the
// obstacle, on exactly the properties that matter most here.
//
// ── WHAT ACTUALLY WORKS ─────────────────────────────────────────────────────────────────────────
// `icacls <path> /deny <user>:(R)` removes read access for real. Verified on this box: the
// subsequent readFileSync throws **EPERM** where POSIX throws EACCES. Both mean "the filesystem
// refused", which is what these tests are about — so callers should match /EACCES|EPERM/ rather
// than pinning one platform's code.
//
// Falls back to a stated skip rather than a silent pass when the mechanism is unavailable: running
// elevated, an unusual ACL setup, or icacls missing. A fixture that cannot establish its own
// precondition must say so — a test that passes because its jail failed to close is worse than one
// that does not run.

import { chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const WIN = () => process.platform === 'win32';

/** The account icacls should deny. DOMAIN\user, which is what icacls expects. */
function currentUser(env = process.env) {
  const d = env.USERDOMAIN || env.COMPUTERNAME;
  const u = env.USERNAME;
  if (!u) return null;
  return d ? `${d}\\${u}` : u;
}

/**
 * Deny read access to `path`.
 * -> { ok: true, restore() } | { ok: false, why }   — never throws, so a caller can skip cleanly.
 */
export function denyRead(path, { platform = process.platform, run = spawnSync, env = process.env } = {}) {
  if (platform !== 'win32') {
    try {
      chmodSync(path, 0o000);
      return { ok: true, restore: () => { try { chmodSync(path, 0o644); } catch { /* already gone */ } } };
    } catch (e) { return { ok: false, why: `chmod failed (${e.code || e.message})` }; }
  }
  const who = currentUser(env);
  if (!who) return { ok: false, why: 'USERNAME is not set, so there is no account to deny' };
  const r = run('icacls.exe', [path, '/deny', `${who}:(R)`], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) {
    return { ok: false, why: `icacls /deny failed (${r.error?.code || `exit ${r.status}`})` };
  }
  return {
    ok: true,
    restore: () => { try { run('icacls.exe', [path, '/remove:d', who], { encoding: 'utf8', windowsHide: true }); } catch { /* best effort */ } },
  };
}

/**
 * Run `fn` with `path` unreadable, restoring access afterwards whatever happens.
 * `fn` receives nothing; it should close over `path`.
 * -> { ran: true, value } | { ran: false, why }  — `ran: false` is the caller's cue to t.skip(why).
 */
export function withUnreadable(path, fn, opts = {}) {
  const d = denyRead(path, opts);
  if (!d.ok) return { ran: false, why: d.why };
  try { return { ran: true, value: fn() }; }
  finally { d.restore(); }
}

/**
 * The errno a refused read produces, as a pattern.
 *
 * EACCES on POSIX, EPERM on Windows — measured, not assumed. A test pinning one of them is pinning
 * the platform rather than the property, which is what "a read refusal is not an absence" is
 * actually about.
 */
export const REFUSED_ERRNO = /EACCES|EPERM/;

/** True when `code` is a filesystem refusal on any platform. */
export const isRefusal = (code) => REFUSED_ERRNO.test(String(code || ''));

/** Elevated processes ignore both mechanisms, so a caller can skip honestly rather than fail. */
export function ignoresPermissions() {
  if (!WIN()) return typeof process.getuid === 'function' && process.getuid() === 0;
  return false; // an elevated Windows process still honours an explicit deny ACE for its own SID
}
