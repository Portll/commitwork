// Scanner performance tuning: resolve a hardware profile plus depth and intensity into concrete
// per-scanner settings.
//
// The shape is deliberate. A profile declares what a MACHINE can do; a scanner declares what it
// COSTS; the tuning is derived. The alternative — a profile-by-scanner matrix — is 11 x 43 cells
// that nobody could keep true, and a stale cell in it would be indistinguishable from a deliberate
// setting, which is the false-provenance class this repository already names (P10).
//
// Nothing here kills, throttles or applies anything. It computes a recommendation and the panel
// writes it to the settings store; consumers read the store. Declaration is split from authority.

import { readFileSync } from 'node:fs';
import { cpus, totalmem, freemem, loadavg, uptime, arch as osArch, platform as osPlatform } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Env read at CALL time, never at module load: a module-load read defeats every test that sets the
// override afterwards, so the test passes while proving nothing.
export const profilesPath = () => process.env.CW_PERF_PROFILES || resolve(HERE, 'perf-profiles.json');

let cached = null;
let cachedFrom = null;

/** Fail closed: ENOENT is the only absence, and even that is fatal here — without the profile
 *  document there is no vocabulary to derive anything from, and inventing one would be worse than
 *  refusing. */
export function loadProfiles({ path = profilesPath() } = {}) {
  if (cached && cachedFrom === path) return cached;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`perf profiles unreadable at ${path}: ${e.code || e.message} — refusing to `
      + 'derive tuning from an assumed default, which would report a machine we never read');
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) {
    throw new Error(`perf profiles at ${path} are not valid JSON: ${e.message}`);
  }
  for (const k of ['profiles', 'scanners', 'costClasses', 'depthLevels', 'intensityLevels', 'diskClasses']) {
    if (!doc[k]) throw new Error(`perf profiles at ${path} declare no ${k}`);
  }
  cached = doc; cachedFrom = path;
  return doc;
}

export function resetProfileCache() { cached = null; cachedFrom = null; }

// The descriptor trap MUST answer for the key it was asked about. Returning a descriptor
// unconditionally made hasOwnProperty(PROFILES, anything) true, so every membership check accepted
// every string and an unknown profile id would have resolved to undefined and been tuned from it.
// Found by the panel's route tests, 2026-08-23.
export const PROFILES = new Proxy({}, {
  get: (_t, k) => loadProfiles().profiles[k],
  ownKeys: () => Object.keys(loadProfiles().profiles),
  getOwnPropertyDescriptor: (_t, k) => (Object.prototype.hasOwnProperty.call(loadProfiles().profiles, k)
    ? { enumerable: true, configurable: true, value: loadProfiles().profiles[k], writable: false }
    : undefined),
  has: (_t, k) => Object.prototype.hasOwnProperty.call(loadProfiles().profiles, k),
});

/** Whether a profile id is real. Use this rather than a bare property check. */
export const isProfileId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(loadProfiles().profiles, id);

export const DEPTH_LEVELS = () => loadProfiles().depthLevels;
export const INTENSITY_LEVELS = () => loadProfiles().intensityLevels;

// ── hardware detection ─────────────────────────────────────────────────────────────────────────
// Everything here is READ, never assumed. Disk class cannot be determined portably from Node, so
// it is reported as `unknown` rather than guessed at `nvme` — guessing the fast case is exactly the
// direction that produces a flattering number, and the panel asks the operator instead.

export function detectHardware({ env = process.env } = {}) {
  const list = cpus() || [];
  const cores = Number(env.CW_PERF_CORES) || list.length || 1;
  const ramGB = Number(env.CW_PERF_RAM_GB) || Math.round(totalmem() / (1024 ** 3));
  const arch = env.CW_PERF_ARCH || osArch();
  const platform = env.CW_PERF_PLATFORM || osPlatform();
  const model = list[0]?.model || 'unknown';
  const diskClass = env.CW_PERF_DISK || 'unknown';
  const containers = env.CW_PERF_CONTAINERS === undefined ? null : env.CW_PERF_CONTAINERS !== '0';
  return { cores, ramGB, arch, platform, model, diskClass, containers, detectedAt: env.CW_NOW || null };
}

// Live display readings. Separate from detectHardware(), which is deterministic. The core counts and
// GPU come from sysctl and ioreg, spawned synchronously on the panel's request path, and cannot change
// while the process runs: they are read once. Only the in-process readings are taken per call.
let _fixedFacts = null;
function fixedFacts() {
  if (_fixedFacts) return _fixedFacts;
  const list = cpus() || [];
  _fixedFacts = {
    platform: osPlatform(), arch: osArch(),
    model: list[0]?.model || null,
    logicalCores: list.length || null,
    perfCores: sysctlNum('hw.perflevel0.logicalcpu'),
    effCores: sysctlNum('hw.perflevel1.logicalcpu'),
    gpuCores: gpuCores(),
  };
  return _fixedFacts;
}

export function systemSnapshot() {
  return {
    ...fixedFacts(),
    ramBytes: totalmem() || null,
    freeBytes: freemem() || null,
    load1: (loadavg() || [])[0] ?? null,
    uptimeSec: Math.round(uptime() || 0),
  };
}

function sysctlNum(key) {
  if (osPlatform() !== 'darwin') return null;
  try {
    const r = spawnSync('sysctl', ['-n', key], { encoding: 'utf8', timeout: 2000 });
    if (r.status !== 0) return null;
    const n = Number(String(r.stdout).trim());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function gpuCores() {
  if (osPlatform() !== 'darwin') return null;
  try {
    const r = spawnSync('ioreg', ['-r', '-c', 'AGXAccelerator', '-d', '1'], { encoding: 'utf8', timeout: 3000 });
    if (r.status !== 0) return null;
    const m = /"gpu-core-count"\s*=\s*(\d+)/.exec(r.stdout || '');
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/** Nearest declared profile by core count and memory. Reports its own confidence: an exact match,
 *  a nearest neighbour, or unknown. A nearest-neighbour match is NOT presented as an exact one. */
export function matchProfile(hw, { doc = loadProfiles() } = {}) {
  const named = Object.values(doc.profiles).filter((p) => p.id !== 'auto');

  // Ask the processor first. The CPU model string is the one piece of identity the machine will
  // tell us plainly, so a name match beats an arithmetic one — and when the named part turns out to
  // have more cores or memory than the profile declares, the MEASURED figure wins. A declared
  // profile is a starting point; the machine in front of us is evidence.
  const model = String(hw.model || '').toLowerCase();
  if (model && model !== 'unknown') {
    for (const p of named) {
      const pats = p.modelMatch || [];
      if (pats.some((pat) => model.includes(String(pat).toLowerCase()))) {
        const drift = [];
        if (hw.cores && p.cores && hw.cores !== p.cores) drift.push(`${hw.cores} cores against the profile's ${p.cores}`);
        if (hw.ramGB && p.ramGB && hw.ramGB !== p.ramGB) drift.push(`${hw.ramGB} GB against the profile's ${p.ramGB} GB`);
        return {
          id: p.id,
          confidence: 'exact',
          matchedOn: 'cpu model',
          why: drift.length
            ? `the processor reports "${hw.model}", which is ${p.label}. This machine has ${drift.join(' and ')}, so the measured figures are used and the profile supplies only disk class and container availability.`
            : `the processor reports "${hw.model}", which is ${p.label}`,
          useMeasured: drift.length > 0,
        };
      }
    }
  }

  let best = null; let bestD = Infinity;
  for (const p of named) {
    if (p.arch && hw.arch && !archCompatible(p.arch, hw.arch)) continue;
    const dCores = Math.abs((p.cores || 0) - hw.cores) / Math.max(p.cores || 1, hw.cores, 1);
    const dRam = Math.abs((p.ramGB || 0) - hw.ramGB) / Math.max(p.ramGB || 1, hw.ramGB, 1);
    const d = dCores + dRam;
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) {
    return { id: 'legacy-hdd', confidence: 'unknown', why: `no declared profile matches arch ${hw.arch}; falling back to the floor profile so nothing is over-provisioned` };
  }
  if (bestD < 0.06) {
    return { id: best.id, confidence: 'exact', why: `${hw.cores} cores and ${hw.ramGB} GB match ${best.label}` };
  }
  return {
    id: best.id,
    confidence: 'nearest',
    why: `${hw.cores} cores and ${hw.ramGB} GB is closest to ${best.label} (${best.cores} cores, ${best.ramGB} GB). This is a nearest match, not a measured one — override it if the machine differs.`,
  };
}

const archCompatible = (a, b) => (a === b) || (a === 'arm64' && b === 'arm64') || (a === 'x64' && (b === 'x64' || b === 'x86_64'));

// ── derivation ─────────────────────────────────────────────────────────────────────────────────

// Cores held per concurrently scanning repository, by intensity. Measured basis in the profile
// document: Semgrep alone takes about 2 cores per repository at full rule sets, so anything below
// ~2.5 at intensity 5 oversubscribes and, as measured 2026-08-22, ends up slower end to end.
const CORES_PER_JOB = { 1: 8, 2: 3, 3: 2, 4: 1.6, 5: 1.25 };
const RESERVE = { 1: 0.75, 2: 0.55, 3: 0.4, 4: 0.2, 5: 0.05 };

// ── operator overrides ─────────────────────────────────────────────────────────────────────────
// An override forces a lane on or off AFTER the derivation has spoken, and the derivation's answer
// is kept beside it (`derivedEnabled`) so the panel can say what it overrode.
//
// FORCING ON DOES NOT MAKE A LANE RUNNABLE. A container lane with no container runtime, a runtime
// lane with no live target and a lane whose token is not configured cannot run no matter what an
// operator asks for. Those are reported FORCED ON BUT BLOCKED — enabled:false, blocked:true, the
// blocking reason unchanged — and are counted separately from the lanes that will actually run. A
// forced-on lane rendered as running while it silently does not is the exact false-clean this
// module exists to refuse; over-reporting a scan is no safer than under-reporting one.
//
// Depth, cost class and the RAM budget are POLICY, not capability: an operator may overrule them,
// and forcing such a lane on genuinely runs it.
function capabilityBlock(s, containers, depth) {
  if (s.container && containers === false) return 'needs a container runtime, which this profile does not have';
  if (s.runtime && depth < 5) return 'needs a live target; runs at depth 5 only';
  if (s.needsToken) return `needs ${s.needsToken}, which is not configured`;
  return null;
}

/** Normalise whatever arrived as `overrides` into a plain {id: 'on'|'off'} map, naming what it
 *  discarded. A malformed override is DROPPED and SAID, never applied on a guess. */
export function normalizeOverrides(overrides, { scanners = null } = {}) {
  const map = Object.create(null);
  const warnings = [];
  if (overrides === null || overrides === undefined) return { map, warnings };
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    warnings.push(`the scanner overrides are ${Array.isArray(overrides) ? 'an array' : `a ${typeof overrides}`}, not an object of {id: "on"|"off"} — NO override was applied, and the table below is the derivation alone`);
    return { map, warnings };
  }
  for (const [id, state] of Object.entries(overrides)) {
    if (state !== 'on' && state !== 'off') {
      warnings.push(`the override for ${id} is ${JSON.stringify(state)}, which is neither "on" nor "off" — it is being IGNORED, not applied`);
      continue;
    }
    if (scanners && !Object.prototype.hasOwnProperty.call(scanners, id)) {
      warnings.push(`the override for ${id} names a scanner this tuning model does not declare — it is being IGNORED, and no lane was forced ${state}`);
      continue;
    }
    map[id] = state;
  }
  return { map, warnings };
}

export function resolveTuning({ profileId = 'auto', depth = 3, intensity = 3, hardware = null, overrides = null, doc = loadProfiles() } = {}) {
  const errs = [];
  depth = clampLevel(depth, doc.depthLevels, 'depth', errs);
  intensity = clampLevel(intensity, doc.intensityLevels, 'intensity', errs);

  const hw = hardware || detectHardware();
  let profile = Object.prototype.hasOwnProperty.call(doc.profiles, profileId) ? doc.profiles[profileId] : null;
  let matched = null;
  if (!profile || profile.id === 'auto') {
    matched = matchProfile(hw, { doc });
    profile = doc.profiles[matched.id];
  }

  const warnings = [...errs];
  const disk = doc.diskClasses[profile.diskClass] || doc.diskClasses[hw.diskClass] || null;
  if (!disk) {
    warnings.push(`disk class is unknown for ${profile.label}; parallelism is derived as if this were a SATA SSD, which is the conservative middle. Set it in the panel for an accurate figure.`);
  }
  const diskMult = disk ? disk.jobsMultiplier : 0.75;

  // Measured beats declared. When the CPU model identified the profile but the machine turns out to
  // carry more (or less) than the profile declares, the real figure is used — a profile is a
  // starting point, and deriving a job count from a number we did not read would be the same defect
  // as reporting a scan we did not run.
  const useMeasured = !!(matched && matched.useMeasured) || profileId === 'auto';
  const cores = (useMeasured && hw.cores) || profile.cores || hw.cores;
  const ramGB = (useMeasured && hw.ramGB) || profile.ramGB || hw.ramGB;
  const containers = profile.containers === null || profile.containers === undefined ? hw.containers : profile.containers;

  // Cores available after the reserve the intensity level holds back.
  const usable = Math.max(1, cores * (1 - RESERVE[intensity]) + cores * RESERVE[intensity] * (intensity / 5));
  let jobs = Math.floor((cores - cores * RESERVE[intensity]) / CORES_PER_JOB[intensity] * diskMult);
  jobs = Math.max(1, jobs);

  // Memory can bind before cores do. A heavy lane holds about 3 GB; leave 4 GB for the system and
  // any container VM.
  const ramBudgetGB = Math.max(1, ramGB - 4);
  const jobsByRam = Math.max(1, Math.floor(ramBudgetGB / 3));
  let ramBound = false;
  if (jobsByRam < jobs) { jobs = jobsByRam; ramBound = true; }

  if (ramBound) warnings.push(`memory, not cores, is the limit on this profile: ${ramGB} GB allows ${jobs} concurrent repositories where the cores would allow more.`);
  if (intensity === 5) warnings.push('Intensity 5 saturates the machine. On this fleet, measured 2026-08-22, per-repository throughput fell from 2.6 to 30 minutes under exactly this condition — level 4 is usually faster end to end.');
  if (profile.projected) {
    warnings.push(useMeasured
      ? `${profile.label} is declared as a projected profile, but this machine reports ${cores} cores and ${ramGB} GB and those measured figures were used instead. The projection now only supplies disk class and container availability. Correct the profile document from this reading.`
      : `${profile.label} is a PROJECTED profile: its core count and memory are extrapolated, not measured on hardware.`);
  }
  if (containers === false) warnings.push('No container runtime on this profile, so every containerised lane is unavailable rather than merely slow. The panel marks them unavailable; they must never be read as passing.');

  const slots = Math.max(1, Math.min(4, Math.ceil(jobs / 2)));

  const ov = normalizeOverrides(overrides, { scanners: doc.scanners });
  warnings.push(...ov.warnings);

  const scanners = Object.entries(doc.scanners).map(([id, s]) => {
    const cost = doc.costClasses[s.cost];
    let enabled = true; let reason = '';
    if (s.standby) { enabled = false; reason = 'standby — kept runnable, not run by default'; }
    // A scanner may declare its own minDepth, overriding the cost class. Cost is about what a run
    // COSTS; depth is about what a run is FOR, and the two come apart: a secret scan is expensive
    // (full history) and belongs at triage depth, while a type check is cheap and does not.
    else if (minDepthFor(s, cost) > depth) { const md = minDepthFor(s, cost); enabled = false; reason = `needs depth ${md} (${doc.depthLevels[md - 1].label}); current depth is ${depth}`; }
    else if (s.container && containers === false) { enabled = false; reason = 'needs a container runtime, which this profile does not have'; }
    else if (s.runtime && depth < 5) { enabled = false; reason = 'needs a live target; runs at depth 5 only'; }
    else if (s.needsToken) { enabled = false; reason = `needs ${s.needsToken}, which is not configured`; }
    else if (cost.ramGB > ramBudgetGB) { enabled = false; reason = `needs ${cost.ramGB} GB and only ${ramBudgetGB} GB is budgeted`; }
    const timeoutMs = Math.round(cost.timeoutMs * (intensity <= 2 ? 1.5 : 1));

    // The derivation has finished speaking. Everything below is the operator overruling it, and
    // what the derivation said is kept rather than overwritten.
    const derivedEnabled = enabled;
    const derivedReason = enabled ? '' : reason;
    const override = ov.map[id] || 'auto';
    let blocked = false;
    if (override === 'off') {
      enabled = false;
      reason = 'forced OFF by an operator override — this lane is NOT SCANNED. Its silence is an absence of evidence, never a clean result.';
    } else if (override === 'on') {
      const block = capabilityBlock(s, containers, depth);
      if (block) {
        enabled = false;                                      // forced on, still cannot run
        blocked = true;
        reason = block;                                       // the blocking reason, unchanged
      } else {
        enabled = true;
        reason = '';
      }
    }

    const dp = depthPlan(s, doc, depth, override);
    const ip = intensityPlan(s, intensity);
    return {
      id,
      label: id,
      costClass: s.cost,
      enabled,
      reason: enabled ? '' : reason,
      override,
      derivedEnabled,
      derivedReason,
      ...(blocked ? { blocked: true } : {}),
      minDepth: dp.from,
      depthKind: dp.kind,
      depthLevel: dp.level,
      depthLadder: dp.ladder,
      intensityKind: ip.kind,
      intensityLevel: ip.level,
      intensityLadder: ip.ladder,
      timeoutMs,
      concurrencyWeight: cost.coresPerRun,
      container: !!s.container,
      runtime: !!s.runtime,
      note: s.note || '',
    };
  }).sort((a, b) => (b.concurrencyWeight - a.concurrencyWeight) || a.id.localeCompare(b.id));

  // Name EVERY override in force. An override the operator set last month and forgot is a silent
  // change to what gets scanned, and a fleet report that does not restate it is reporting a
  // coverage decision it never mentions.
  for (const s of scanners) {
    if (s.override === 'auto') continue;
    if (s.override === 'off') {
      warnings.push(`${s.id} is FORCED OFF by an operator override${s.derivedEnabled ? ', though the derivation would have run it' : ' (the derivation had already disabled it)'} — its results are NOT SCANNED, and must never be read as clean.`);
    } else if (s.blocked) {
      warnings.push(`${s.id} is FORCED ON but CANNOT RUN: ${s.reason}. It is counted as forced-but-blocked, never as enabled — a forced lane that silently does not run is exactly the false-clean this panel exists to catch.`);
    } else {
      warnings.push(`${s.id} is FORCED ON by an operator override${s.derivedEnabled ? ' (the derivation would have run it anyway)' : `, overruling the derivation's "${s.derivedReason}"`}.`);
    }
  }

  return {
    profileId: profile.id,
    profile,
    matched,
    hardware: hw,
    depth,
    intensity,
    depthLevel: doc.depthLevels[depth - 1],
    intensityLevel: doc.intensityLevels[intensity - 1],
    jobs,
    slots,
    ramBudgetGB,
    usableCores: Math.round(usable * 10) / 10,
    scanners,
    overrides: { ...ov.map },
    // A forced-but-blocked lane is in NEITHER bucket: it is not running, and it is not a decision
    // to skip it. Counting it as enabled would publish a scan that never happens.
    enabledCount: scanners.filter((s) => s.enabled).length,
    forcedBlockedCount: scanners.filter((s) => s.blocked).length,
    forcedOnCount: scanners.filter((s) => s.override === 'on').length,
    forcedOffCount: scanners.filter((s) => s.override === 'off').length,
    overriddenCount: scanners.filter((s) => s.override !== 'auto').length,
    totalCount: scanners.length,
    warnings,
  };
}

const minDepthFor = (s, cost) => (Number.isInteger(s.minDepth) ? s.minDepth : cost.minDepth);

// ── a scanner's own levels ─────────────────────────────────────────────────────────────────────
// The fleet speaks in 1-5. A scanner may have fewer levels of its own (three rule packs, two history
// bounds) or none, and the 1-5 value is mapped PROPORTIONALLY onto the range in which the scanner
// runs at all: a three-level scanner that runs from depth 1 is at its middle level at depth 3, and
// one that starts at depth 3 runs its lightest level there. With no levels of its own, a scanner is
// `binary` when depth can switch it off and `n/a` when it runs at every depth.
//
// The top of every ladder is the invocation the lane ran before ladders existed, so depth 5 (the
// default) changes nothing.

/** Rank 1..length of a 1-5 value over [from, to]. */
export function ladderRank(value, { from = 1, to = 5, length }) {
  if (!Number.isInteger(length) || length < 1) return null;
  if (length === 1) return 1;
  if (to <= from) return length;
  const f = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return 1 + Math.round(f * (length - 1));
}

const ladderOf = (l) => (Array.isArray(l) && l.length >= 2 ? l : null);
const levelLabel = (entry) => (entry && typeof entry === 'object' ? String(entry.label) : String(entry));

/** Where depth puts one scanner: kind, whether it runs, and at which of its own levels. */
export function depthPlan(s, doc, depth, override = 'auto') {
  const cost = doc.costClasses[s.cost] || { minDepth: 1 };
  const minDepth = minDepthFor(s, cost);
  const from = s.runtime ? 5 : minDepth;
  const ladder = ladderOf(s.depthLadder);
  const kind = ladder ? 'graded' : from > 1 ? 'binary' : 'n/a';
  const gated = from > depth;
  const on = override === 'on' || (override !== 'off' && !gated);
  let level = null;
  if (ladder) {
    const rank = on ? ladderRank(depth, { from, length: ladder.length }) : 0;
    level = { rank, of: ladder.length, label: rank ? levelLabel(ladder[rank - 1]) : 'off' };
  } else if (kind === 'binary') {
    level = { rank: on ? 1 : 0, of: 1, label: on ? 'on' : 'off' };
  }
  return { kind, minDepth, from, gated, on, level, ladder: ladder ? ladder.map(levelLabel) : null };
}

/** Intensity has no off: a scanner either has levels of its own or it does not (`n/a`). The timeout
 *  multiplier applies to every lane either way. */
export function intensityPlan(s, intensity) {
  const ladder = ladderOf(s.intensityLadder);
  const timeoutFactor = intensity <= 2 ? 1.5 : 1;
  if (!ladder) return { kind: 'n/a', level: null, ladder: null, timeoutFactor };
  const rank = ladderRank(intensity, { length: ladder.length });
  return { kind: 'graded', level: { rank, of: ladder.length, label: levelLabel(ladder[rank - 1]) }, ladder: ladder.map(levelLabel), timeoutFactor };
}

/**
 * What the RUNNER does with one lane at a repository's depth and intensity. Hardware-free on
 * purpose: capability (containers, tokens, RAM) is already decided by the lane's own requirements,
 * and a runner that re-derived it from a profile would refuse lanes the machine can run.
 * A lane the model does not declare runs exactly as before and says so (`known: false`).
 */
export function lanePlan(id, { depth, intensity, override = 'auto', doc = loadProfiles() }) {
  const s = Object.prototype.hasOwnProperty.call(doc.scanners, id) ? doc.scanners[id] : null;
  if (!s) return { known: false, run: true, env: {}, depth: null, intensity: null };
  const d = depthPlan(s, doc, depth, override);
  const i = intensityPlan(s, intensity);
  const env = {};
  if (d.level && d.ladder && d.on) Object.assign(env, { CW_DEPTH_LEVEL: d.level.label, CW_DEPTH_RANK: String(d.level.rank) });
  if (i.level) Object.assign(env, { CW_INTENSITY_LEVEL: i.level.label, CW_INTENSITY_RANK: String(i.level.rank) });
  let reason = null;
  let basis = null;
  if (!d.on) {
    basis = override === 'off' ? 'override' : 'depth';
    reason = override === 'off'
      ? 'forced OFF by an operator override — NOT SCANNED, which is not the same as finding nothing.'
      : `this lane runs from depth ${d.from} (${doc.depthLevels[d.from - 1].label}); this repository is at depth ${depth} (${doc.depthLevels[depth - 1].label}). NOT SCANNED at this depth — a deliberate coverage gap, not a clean result.`;
  }
  return { known: true, run: d.on, reason, basis, env, depth: { value: depth, ...d }, intensity: { value: intensity, ...i } };
}

function clampLevel(v, levels, name, errs) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > levels.length) {
    errs.push(`${name} ${JSON.stringify(v)} is outside 1-${levels.length}; using 3`);
    return 3;
  }
  // A numeric string is accepted and SAID. The settings store refuses it outright, and a preview
  // that quietly coerced what the store would reject would show the operator a tuning they cannot
  // save — the two ends must not disagree in silence.
  if (typeof v !== 'number') {
    errs.push(`${name} arrived as ${JSON.stringify(v)}, a ${typeof v}, and was read as ${n}. The settings store requires a number and will refuse this value on save.`);
  }
  return n;
}

export default { loadProfiles, detectHardware, matchProfile, resolveTuning, lanePlan, depthPlan, intensityPlan, ladderRank, PROFILES, DEPTH_LEVELS, INTENSITY_LEVELS };
