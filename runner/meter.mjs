// The meter: a stateful sampler over meter-read.mjs, and a ring of recent samples for series.
// It runs inside the dispatcher, which mounts /sys/fs/cgroup read-only with the host cgroupns.
// CPU figures are deltas between readings, so the first reading of a container lifetime has none.
//   container cpuPct: 100 is one CPU, as docker stats counts it
//   vm cpuPct: 100 is every CPU of the Docker VM, not the Mac; vm.cpus is the count
//   env, read at call time: CW_STACK_IDS (the service → container-id map bin/stack up writes)
import { performance } from 'node:perf_hooks';
import { checkIds, defaultRead, readContainer, readStackIds, readVm } from './meter-read.mjs';

export const METER_DEFAULTS = Object.freeze({ root: '/sys/fs/cgroup', proc: '/proc', keep: 900, intervalMs: 2000 });

const round1 = (n) => Math.round(n * 10) / 10;

/** A fixed-size ring: the oldest entry falls off. */
export function createRing(size) {
  const buf = [];
  return {
    push(x) { buf.push(x); if (buf.length > size) buf.shift(); },
    items: () => buf.slice(),
    last: () => buf.at(-1) ?? null,
  };
}

function vmFigures(raw, prev) {
  if (raw.state !== 'measured') return { layer: 'vm', state: 'unmeasured', reason: raw.reason };
  const { busy, total, state, ...rest } = raw;
  const dTotal = prev ? total - prev.total : 0;
  const ok = prev && dTotal > 0 && busy >= prev.busy;
  const cpu = ok ? { cpuPct: round1(((busy - prev.busy) / dTotal) * 100) } : { cpuPct: null, cpuWhy: 'first reading' };
  return { layer: 'vm', state: 'measured', ...cpu, ...rest };
}

function cpuOf(id, usageUsec, prev, mono) {
  if (!prev || prev.id !== id) return { cpuPct: null, cpuWhy: 'first reading' };
  // A restart keeps the id and recreates the cgroup, so its counters start again from zero.
  if (usageUsec < prev.usageUsec) return { cpuPct: null, cpuWhy: 'restarted: counters reset' };
  const wallUsec = (mono - prev.mono) * 1000;
  return wallUsec > 0 ? { cpuPct: round1(((usageUsec - prev.usageUsec) / wallUsec) * 100) } : { cpuPct: null, cpuWhy: 'no time elapsed' };
}

function containerFigures(id, raw, prev, mono) {
  const base = { layer: 'container', id: String(id).slice(0, 12) };
  if (raw.state !== 'running') return { ...base, state: 'unmeasured', reason: raw.reason };
  const { usageUsec, state, ...rest } = raw;
  return { ...base, state: 'running', ...cpuOf(id, usageUsec, prev, mono), cpuSec: usageUsec / 1e6, ...rest };
}

function idMap(o) {
  if (o.ids !== undefined) return checkIds(o.ids, 'ids');
  return readStackIds(o.idsPath ?? process.env.CW_STACK_IDS, o.read);
}

/**
 * A sampler with memory of its previous reading. Options, each overridable per sample():
 * root, proc, read(path) → string, ids (object) or idsPath, keep (ring size), intervalMs,
 * mono() → ms for deltas, wall() → epoch ms for stamps.
 */
export function createMeter(opts = {}) {
  const base = { ...METER_DEFAULTS, read: defaultRead, mono: () => performance.now(), wall: () => Date.now(), ...opts };
  const ring = createRing(base.keep);
  const prev = { vm: null, containers: new Map() };
  let timer = null;
  let lastError = null;

  function sample(over = {}) {
    const o = { ...base, ...over };
    const mono = o.mono();
    const atMs = o.wall();
    const vmRaw = readVm(o.proc, o.read);
    const vm = vmFigures(vmRaw, prev.vm);
    prev.vm = vmRaw.state === 'measured' ? vmRaw : null;
    const map = idMap(o);
    const containers = {};
    const next = new Map();
    for (const [service, id] of Object.entries(map.ids)) {
      const raw = readContainer(o.root, id, o.read);
      containers[service] = containerFigures(id, raw, prev.containers.get(service), mono);
      if (raw.state === 'running') next.set(service, { id, usageUsec: raw.usageUsec, mono });
    }
    prev.containers = next;
    const s = { at: new Date(atMs).toISOString(), ids: { status: map.status, reason: map.reason, rejected: map.rejected }, vm, containers };
    ring.push({ atMs, sample: s });
    return s;
  }

  /** Samples within `windowSec` of the newest, oldest first. */
  function series(windowSec) {
    const last = ring.last();
    if (!last) return [];
    const from = last.atMs - windowSec * 1000;
    return ring.items().filter((e) => e.atMs >= from).map((e) => e.sample);
  }

  /** live while the newest sample is under three intervals old. */
  function status() {
    const last = ring.last();
    if (lastError) return { status: 'unreadable', reason: `sampling threw: ${lastError.message}` };
    if (!last) return { status: 'unavailable', reason: 'no sample taken yet' };
    const ageSec = (base.wall() - last.atMs) / 1000;
    if (timer && ageSec > (3 * base.intervalMs) / 1000) return { status: 'unavailable', reason: `stale: newest sample is ${Math.round(ageSec)} s old` };
    return { status: 'live', reason: null };
  }

  function tick() {
    try { sample(); lastError = null; } catch (e) { lastError = e; }
  }

  return {
    sample,
    series,
    status,
    latest: () => ring.last()?.sample ?? null,
    start(intervalMs = base.intervalMs) {
      if (timer) return;
      base.intervalMs = intervalMs;
      tick();
      timer = setInterval(tick, intervalMs);
      timer.unref();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
