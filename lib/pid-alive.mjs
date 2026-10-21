// lib/pid-alive.mjs — is this pid a running process?
//
// `process.kill(pid, 0)` answers whether the pid EXISTS, and a zombie exists: it has exited and
// waits only for its parent to reap it. Where nothing reaps (a container whose PID 1 is not an
// init, a parent that never waits), every killed process stays a zombie and a bare kill(0) reads
// it as alive for good — a finished sweep looks running, a killed grandchild looks like it
// survived. So an existing pid is checked for the zombie state as well.
//
// EPERM means the pid exists under another user: alive. When the state cannot be read (no /proc,
// no ps), the answer is alive, as kill(0) said — this never reports a death it did not see.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** The kernel state letter for pid, or null when it cannot be read. */
export function processState(pid, { platform = process.platform, readFile = readFileSync, spawn = spawnSync } = {}) {
  if (platform === 'linux') {
    try {
      // /proc/<pid>/stat: "pid (comm) S ..." — comm may contain spaces and parens, so the state
      // is the first field after the LAST ')'.
      const stat = String(readFile(`/proc/${pid}/stat`, 'utf8'));
      const m = /\)\s+(\S)/.exec(stat.slice(stat.lastIndexOf(')')));
      if (m) return m[1];
    } catch { /* fall through to ps */ }
  }
  if (platform === 'win32') return null;
  const r = spawn('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const s = String(r.stdout || '').trim();
  return s ? s[0] : null;
}

export function pidAlive(pid, { kill = (p, s) => process.kill(p, s), ...probe } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { kill(pid, 0); }
  catch (e) { return !!(e && e.code === 'EPERM'); }
  return processState(pid, probe) !== 'Z';
}
