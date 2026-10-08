#!/usr/bin/env node
/**
 * disk-headroom.mjs — decide whether a test run's results are ATTRIBUTABLE, or whether the disk
 * made them up.
 *
 * WHY THIS EXISTS. On 2026-08-30 a full volume produced a fleet of failures across unrelated
 * write-touching suites, and the gate reported them as "committed and attributable" — the bucket a
 * reader trusts. ENOSPC is not a loud crash in this codebase: it is swallowed by hundreds of bare
 * `catch {}` blocks and surfaces only as a mass of unrelated red, tests failing two orders of
 * magnitude FAST, and tools going quiet because a tool that must write to speak cannot. Four
 * separate false attributions were measured that day before anyone checked `df`.
 *
 * This is the house's own explicit uncertainty rule applied to the instrument: when the disk was low, or
 * when we could not measure it, a failing run is UNDETERMINED, not evidence against a commit.
 *
 * Zero dependencies. Env is read at CALL time, never at module load — a `const X = process.env.Y`
 * at import silently defeats any test that sets the override afterwards.
 */
import { statfsSync } from 'node:fs';

/** Env read at call time; an explicitly-set 0 is honoured, never treated as "unset". */
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return { value: fallback, source: 'default' };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { value: fallback, source: 'default' };
  return { value: n, source: 'env' };
}

export function minFreeMb() { return envNumber('CW_DISK_MIN_FREE_MB', 512); }

/**
 * Host posture thresholds, as a PERCENTAGE of the volume.
 *
 * WHY A SECOND SCALE. minFreeMb answers "can this run still write" and its 512 MB floor is right
 * for that question. It is three orders of magnitude below where a host starts failing: on
 * 2026-09-24 this box sat at 29 GiB free of 926 (3%), Docker's containerd store returned EIO on
 * every image read for days, and the 512 MB floor certified every test run as attributable the
 * whole time. Both readings are needed and neither substitutes for the other — an absolute floor
 * does not scale with the volume, and a percentage says nothing about whether 512 MB remains.
 */
export function hostThresholds() {
  return { warnPct: envNumber('CW_DISK_WARN_PCT', 15), failPct: envNumber('CW_DISK_FAIL_PCT', 8) };
}

/**
 * One reading. Never throws: an unmeasurable filesystem is its own state, reported as such, because
 * a sampler that throws would take the run down with it and a sampler that returned 0 would read as
 * a full disk.
 */
export function sampleHeadroom({ path = process.cwd(), statfs = statfsSync } = {}) {
  try {
    const s = statfs(path);
    // bavail, not bfree: blocks available to an unprivileged writer, which is who is writing here.
    const freeBytes = Number(s.bavail) * Number(s.bsize);
    if (!Number.isFinite(freeBytes)) return { ok: false, unknown: true, path, reason: 'statfs returned a non-finite size' };
    // A volume whose total is unreadable still has a usable byte reading, so freePct is null rather
    // than absent: the byte question stays answerable when the percentage question is not.
    const totalBytes = Number(s.blocks) * Number(s.bsize);
    const totalOk = Number.isFinite(totalBytes) && totalBytes > 0;
    return {
      ok: true, unknown: false, path, freeBytes, freeMb: Math.floor(freeBytes / 1048576),
      totalBytes: totalOk ? totalBytes : null,
      freePct: totalOk ? (freeBytes / totalBytes) * 100 : null,
    };
  } catch (e) {
    return { ok: false, unknown: true, path, reason: `statfs failed: ${e && e.code ? e.code : String(e && e.message || e)}` };
  }
}

/**
 * Verdict over a run bracketed by two samples.
 *   attributable:true   the disk was healthy throughout — failures mean what they say
 *   attributable:false  low or unmeasurable — failures are UNDETERMINED, publish neither pass nor fail
 * Fail closed: a missing or unreadable endpoint is never "fine".
 */
export function assessRun(before, after, { minFreeMb: min } = {}) {
  const threshold = min === undefined ? minFreeMb().value : min;
  if (!before || !after || !before.ok || !after.ok) {
    const reason = [before, after].filter((s) => s && s.reason).map((s) => s.reason)[0] || 'a headroom sample is missing';
    return { verdict: 'unknown', attributable: false, thresholdMb: threshold, reason };
  }
  const lowestMb = Math.min(before.freeMb, after.freeMb);
  if (lowestMb < threshold) {
    return {
      verdict: 'low', attributable: false, thresholdMb: threshold, lowestMb,
      reason: `free space fell to ${lowestMb} MB, under the ${threshold} MB floor — failures in this run are undetermined, not attributable`,
    };
  }
  return { verdict: 'ok', attributable: true, thresholdMb: threshold, lowestMb };
}

/**
 * Host posture from a single sample. Independent of assessRun: a run can be perfectly attributable
 * on a volume that is three days from taking the box down, which is the exact state this check was
 * written for.
 */
export function assessHostHeadroom(sample, { warnPct: warn, failPct: fail } = {}) {
  const t = hostThresholds();
  const warnAt = warn === undefined ? t.warnPct.value : warn;
  const failAt = fail === undefined ? t.failPct.value : fail;
  const at = { warnPct: warnAt, failPct: failAt };
  if (!sample || !sample.ok) {
    return { ...at, verdict: 'unknown', healthy: false, reason: (sample && sample.reason) || 'no headroom sample' };
  }
  if (sample.freePct === null) {
    return { ...at, verdict: 'unknown', healthy: false, reason: `volume total for ${sample.path} was unreadable, so free percentage is unknown` };
  }
  // An inverted pair would make `fail` unreachable and report a dying volume as healthy. Refusing to
  // rank is the only honest answer; silently swapping them would hide the misconfiguration forever.
  if (failAt > warnAt) {
    return { ...at, verdict: 'unknown', healthy: false, freePct: sample.freePct, reason: `thresholds inverted: fail ${failAt}% is above warn ${warnAt}%` };
  }
  const freePct = sample.freePct;
  const shared = { ...at, freePct, freeMb: sample.freeMb, path: sample.path };
  if (freePct < failAt) return { ...shared, verdict: 'fail', healthy: false, reason: `${freePct.toFixed(1)}% free, under the ${failAt}% floor` };
  if (freePct < warnAt) return { ...shared, verdict: 'warn', healthy: false, reason: `${freePct.toFixed(1)}% free, under the ${warnAt}% warning line` };
  return { ...shared, verdict: 'ok', healthy: true };
}

/** One line for an operator. Silent-on-healthy is the caller's choice, never this function's. */
export function describeHost(a) {
  const where = a.path ? ` on ${a.path}` : '';
  if (a.verdict === 'ok') return `disk headroom ok — ${a.freePct.toFixed(1)}% free${where} (warn ${a.warnPct}%, fail ${a.failPct}%)`;
  if (a.verdict === 'unknown') return `DISK HEADROOM UNKNOWN${where} — ${a.reason}. Treat this as unmeasured, not healthy.`;
  return `DISK HEADROOM ${a.verdict.toUpperCase()}${where} — ${a.reason}. A volume this full makes Docker and every writer fail in ways that do not name the disk.`;
}

/** One line for a gate to print above its results. */
export function describeRun(a) {
  if (a.attributable) return `disk ok — ${a.lowestMb} MB free at the low-water mark (floor ${a.thresholdMb} MB)`;
  return `DISK ${a.verdict.toUpperCase()} — ${a.reason}. Treat this run's failures as UNDETERMINED.`;
}
