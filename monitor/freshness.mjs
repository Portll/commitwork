// freshness.mjs — the sweep-liveness deadman: decides whether the freshest slice is fresh enough
// to be trusted as "current". Pure and dependency-free; decides nothing about severity.

// Fresh within one cadence + grace; STALE past that; EXPIRED once "no sweep ran" is the only explanation
export const DAY_MS = 24 * 60 * 60 * 1000;

// `generated` is re-stamped on every re-rollup; `sliceId` (`sweep-<14-digit-UTC-stamp>[-area]`)
// names when the SCAN ran and is never rewritten — classify on that.
// This literal mirrors area.mjs sweepBatches() verbatim (freshness.test.mjs asserts they agree);
// if area.mjs ever exports it as a constant, import that instead of keeping both.
const SLICE_STAMP_RE = /^sweep-(\d{14})/;

// The stamp is always UTC in this shape — reassemble to ISO and let Date.parse do the math.
// EXPORTED so a caller that needs the scan time WITHOUT a freshness verdict — the panel's fleet
// overview reports "last scanned" per area — reads it from here rather than re-deriving it. The
// re-derivation is the trap: `generated` is re-stamped on every re-rollup and is the field sitting
// right there in the artifact, so a second implementation reaches for it and reports an aggregation
// as a scan. Null on an unparseable or absent stamp, which every caller must render as unknown.
export function sliceScanIso(sliceId) {
  const m = typeof sliceId === 'string' ? sliceId.match(SLICE_STAMP_RE) : null;
  if (!m) return null;
  const s = m[1];
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}.000Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

// classifyFreshness(generatedISO, nowMs, opts?) → { state, age*, generated, lastRolledUp*,
//   sliceId, scanTime, threshold };  state ∈ 'fresh' | 'stale' | 'expired' | 'unknown' | 'paused'
//   (missing/unparseable timestamp ⇒ 'unknown', never fresh; opts.paused ⇒ 'paused', never fresh).
// Two conventions: no `sliceId` key in opts → legacy, classify on generatedISO. `sliceId` present
// (even null) → classify on the scan time parsed from it, failing CLOSED to 'unknown' — never
// falling back to the re-stampable `generated` (still carried as `lastRolledUp`).
export function classifyFreshness(generatedISO, nowMs, opts = {}) {
  const cadenceMs = opts.cadenceMs ?? DAY_MS;
  const graceMs = opts.graceMs ?? 2 * 60 * 60 * 1000;   // 2h: a run may start late and take time
  const expireMs = opts.expireMs ?? cadenceMs * 2 + graceMs; // two missed cadences ⇒ expired
  const threshold = { cadenceMs, graceMs, expireMs };

  const usesSlice = Object.prototype.hasOwnProperty.call(opts, 'sliceId');
  const lastRolledUp = generatedISO ?? null;
  const lastRolledUpMs = lastRolledUp ? Date.parse(lastRolledUp) : NaN;
  const lastRolledUpAgeMs = Number.isFinite(lastRolledUpMs) ? Math.max(0, nowMs - lastRolledUpMs) : null;
  const lastRolledUpAgeHours = lastRolledUpAgeMs == null ? null : Math.round(lastRolledUpAgeMs / 3.6e6);

  const sliceId = usesSlice ? (opts.sliceId ?? null) : null;
  const scanTime = usesSlice ? sliceScanIso(sliceId) : null;
  // The slice's scan time once asked for (unparseable falls to 'unknown' below), else legacy generatedISO
  const effectiveISO = usesSlice ? scanTime : generatedISO;

  const t = effectiveISO ? Date.parse(effectiveISO) : NaN;
  if (!Number.isFinite(t)) {
    // `paused` wins over `unknown` here because it EXPLAINS the silence rather than dressing it up
    // — and it is not a pass, so fail-closed is not weakened. The null scanTime still travels, so
    // the missing stamp stays visible to anyone reading past the state.
    return {
      state: opts.paused ? 'paused' : 'unknown', ageMs: null, ageHours: null,
      generated: generatedISO ?? null, lastRolledUp, lastRolledUpAgeMs, lastRolledUpAgeHours,
      sliceId, scanTime, threshold,
    };
  }
  const ageMs = Math.max(0, nowMs - t);
  // PAUSED is its own state, and it is neither fresh nor stale. A paused area accrues age forever,
  // so without this it reports permanent expiry — "a red that is not a finding and that nobody can
  // clear, which trains readers to ignore the freshness signal everywhere" (install-agents.mjs on
  // the same hazard). It is emphatically NOT fresh either: nothing has been scanned. The age still
  // travels, because how long it has been paused is exactly what a reader needs.
  const state = opts.paused ? 'paused'
    : ageMs <= cadenceMs + graceMs ? 'fresh' : ageMs <= expireMs ? 'stale' : 'expired';
  return {
    state, ageMs, ageHours: Math.round(ageMs / 3.6e6),
    generated: generatedISO, lastRolledUp, lastRolledUpAgeMs, lastRolledUpAgeHours,
    sliceId, scanTime, threshold,
  };
}

// A one-line human summary for logs / the dashboard.
export function freshnessSummary(f) {
  if (f.state === 'unknown') return 'freshness unknown — no generation timestamp';
  // Before the paused arm existed this fell through to EXPIRED, which is the same sentence a
  // reader acts on — and there is nothing to act on here.
  if (f.state === 'paused') {
    return `PAUSED — not swept by declaration${f.ageHours == null ? '' : `; last scan ${f.ageHours}h ago`}`;
  }
  if (f.state === 'fresh') return `fresh (${f.ageHours}h old)`;
  if (f.state === 'stale') return `STALE (${f.ageHours}h old) — a scheduled sweep may have been missed`;
  return `EXPIRED (${f.ageHours}h old) — the sweep has not run; this result is not current`;
}
