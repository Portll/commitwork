// Killing a timed-out check and everything it started, on every platform.
//
// bin/commitwork.mjs did `process.kill(-r.pid, 'SIGKILL')` inside a bare catch. The negative-pid
// convention is "the process GROUP led by pid", which exists on POSIX and does not exist on
// Windows; `SIGKILL` is likewise not a Windows signal. On win32 that call throws (EINVAL/ESRCH),
// the bare catch discards it, and the check's CHILDREN outlive the timeout — while the comment
// above the call site correctly explains that killing the shell alone is not enough, precisely
// because the children outlive it. `detached: true` does not create a killable group on Windows
// either, so there was nothing to kill even if the signal had been right.
//
// The other half of the fix is that a FAILED kill is now a fact the caller can report. A timeout
// record that says "killed" when a scanner is still running — still writing into the report
// directory the next check is about to read — is a false statement about the machine's state, and
// it is the kind that gets believed because nothing contradicts it.

import { spawnSync } from 'node:child_process';

/**
 * Kill `pid` and its descendants.
 * -> { ok, method, survived, error }
 *   ok       — the kill was ISSUED successfully (a process that had already exited counts: the
 *              post-condition "this tree is not running" holds either way)
 *   survived — true when we could not establish that; the caller must not claim a clean kill
 */
export function killTree(pid, { platform = process.platform, spawn = spawnSync, kill = null } = {}) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return { ok: false, method: 'none', survived: true, error: `not a pid: ${pid}` };
  }
  if (platform === 'win32') {
    // /T = terminate this pid and every child it spawned. /F = force. argv array, no shell —
    // the pid is numeric and validated above, but the habit is the point.
    const r = spawn('taskkill.exe', ['/T', '/F', '/PID', String(pid)], { encoding: 'utf8', windowsHide: true });
    if (r.error) return { ok: false, method: 'taskkill', survived: true, error: r.error.code || String(r.error) };
    // 128 = "process not found": it exited on its own between the timeout and the kill. The
    // post-condition holds, so this is success, not a swallowed failure.
    if (r.status === 0 || r.status === 128) {
      return { ok: true, method: 'taskkill', survived: false, error: null, alreadyGone: r.status === 128 };
    }
    return {
      ok: false, method: 'taskkill', survived: true,
      error: `taskkill exited ${r.status}${(r.stderr || '').trim() ? `: ${String(r.stderr).trim().slice(0, 200)}` : ''}`,
    };
  }
  const send = kill || ((p, sig) => process.kill(p, sig));
  // Group first — that is the whole reason the child was spawned detached.
  try { send(-pid, 'SIGKILL'); return { ok: true, method: 'group', survived: false, error: null }; }
  catch (e) {
    if (e && e.code === 'ESRCH') return { ok: true, method: 'group', survived: false, error: null, alreadyGone: true };
    // A group kill can fail while the leader is still killable (never became a group leader).
    // Killing the leader is strictly better than killing nothing, and `survived` stays true
    // because the descendants are then genuinely unaccounted for.
    try { send(pid, 'SIGKILL'); return { ok: true, method: 'leader-only', survived: true, error: `group kill failed: ${e.code || e}` }; }
    catch (e2) {
      if (e2 && e2.code === 'ESRCH') return { ok: true, method: 'leader-only', survived: false, error: null, alreadyGone: true };
      return { ok: false, method: 'group', survived: true, error: `${e.code || e}; then ${e2.code || e2}` };
    }
  }
}

/** A human clause for the timeout reason line. Empty string when there is nothing to add. */
export function describeKill(res) {
  if (!res) return '';
  if (res.ok && res.alreadyGone) return '; the process had already exited';
  if (res.ok && !res.survived) return '';
  if (res.ok && res.survived) return `; WARNING: only the leader was killed (${res.error}) — child processes may still be running and writing`;
  return `; WARNING: the kill FAILED (${res.error}) — the process tree may still be running and writing into the report directory`;
}
