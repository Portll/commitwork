// Host role: whether a sweep shares this machine with people and other work, or owns it.
//
// A role is a PRESET over controls that already exist — fleet slot count (via intensity), OS
// priority and admission — not a new tuning axis:
//
//   shared   intensity capped at 2 for the slot bound, nice 10, waits for a quiet machine before
//            it starts and between repos
//   server   tuning as configured, normal priority, the slot bound alone
//   auto     decided per sweep, not per install: one box is shared at 2pm and a server at 3am
//
// Unknown resolves to shared. A wrong `shared` costs throughput; a wrong `server` costs the
// operator's machine, and contended runs time out into PARTIAL lanes. auto only reaches server on
// positive evidence that nobody is using the box, with one exception: inside the UNATTENDED WINDOW
// (CW_UNATTENDED_HOURS, default 02-07, the hours the nightly ladder runs in) recent keyboard input
// no longer makes the box shared, because a shared host caps the fleet at one slot and the whole
// ladder cannot finish behind one slot. Battery and load still count inside the window; `off`
// disables it.
//
// Only scheduling changes. Lane intensity (rule sets, depth) is never touched here, so a role can
// make a sweep slower but never change what it finds.

import { cpus as osCpus, loadavg, setPriority, getPriority, platform } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const HOST_ROLES = ['auto', 'shared', 'server'];
export const SHARED_MAX_INTENSITY = 2;
export const SHARED_NICE = 10;

const positive = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
export const presenceIdleSec = (env = process.env) => positive(env.CW_HOST_PRESENCE_IDLE_S, 900);
export const busyCpuFraction = (env = process.env) => positive(env.CW_HOST_BUSY_CPU, 0.6);
export const quietWaitMs = (env = process.env) => positive(env.CW_HOST_QUIET_WAIT_MS, 30 * 60 * 1000);

export const DEFAULT_UNATTENDED_HOURS = '02-07';
/** "HH-HH" in local hours, end exclusive, wrapping past midnight; 'off' or malformed means no window. */
export function parseUnattendedHours(text) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const from = Number(m[1]), to = Number(m[2]);
  if (from > 23 || to > 24 || from === to) return null;
  return { from, to };
}
export const unattendedWindow = (env = process.env) => parseUnattendedHours(env.CW_UNATTENDED_HOURS ?? DEFAULT_UNATTENDED_HOURS);
export const inUnattendedWindow = (hour, w) => !!w && (w.from < w.to ? hour >= w.from && hour < w.to : hour >= w.from || hour < w.to);

const firstLine = (e) => String(e?.code || e?.message || e).split('\n')[0];

/** Seconds since the last keyboard or pointer input. darwin only; elsewhere unreadable. */
export function inputIdleSec({ run = execFileSync, os = platform() } = {}) {
  if (os !== 'darwin') return { value: null, why: `no input-idle reading on ${os}` };
  try {
    const out = run('ioreg', ['-c', 'IOHIDSystem', '-d', '4', '-r', '-k', 'HIDIdleTime'], { encoding: 'utf8', timeout: 5000 });
    const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(out);
    return m ? { value: Math.floor(Number(m[1]) / 1e9) } : { value: null, why: 'ioreg returned no HIDIdleTime' };
  } catch (e) { return { value: null, why: `ioreg failed (${firstLine(e)})` }; }
}

/** true on battery, false on AC, null when it cannot be read. */
export function onBattery({ run = execFileSync, os = platform() } = {}) {
  if (os !== 'darwin') return { value: null, why: `no power-source reading on ${os}` };
  try {
    const out = run('pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 5000 });
    if (/'Battery Power'/.test(out)) return { value: true };
    if (/'AC Power'/.test(out)) return { value: false };
    return { value: null, why: 'pmset named no power source' };
  } catch (e) { return { value: null, why: `pmset failed (${firstLine(e)})` }; }
}

/** 'normal' | 'warn' | 'critical', or null with a reason. */
export function memoryPressure({ run = execFileSync, read = readFileSync, os = platform() } = {}) {
  try {
    if (os === 'darwin') {
      const level = Number(run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8', timeout: 5000 }).trim());
      if (level === 1) return { value: 'normal' };
      if (level === 2) return { value: 'warn' };
      if (level === 4) return { value: 'critical' };
      return { value: null, why: `unrecognised pressure level ${level}` };
    }
    if (os === 'linux') {
      const m = /^some avg10=([\d.]+)/m.exec(read('/proc/pressure/memory', 'utf8'));
      if (!m) return { value: null, why: '/proc/pressure/memory has no avg10' };
      const avg = Number(m[1]);
      return { value: avg >= 40 ? 'critical' : avg >= 10 ? 'warn' : 'normal' };
    }
    return { value: null, why: `no memory-pressure reading on ${os}` };
  } catch (e) { return { value: null, why: `memory pressure unreadable (${firstLine(e)})` }; }
}

const cpuTotals = (list) => list.reduce((acc, c) => {
  const t = c.times;
  acc.idle += t.idle;
  acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
  return acc;
}, { idle: 0, total: 0 });

// Sampled CPU utilisation rather than loadavg: the 1-minute load still carries this sweep's own
// last repo for a minute after it exits, so a between-repo check on load would wait on itself.
export async function cpuBusyFraction({ ms = 1000, cpus = osCpus, sleep = (t) => new Promise((r) => setTimeout(r, t)) } = {}) {
  const a = cpus() || [];
  if (!a.length) return { value: null, why: 'os.cpus() returned no processors' };
  await sleep(ms);
  const b = cpus() || [];
  if (b.length !== a.length) return { value: null, why: 'processor count changed during the sample' };
  const x = cpuTotals(a), y = cpuTotals(b);
  const total = y.total - x.total;
  if (!(total > 0)) return { value: null, why: 'no CPU time elapsed during the sample' };
  return { value: Math.max(0, Math.min(1, 1 - (y.idle - x.idle) / total)) };
}

/**
 * Whether other work is using the machine. busy: true | false | null (undetermined).
 * Never throws; every unreadable signal is named in `unread`.
 */
export async function machineBusy({ env = process.env, probe = {} } = {}) {
  const cpu = await (probe.cpuBusyFraction || cpuBusyFraction)();
  const mem = (probe.memoryPressure || memoryPressure)();
  const limit = busyCpuFraction(env);
  const reasons = [];
  const unread = [];
  if (cpu.value === null) unread.push(cpu.why);
  else if (cpu.value >= limit) reasons.push(`CPU ${Math.round(cpu.value * 100)}% busy (limit ${Math.round(limit * 100)}%)`);
  if (mem.value === null) unread.push(mem.why);
  else if (mem.value !== 'normal') reasons.push(`memory pressure ${mem.value}`);
  const busy = reasons.length ? true : unread.length ? null : false;
  return {
    busy, reasons, unread,
    cpuBusy: cpu.value === null ? null : Math.round(cpu.value * 100) / 100,
    memoryPressure: mem.value,
    load1: Math.round((loadavg()[0] || 0) * 100) / 100,
  };
}

/**
 * The role this sweep runs under, with where it came from and why.
 * `setting` is a getSetting('hostRole') result; passed in so this module never reads the store.
 */
export async function resolveHostRole({ setting, env = process.env, probe = {} } = {}) {
  const declared = HOST_ROLES.includes(setting?.value) ? setting.value : 'auto';
  const source = setting?.source || 'default';
  if (declared !== 'auto') {
    return { role: declared, declared, source, reasons: [`declared ${declared} (${source})`], signals: null };
  }
  const idle = (probe.inputIdleSec || inputIdleSec)();
  const battery = (probe.onBattery || onBattery)();
  const load = await (probe.machineBusy || machineBusy)({ env });
  const threshold = presenceIdleSec(env);
  const window = unattendedWindow(env);
  const hour = (probe.localHour || (() => new Date().getHours()))();
  const unattended = inUnattendedWindow(hour, window);
  const reasons = [];
  const presence = idle.value === null ? `operator presence unreadable (${idle.why})`
    : idle.value < threshold ? `input ${idle.value}s ago (under ${threshold}s)` : null;
  if (presence && !unattended) reasons.push(presence);
  if (battery.value === true) reasons.push('on battery power');
  if (load.busy === true) reasons.push(...load.reasons);
  if (load.busy === null) reasons.push(`machine load undetermined (${load.unread.join('; ')})`);
  const role = reasons.length ? 'shared' : 'server';
  const windowNote = unattended ? `unattended window ${String(window.from).padStart(2, '0')}-${String(window.to).padStart(2, '0')} (CW_UNATTENDED_HOURS)` : null;
  return {
    role, declared, source,
    reasons: role === 'server'
      ? [presence && windowNote ? `${windowNote}: ${presence} disregarded; on AC or unknown power, machine quiet` : `no input for ${idle.value}s, on AC or unknown power, machine quiet`]
      : reasons,
    signals: { inputIdleSec: idle.value, onBattery: battery.value, localHour: hour, unattended, ...load },
  };
}

/**
 * Wait until the machine is not busy, for at most `maxWaitMs`.
 * outcome: 'quiet' (polls 1 = never waited) | 'undetermined' (signals unreadable — proceeds, never stalls forever on a
 * platform that cannot answer) | 'timed-out' (proceeds contended, and says so).
 */
export async function waitUntilQuiet({
  env = process.env, maxWaitMs = quietWaitMs(env), pollMs = 30_000,
  now = () => Date.now(), sleep = (t) => new Promise((r) => setTimeout(r, t)),
  busy = machineBusy, onWait = null,
} = {}) {
  const started = now();
  let announced = false;
  for (let polls = 1; ; polls++) {
    const b = await busy({ env });
    const waitedMs = now() - started;
    if (b.busy === false) return { outcome: 'quiet', waitedMs, polls, last: b };
    if (b.busy === null) return { outcome: 'undetermined', waitedMs, polls, last: b };
    if (waitedMs >= maxWaitMs) return { outcome: 'timed-out', waitedMs, polls, last: b };
    if (!announced && onWait) { onWait(b); announced = true; }
    await sleep(Math.min(pollMs, Math.max(0, maxWaitMs - waitedMs)));
  }
}

/** Lower this process's priority to SHARED_NICE; children spawned afterwards inherit it. */
export function applySharedPriority({ get = getPriority, set = setPriority } = {}) {
  try {
    const from = get();
    if (from >= SHARED_NICE) return { applied: false, from, to: from, why: 'already at or below shared priority' };
    set(SHARED_NICE);
    return { applied: true, from, to: SHARED_NICE };
  } catch (e) { return { applied: false, from: null, to: null, why: `setPriority failed (${firstLine(e)})` }; }
}

/** launchd keys for a scheduled job, by the role declared at install time. */
export function launchdPriorityKeys(declared) {
  if (declared === 'server') return '';
  const yieldKeys = '  <key>Nice</key><integer>10</integer>\n  <key>LowPriorityIO</key><true/>';
  // Background confines a job to efficiency cores even on an idle box, so only an explicit
  // `shared` gets it; auto keeps every core and yields under contention through nice + IO priority.
  if (declared === 'shared') return `  <key>ProcessType</key><string>Background</string>\n${yieldKeys}`;
  return yieldKeys;
}
