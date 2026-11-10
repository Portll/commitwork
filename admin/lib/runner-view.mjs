// The Runner page's model: the stack API's envelopes, read through lib/stack-client.mjs, turned
// into display cells. A figure is measured text or UNMEASURED with its reason. A section whose
// envelope failed, or whose source answered null, is UNMEASURED as a whole.
import { readStack, stackApiUrl, UNMEASURED } from '../../lib/stack-client.mjs';

export const RUNNER_ROUTES = Object.freeze({
  health: '/v1/health',
  slots: '/v1/runner/slots',
  decisions: '/v1/runner/decisions?limit=50',
  jobs: '/v1/runner/jobs?limit=50',
  now: '/v1/resources/now',
});

/** Every route's envelope, read in parallel: { health, slots, decisions, jobs, now }. */
export async function readRunner({ read = readStack, ...opts } = {}) {
  const keys = Object.keys(RUNNER_ROUTES);
  const got = await Promise.all(keys.map((k) => read(RUNNER_ROUTES[k], opts)));
  return Object.fromEntries(keys.map((k, i) => [k, got[i]]));
}

const unknown = (why) => ({ text: UNMEASURED, unknown: true, why: why || 'not measured' });
const shown = (text) => ({ text, unknown: false, why: null });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fig = (v, fmt, why) => (v === 'max' || isNum(v) ? shown(fmt(v)) : unknown(why));

export function bytes(n) {
  if (n === 'max') return 'no limit';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v} B` : `${v.toFixed(1)} ${units[i]}`;
}
export const secs = (s) => (s > 0 && s < 0.01 ? '<0.01 s' : s < 120 ? `${s.toFixed(s < 10 ? 2 : 1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const pct = (p) => `${p.toFixed(1)}%`;
export const when = (iso) => (typeof iso === 'string' ? iso.replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1Z') : '—');

const SLOT_TONE = { running: 'live', idle: 'live', restarting: 'part' };
const OUTCOME_TONE = { admit: 'live', wait: 'part', refuse: 'plain' };
const SOURCE_TONE = { live: 'live', unavailable: 'part', unreadable: 'part' };

function failure(env) {
  if (env && env.ok === true) return null;
  const e = (env && env.error) || {};
  return { why: e.message || 'no answer from the stack API', remedy: e.remedy ?? null };
}

const quietSource = (env) => {
  const s = (env.sources || []).find((x) => x.status !== 'live');
  return s ? `${s.id} ${s.status}: ${s.reason ?? 'no reason given'}` : 'the stack API returned no data';
};

function section(env, pick, row) {
  const f = failure(env);
  if (f) return { state: 'unmeasured', ...f, verifiedAt: null, rows: null };
  const list = pick(env.data || {});
  if (!Array.isArray(list)) return { state: 'unmeasured', why: quietSource(env), remedy: null, verifiedAt: null, rows: null };
  return { state: 'measured', why: null, remedy: null, verifiedAt: when(env.stamp?.verifiedAt), rows: list.map(row) };
}

const slotRow = (s) => ({
  id: s.id, state: s.state, tone: SLOT_TONE[s.state] || 'unk', since: when(s.since),
  job: s.job ? { repo: s.job.repo, runner: s.job.name, runId: s.job.runId ?? null, jobId: s.job.jobId ?? null } : null,
});

const decisionRow = (d) => ({
  at: when(d.lastAt), firstAt: when(d.at), seen: d.seen, repo: d.repo, runId: d.runId, jobId: d.jobId,
  code: d.code, outcome: d.outcome, tone: OUTCOME_TONE[d.outcome] || 'unk', reason: d.reason,
});

function exitOf(j) {
  if (j.signal) return { text: `signal ${j.signal}`, tone: 'part' };
  if (isNum(j.exitCode)) return { text: `exit ${j.exitCode}`, tone: j.exitCode === 0 ? 'live' : 'part' };
  return { text: UNMEASURED, tone: 'unk' };
}

const ioOf = (io, why) => (isNum(io?.rbytes) && isNum(io?.wbytes) ? shown(`${bytes(io.rbytes)} read · ${bytes(io.wbytes)} written`) : unknown(why));

const jobRow = (j) => ({
  at: when(j.at), repo: j.repo, runId: j.runId, jobId: j.jobId, runner: j.runnerName, exit: exitOf(j),
  wall: fig(j.wallSec, secs, 'the slot reported no wall time'),
  cpuSec: fig(j.cpuSec, secs, 'the slot reported no cpu.stat total'),
  memPeak: fig(j.memPeakBytes, bytes, 'the slot could not read memory.peak'),
  io: ioOf(j.io, 'the slot reported no io.stat total'),
});

function vmLayer(env) {
  const f = failure(env);
  const sample = f ? null : env.data?.sample ?? null;
  const vm = sample?.vm?.state === 'measured' ? sample.vm : null;
  const why = f?.why ?? (sample ? sample.vm?.reason : quietSource(env));
  const used = vm && isNum(vm.memTotal) && isNum(vm.memAvailable) ? vm.memTotal - vm.memAvailable : null;
  const swap = vm && isNum(vm.swapTotal) && isNum(vm.swapFree) ? vm.swapTotal - vm.swapFree : null;
  const loads = vm ? [vm.load1, vm.load5, vm.load15] : [];
  return {
    label: 'DOCKER VM', state: vm ? 'measured' : 'unmeasured', why: vm ? null : why, remedy: f?.remedy ?? null,
    at: sample ? when(sample.at) : null,
    figures: [
      { k: 'CPU, all VM CPUs', v: fig(vm?.cpuPct, pct, vm?.cpuWhy || why) },
      { k: 'CPUs', v: fig(vm?.cpus, String, why) },
      { k: 'Memory used', v: fig(used, bytes, why) },
      { k: 'Memory total', v: fig(vm?.memTotal, bytes, why) },
      { k: 'Swap used', v: fig(swap, bytes, why) },
      { k: 'Load 1 · 5 · 15 min', v: loads.length && loads.every(isNum) ? shown(loads.map((n) => n.toFixed(2)).join(' · ')) : unknown(why) },
    ],
  };
}

function containerRow(service, c) {
  const run = c.state === 'running';
  const why = run ? null : c.reason;
  const at = (v) => (run ? v : null);
  return {
    service, id: c.id, state: run ? 'running' : 'unmeasured', tone: run ? 'live' : 'unk',
    cpuPct: fig(at(c.cpuPct), pct, run ? c.cpuWhy : why),
    cpuSec: fig(at(c.cpuSec), secs, why),
    mem: fig(at(c.memCurrent), bytes, why),
    memPeak: fig(at(c.memPeak), bytes, run ? 'memory.peak absent on this kernel' : why),
    memMax: fig(at(c.memMax), bytes, why),
    pids: fig(at(c.pids), String, why),
  };
}

function containersLayer(env) {
  const f = failure(env);
  const sample = f ? null : env.data?.sample ?? null;
  const base = { label: 'CONTAINERS', remedy: f?.remedy ?? null, at: sample ? when(sample.at) : null };
  if (!sample) return { ...base, state: 'unmeasured', why: f?.why ?? quietSource(env), rows: null };
  if (sample.ids?.status !== 'live') return { ...base, state: 'unmeasured', why: `container map ${sample.ids?.status}: ${sample.ids?.reason}`, rows: null };
  return { ...base, state: 'measured', why: null, rows: Object.entries(sample.containers || {}).map(([s, c]) => containerRow(s, c)) };
}

function apiOf(env, url) {
  const f = failure(env);
  return {
    url, state: f ? 'unmeasured' : 'measured', why: f?.why ?? null, remedy: f?.remedy ?? null,
    detail: f ? env?.error?.detail ?? null : null, verifiedAt: f ? null : when(env.stamp?.verifiedAt),
    sources: f ? null : (env.sources || []).map((s) => ({ id: s.id, status: s.status, reason: s.reason, tone: SOURCE_TONE[s.status] || 'unk' })),
  };
}

function kpisOf(slots, vm) {
  const rows = slots.rows;
  const count = (pred) => (rows ? shown(String(rows.filter(pred).length)) : unknown(slots.why));
  return [
    { k: 'Slots', v: count(() => true) },
    { k: 'Running jobs', v: count((s) => s.state === 'running') },
    { k: 'Docker VM CPU', v: vm.figures[0].v },
    { k: 'Docker VM memory used', v: vm.figures[2].v },
  ];
}

/** The page model from readRunner()'s envelopes. url is the API base it was read from. */
export function buildRunnerModel(env, { url = stackApiUrl() } = {}) {
  const slots = section(env.slots, (d) => d.slots, slotRow);
  const vm = vmLayer(env.now);
  return {
    api: apiOf(env.health, url),
    kpis: kpisOf(slots, vm),
    slots,
    decisions: section(env.decisions, (d) => d.decisions, decisionRow),
    layers: { vm, containers: containersLayer(env.now), jobs: { label: 'JOBS', ...section(env.jobs, (d) => d.jobs, jobRow) } },
  };
}
