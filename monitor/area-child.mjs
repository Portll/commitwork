// One per-area child of the fleet fan-out: spawned, streamed to disk, bounded in time.
//
// A timeout kills the area child, not what it spawned: a grandchild (an `execFileSync` with
// `stdio:'inherit'` deadlocked in Node's exit teardown, say) is reparented still holding the
// inherited stdout and stderr, and a driver waiting on `close` waits for every holder of them.
//
// So the child leads its own process group and every kill targets the group, and resolution
// follows `exit` rather than waiting on `close` without bound: once the child has exited, anything
// still holding its output is a descendant it left behind, killed after STDIO_GRACE_MS and reported.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export const TAIL_BYTES = 256 * 1024;

const live = new Set();
let forwarding = false;

// Detached children leave the terminal's process group, so Ctrl-C no longer reaches them on its
// own; the driver passes it on.
function forwardSignals() {
  if (forwarding) return;
  forwarding = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      for (const pid of live) killGroup(pid, 'SIGTERM');
      process.kill(process.pid, sig);
    });
  }
}

export function killGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; } catch { return false; }
}

/**
 * @returns {Promise<{code:number, tail:string, timedOut:boolean, stdioHeld:boolean}>}
 */
export function runAreaChild({ command, args, env, logPath, timeoutMs, stdioGraceMs = 10_000, killGraceMs = 30_000 }) {
  forwardSignals();
  return new Promise((res) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const sink = createWriteStream(logPath);
    let tail = '';
    let timedOut = false;
    let stdioHeld = false;
    let done = false;
    let exitCode = null;
    let graceTimer = null;
    const absorb = (buf) => {
      const s = String(buf);
      sink.write(s);
      tail = (tail + s).slice(-TAIL_BYTES);
    };
    const finish = (code, extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      live.delete(child.pid);
      sink.end();
      res({ code: code ?? 1, tail: extra ?? tail, timedOut, stdioHeld });
    };
    if (child.pid) live.add(child.pid);
    child.stdout.on('data', absorb);
    child.stderr.on('data', absorb);
    // SIGTERM first so the child can unwind its lock, SIGKILL if it will not go.
    const timer = setTimeout(() => {
      timedOut = true;
      if (!killGroup(child.pid, 'SIGTERM')) child.kill('SIGTERM');
      setTimeout(() => { if (!killGroup(child.pid, 'SIGKILL')) { try { child.kill('SIGKILL'); } catch { /* already gone */ } } }, killGraceMs).unref();
    }, timeoutMs);
    child.on('error', (e) => finish(1, `spawn failed: ${e.message}`));
    child.on('exit', (code, signal) => {
      exitCode = code ?? (signal ? 128 : 1);
      graceTimer = setTimeout(() => {
        stdioHeld = true;
        killGroup(child.pid, 'SIGKILL');
        absorb(`\n[fleet] the area process exited ${exitCode}, but a process it started still held its output ${Math.round(stdioGraceMs / 1000)}s later; that process group was killed, so this area's slice is PARTIAL\n`);
        child.stdout.destroy();
        child.stderr.destroy();
        finish(exitCode);
      }, stdioGraceMs);
    });
    child.on('close', (code) => finish(code ?? exitCode));
  });
}
