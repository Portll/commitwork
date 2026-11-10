// slot-lib.mjs: the root supervisor's filesystem, process and cgroup steps, each testable alone.
import { readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';

/** Empty `dir` without removing it: the work volume's mount point must survive the wipe. */
export function wipe(dir) {
  if (!existsSync(dir)) return 0;
  const entries = readdirSync(dir);
  for (const e of entries) rmSync(`${dir}/${e}`, { recursive: true, force: true });
  return entries.length;
}

/** Pids under /proc whose real uid is `uid`. */
export function pidsOf(uid, proc = '/proc') {
  const out = [];
  for (const d of readdirSync(proc)) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const m = /^Uid:\s+(\d+)/m.exec(readFileSync(`${proc}/${d}/status`, 'utf8'));
      if (m && Number(m[1]) === uid) out.push(Number(d));
    } catch { /* exited between readdir and read */ }
  }
  return out;
}

/** SIGKILL every process of `uid` until none is left, so a daemon the job forked cannot outlive it. */
export function killAll(uid, { rounds = 20, kill = process.kill, list = pidsOf } = {}) {
  let killed = 0;
  for (let i = 0; i < rounds; i++) {
    const pids = list(uid);
    if (!pids.length) return { killed, left: 0 };
    for (const p of pids) { try { kill(p, 'SIGKILL'); killed++; } catch { /* already gone */ } }
  }
  return { killed, left: list(uid).length };
}

const kv = (text) => Object.fromEntries(String(text).trim().split('\n').filter(Boolean)
  .map((l) => l.split(/\s+/)).map(([k, v]) => [k, Number(v)]));

/** io.stat lines summed across devices. */
export function ioTotals(text) {
  const sum = { rbytes: 0, wbytes: 0 };
  for (const line of String(text).trim().split('\n').filter(Boolean)) {
    for (const f of line.split(/\s+/).slice(1)) {
      const [k, v] = f.split('=');
      if (k in sum) sum[k] += Number(v);
    }
  }
  return sum;
}

/**
 * This container's lifetime totals, read from its own cgroup. Restart recreates the cgroup, so
 * these are one job's figures; the meter's 2 s samples would lose the tail.
 */
export function cgroupTotals(root = '/sys/fs/cgroup', read = (f) => readFileSync(`${root}/${f}`, 'utf8')) {
  const opt = (f) => { try { return read(f); } catch { return null; } };
  const cpu = kv(read('cpu.stat'));
  const peak = opt('memory.peak');
  return {
    cpuSec: cpu.usage_usec / 1e6,
    memPeakBytes: peak === null ? null : Number(peak),
    io: ioTotals(opt('io.stat') || ''),
  };
}
