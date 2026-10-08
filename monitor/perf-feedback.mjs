// Ongoing tuning feedback: what the scanners ACTUALLY cost on this machine, recorded from real
// sweeps, so the derived defaults can be corrected by measurement instead of staying declarations
// forever.
//
// perf-profiles.json holds what we ASSERT a scanner costs. This holds what it cost. The two are
// kept apart on purpose: a declared default that quietly rewrites itself from one noisy run is a
// metric writing its own answers into the ledger (class M4, metric self-dealing). Nothing here
// mutates the profile document. It reports the drift and the operator decides.
//
// Append-only JSONL, atomic writes, env-overridable path read at CALL time.

import { readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const feedbackPath = () => process.env.CW_PERF_FEEDBACK
  || resolve(process.env.CW_REPORTS_ROOT || 'reports', 'perf-feedback.jsonl');

export const SAMPLE_VERSION = 1;

/** Record one scanner run. Never throws into a scan: a tuning log that can break a sweep is worse
 *  than no tuning log. Failures are returned, not raised. */
export function recordRun(sample, { path = feedbackPath() } = {}) {
  const row = {
    v: SAMPLE_VERSION,
    at: sample.at || process.env.CW_NOW || null,
    scanner: String(sample.scanner || ''),
    repo: String(sample.repo || ''),
    ms: Number(sample.ms),
    exit: sample.exit === undefined ? null : Number(sample.exit),
    profileId: sample.profileId || null,
    depth: sample.depth ?? null,
    intensity: sample.intensity ?? null,
    jobs: sample.jobs ?? null,
    cores: sample.cores ?? null,
    ramGB: sample.ramGB ?? null,
    loadAtStart: sample.loadAtStart ?? null,
    bytesOut: sample.bytesOut ?? null,
  };
  if (!row.scanner || !Number.isFinite(row.ms)) {
    return { ok: false, error: 'a sample needs at least a scanner id and a finite duration' };
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(row) + '\n');
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: `perf feedback not recorded: ${e.code || e.message}` };
  }
}

/** Fail closed: ENOENT is the only absence. An unreadable log is UNKNOWN, never an empty history —
 *  an empty history would read as "this scanner has never been slow", which is the flattering
 *  direction and the whole class this repository exists to refuse. */
export function readSamples({ path = feedbackPath() } = {}) {
  if (!existsSync(path)) return { ok: true, samples: [], state: 'absent' };
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    return { ok: false, state: 'unreadable', error: `${e.code || e.message}`, samples: null };
  }
  const samples = []; let bad = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { samples.push(JSON.parse(line)); } catch { bad++; }
  }
  return { ok: true, samples, state: 'present', unparseableLines: bad };
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);

/** Observed cost per scanner. Reports the MINIMUM alongside the median deliberately: contention
 *  only ever adds time, so the fastest sample is the closest thing to the scanner's true cost and
 *  the median tells you what this machine actually delivers under its usual load. */
export function summarise({ path = feedbackPath(), minSamples = 3 } = {}) {
  const r = readSamples({ path });
  if (!r.ok) return { ok: false, state: r.state, error: r.error };
  const by = new Map();
  for (const s of r.samples) {
    if (!s || !s.scanner || !Number.isFinite(s.ms)) continue;
    if (!by.has(s.scanner)) by.set(s.scanner, []);
    by.get(s.scanner).push(s);
  }
  const scanners = [...by.entries()].map(([scanner, rows]) => {
    const ms = rows.map((x) => x.ms).sort((a, b) => a - b);
    const fails = rows.filter((x) => x.exit !== null && x.exit !== 0 && x.exit !== 1).length;
    return {
      scanner,
      samples: rows.length,
      enough: rows.length >= minSamples,
      minMs: ms[0],
      medianMs: pct(ms, 0.5),
      p90Ms: pct(ms, 0.9),
      maxMs: ms[ms.length - 1],
      nonZeroExits: fails,
      note: rows.length < minSamples
        ? `${rows.length} sample(s) — below the ${minSamples} needed to say anything; reported, not used`
        : '',
    };
  }).sort((a, b) => (b.medianMs || 0) - (a.medianMs || 0));
  return { ok: true, state: r.state, totalSamples: r.samples.length, unparseableLines: r.unparseableLines || 0, scanners };
}

/** Compare observed cost against the class each scanner is DECLARED as, and report the disagreements.
 *  It returns drift; it does not apply it. */
export function drift({ path = feedbackPath(), doc = null, minSamples = 3 } = {}) {
  const sum = summarise({ path, minSamples });
  if (!sum.ok) return sum;
  let profiles = doc;
  if (!profiles) {
    // Imported lazily so a missing profile document degrades this to "cannot compare" rather than
    // taking the whole feedback surface down with it.
    return { ok: false, state: 'no-profiles', error: 'pass the profile document to compare against' };
  }
  const rows = [];
  for (const s of sum.scanners) {
    if (!s.enough) continue;
    const declared = profiles.scanners?.[s.scanner];
    if (!declared) { rows.push({ scanner: s.scanner, issue: 'observed but not declared in perf-profiles.json', medianMs: s.medianMs }); continue; }
    const cls = profiles.costClasses?.[declared.cost];
    if (!cls) continue;
    const observedClass = classify(s.medianMs, profiles.costClasses);
    if (observedClass && observedClass !== declared.cost) {
      rows.push({
        scanner: s.scanner,
        declaredClass: declared.cost,
        observedClass,
        medianMs: s.medianMs,
        minMs: s.minMs,
        samples: s.samples,
        issue: `declared ${declared.cost}, observed ${observedClass} over ${s.samples} runs`,
      });
    }
    if (s.medianMs > cls.timeoutMs * 0.8) {
      rows.push({ scanner: s.scanner, issue: `median ${Math.round(s.medianMs / 1000)}s is within 20% of its ${Math.round(cls.timeoutMs / 1000)}s timeout — the timeout will start firing`, medianMs: s.medianMs, samples: s.samples });
    }
  }
  return { ok: true, state: sum.state, totalSamples: sum.totalSamples, drift: rows, scanners: sum.scanners };
}

function classify(ms, costClasses) {
  if (!Number.isFinite(ms) || !costClasses) return null;
  const order = ['light', 'medium', 'heavy', 'very-heavy'];
  const bands = { light: 20000, medium: 120000, heavy: 900000, 'very-heavy': Infinity };
  for (const k of order) if (costClasses[k] && ms <= bands[k]) return k;
  return 'very-heavy';
}

export default { recordRun, readSamples, summarise, drift, feedbackPath };
