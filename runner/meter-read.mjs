// Pure readers for the meter: cgroup v2 files per container, /proc totals for the Docker VM, and
// the service → container-id map. Every reader takes `read(path) → string`, so tests use fixtures.
// Only ENOENT means absent; any other read or parse failure marks the reading unmeasured.
import { readFileSync } from 'node:fs';

export const ID_RE = /^[0-9a-f]{64}$/;
export const SERVICE_RE = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
export const defaultRead = (p) => readFileSync(p, 'utf8');

class ParseError extends Error {}
const parseFail = (what, text) => { throw new ParseError(`${what} unparseable: ${JSON.stringify(String(text).slice(0, 40))}`); };

const lines = (text) => String(text).trim().split('\n').filter(Boolean);
const kv = (text) => Object.fromEntries(lines(text).map((l) => l.trim().split(/\s+/)));

function num(text, what) {
  const n = Number(String(text).trim());
  return Number.isFinite(n) && String(text).trim() !== '' ? n : parseFail(what, text);
}

function optional(read, path) {
  try { return read(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

/** io.stat summed across devices, or null when the file is absent. */
export function parseIoStat(text) {
  if (text === null) return null;
  const sum = { rbytes: 0, wbytes: 0 };
  for (const line of lines(text)) {
    for (const f of line.trim().split(/\s+/).slice(1)) {
      const [k, v] = f.split('=');
      if (k in sum) sum[k] += num(v, `io.stat ${k}`);
    }
  }
  return sum;
}

/** memory.max: bytes, 'max' when unlimited, null when absent. */
export function parseMax(text, what = 'memory.max') {
  if (text === null) return null;
  return String(text).trim() === 'max' ? 'max' : num(text, what);
}

/** cpu.max "quota period" → CPUs, 'max' when unlimited, null when absent. */
export function parseCpuMax(text) {
  if (text === null) return null;
  const [quota, period] = String(text).trim().split(/\s+/);
  if (quota === 'max') return 'max';
  return num(quota, 'cpu.max quota') / num(period, 'cpu.max period');
}

/** /proc/stat's aggregate cpu line: busy and total jiffies, and the CPU count. */
export function parseProcStat(text) {
  const line = lines(text).find((l) => /^cpu\s/.test(l)) ?? parseFail('/proc/stat cpu line', text);
  // guest and guest_nice are already counted inside user and nice.
  const f = line.trim().split(/\s+/).slice(1, 9).map((v) => num(v, '/proc/stat cpu'));
  if (f.length < 5) parseFail('/proc/stat cpu', line);
  const total = f.reduce((a, b) => a + b, 0);
  return { busy: total - f[3] - f[4], total, cpus: lines(text).filter((l) => /^cpu\d+\s/.test(l)).length };
}

/** /proc/meminfo in bytes. */
export function parseMeminfo(text) {
  const kb = {};
  for (const l of lines(text)) {
    const m = /^(\w+):\s+(\d+)(?:\s+kB)?$/.exec(l.trim());
    if (m) kb[m[1]] = Number(m[2]) * 1024;
  }
  const need = (k) => kb[k] ?? parseFail(`/proc/meminfo ${k}`, text);
  return { memTotal: need('MemTotal'), memAvailable: need('MemAvailable'), swapTotal: need('SwapTotal'), swapFree: need('SwapFree') };
}

/** /proc/loadavg's three averages. */
export function parseLoadavg(text) {
  const [a, b, c] = String(text).trim().split(/\s+/);
  return { load1: num(a, 'loadavg'), load5: num(b, 'loadavg'), load15: num(c, 'loadavg') };
}

/** The cgroup directory Docker Desktop's cgroupfs driver gives a container. */
export const cgroupDir = (root, id) => `${root}/docker/${id}`;

function containerFiles(dir, read) {
  const cpu = kv(read(`${dir}/cpu.stat`));
  const memCurrent = num(read(`${dir}/memory.current`), 'memory.current');
  const opt = (f) => optional(read, `${dir}/${f}`);
  const pids = opt('pids.current');
  const peak = opt('memory.peak');
  return {
    state: 'running',
    usageUsec: num(cpu.usage_usec ?? '', 'cpu.stat usage_usec'),
    memCurrent,
    memPeak: peak === null ? null : num(peak, 'memory.peak'),
    memMax: parseMax(opt('memory.max')),
    cpuQuota: parseCpuMax(opt('cpu.max')),
    pids: pids === null ? null : num(pids, 'pids.current'),
    io: parseIoStat(opt('io.stat')),
  };
}

/** One container's raw counters. A missing cgroup is a stopped container: unmeasured, not zero. */
export function readContainer(root, id, read = defaultRead) {
  if (!ID_RE.test(String(id))) return { state: 'unmeasured', reason: 'container id is not 64 hex characters' };
  try {
    return containerFiles(cgroupDir(root, id), read);
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'unmeasured', reason: 'no cgroup: the container is stopped or not started' };
    return { state: 'unmeasured', reason: e instanceof ParseError ? e.message : `cgroup unreadable: ${e.code || e.message}` };
  }
}

/** The Docker VM's raw totals as this process sees /proc. */
export function readVm(proc, read = defaultRead) {
  try {
    return { state: 'measured', ...parseProcStat(read(`${proc}/stat`)), ...parseMeminfo(read(`${proc}/meminfo`)), ...parseLoadavg(read(`${proc}/loadavg`)) };
  } catch (e) {
    return { state: 'unmeasured', reason: e instanceof ParseError ? e.message : `${proc} unreadable: ${e.code || e.message}` };
  }
}

/** Validate a parsed service → id map. Bad ids are kept: readContainer marks each unmeasured. */
export function checkIds(raw, where = 'the id map') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'unreadable', reason: `${where} is not a service → id object`, ids: {}, rejected: [] };
  }
  const ids = {};
  const rejected = [];
  for (const [service, id] of Object.entries(raw)) {
    if (SERVICE_RE.test(service)) ids[service] = String(id);
    else rejected.push(service.slice(0, 64));
  }
  return { status: 'live', reason: null, ids, rejected };
}

/** The id map `bin/stack up` writes. Absent means the stack is not up. */
export function readStackIds(path, read = defaultRead) {
  const none = (status, reason) => ({ status, reason, ids: {}, rejected: [] });
  if (!path) return none('unavailable', 'CW_STACK_IDS is not set');
  let raw;
  try { raw = JSON.parse(read(path)); } catch (e) {
    if (e.code === 'ENOENT') return none('unavailable', `${path} absent: the stack is not up`);
    return none('unreadable', `${path}: ${e.code || e.message}`);
  }
  return checkIds(raw, path);
}
