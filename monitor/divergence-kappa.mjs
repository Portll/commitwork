// divergence-kappa.mjs — lens agreement for the CodeQL stage-1 pairs: Cohen's kappa over the
// recorded independent classifications of one engine pair (local model × claude -p opus), fed to
// divergenceScore as its `correlation`.

// fact: kappa over unadjudicated pairs is an upper bound on error correlation, not the correlation / two engines that are both right agree too, and without a ground truth all agreement is charged to correlation
// fact: as the discount it can only raise a divergence score / it points a person at more, never at less
// fact: the pairs are divergence rows, not job records / a re-run supersedes a job record and the panel's clear deletes it, and a job without a row predates the recorded sampling basis
// fact: one pair per finding, its latest / a re-run is not a new item, and counting it would let one finding meet the minimum alone
// fact: no estimate pools two sampling bases / claude -p sends no temperature, so the local analyst's basis is the one that varies, and an unrecorded basis joins no estimate

import { readDimension } from './nondeterministic-store.mjs';

export const KAPPA_METHOD = 'kappa-upper-bound';
// fact: at n=30, observed 0.8 and chance 0.5, kappa's standard error is still about 0.15 / below it a figure is a guess
export const KAPPA_MIN_N = 30;
export const STAGE1_SOURCE = 'codeql-remediation';
export const STAGE1_BASIS = 'stage-1 independent analyses';
export const UNRECORDED = 'unrecorded';

const r4 = (x) => Number(x.toFixed(4));

/** `provider:model` for one recorded side, preferring what answered over what was asked; null if unrecorded. */
export function engineOf(side) {
  const ab = side && side.answeredBy, en = side && side.engine;
  const provider = (ab && ab.provider) || (en && (en.provider || en.engine)) || null;
  const model = (ab && ab.model) || (en && en.model) || null;
  return provider && model ? `${provider}:${model}` : null;
}

export function pairKey(local, opus) {
  const a = engineOf(local), b = engineOf(opus);
  return a && b ? `${a} × ${b}` : null;
}

export const samplingBasis = (local) => (local && typeof local.sampling === 'string' && local.sampling ? local.sampling : UNRECORDED);

/** One divergence row as a stage-1 pair, or null when it is not a recorded CodeQL stage-1 pair. */
export function stage1Pair(row) {
  const d = row && row.detail;
  if (!d || d.source !== STAGE1_SOURCE || d.basis !== STAGE1_BASIS) return null;
  const a = d.local && d.local.classification, b = d.opus && d.opus.classification;
  const pair = pairKey(d.local, d.opus);
  if (typeof a !== 'string' || typeof b !== 'string' || !pair || !row.subject) return null;
  return { subject: String(row.subject), pair, sampling: samplingBasis(d.local), a, b, ts: typeof row.ts === 'string' ? row.ts : '' };
}

/**
 * Cohen's kappa over [{a, b}]. Integer counts until the last division, so the same pairs give the
 * same figure in any order. kappa is null when chance agreement is 1: both engines gave every pair
 * the same single class, and agreement beyond chance is undefined.
 */
export function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, observed: null, chance: null, kappa: null, why: 'no pairs' };
  const ca = new Map(), cb = new Map();
  let agree = 0;
  for (const { a, b } of pairs) {
    if (a === b) agree++;
    ca.set(a, (ca.get(a) || 0) + 1);
    cb.set(b, (cb.get(b) || 0) + 1);
  }
  let byChance = 0;
  for (const [c, x] of ca) byChance += x * (cb.get(c) || 0);
  const nn = n * n;
  const observed = agree / n, chance = byChance / nn;
  if (byChance === nn) return { n, observed: r4(observed), chance: 1, kappa: null, why: 'both engines gave every pair the same single class, so chance agreement is 1 and kappa is undefined' };
  return { n, observed: r4(observed), chance: r4(chance), kappa: r4((agree * n - byChance) / (nn - byChance)) };
}

/**
 * The estimate for one engine pair on one sampling basis. `measured: false` carries `why` and no
 * figure; a measured one carries n, observed, chance, kappa and `correlation` (kappa clamped to
 * [0,1]: agreement below chance applies no discount).
 */
export function estimateKappa(rows, { pair, sampling, minN = KAPPA_MIN_N } = {}) {
  const base = { method: KAPPA_METHOD, pair: pair || null, sampling: sampling || UNRECORDED, minN };
  const none = { pairs: 0, n: 0, observed: null, chance: null, kappa: null };
  if (!pair) return { ...base, ...none, measured: false, why: 'the engine pair was not recorded, so no past pair can be matched to it' };
  if (base.sampling === UNRECORDED) return { ...base, ...none, measured: false, why: "the local analyst's sampling basis was not recorded, and pairs of unknown basis are never pooled" };
  const latest = new Map();
  let matched = 0;
  for (const r of rows || []) {
    const p = stage1Pair(r);
    if (!p || p.pair !== pair || p.sampling !== base.sampling) continue;
    matched++;
    const prev = latest.get(p.subject);
    if (!prev || p.ts >= prev.ts) latest.set(p.subject, p);
  }
  const k = cohenKappa([...latest.values()]);
  if (k.n < minN) return { ...base, ...none, pairs: matched, n: k.n, measured: false, why: `${k.n} finding(s) with a stage-1 pair for this engine pair at ${base.sampling} sampling, below the minimum of ${minN}` };
  const out = { ...base, pairs: matched, n: k.n, observed: k.observed, chance: k.chance, kappa: k.kappa };
  if (k.kappa === null) return { ...out, measured: false, why: k.why };
  return { ...out, measured: true, correlation: Math.max(0, Math.min(1, k.kappa)) };
}

/** Every (engine pair, sampling basis) the rows hold, each estimated on its own. Sorted, so stable. */
export function allEstimates(rows, { minN = KAPPA_MIN_N } = {}) {
  const groups = new Map();
  for (const r of rows || []) {
    const p = stage1Pair(r);
    if (p) groups.set(`${p.pair}\u0000${p.sampling}`, { pair: p.pair, sampling: p.sampling });
  }
  return [...groups.keys()].sort().map((k) => estimateKappa(rows, { ...groups.get(k), minN }));
}

/** Every row of the store's divergence dimension. Throws on an unreadable store; absent is []. */
export function divergenceRows() {
  return readDimension('divergence').subjects.flatMap((s) => s.rows.map((r) => ({ ...r, subject: r.subject ?? s.subject })));
}

/**
 * The correlation and detail fields for a new stage-1 row, estimated over the rows already recorded.
 * An unreadable store leaves it unmeasured with the reason, never estimated over what could be read.
 */
export function correlationFor({ local, opus } = {}, { minN = KAPPA_MIN_N, read = divergenceRows } = {}) {
  const pair = pairKey(local, opus), sampling = samplingBasis(local);
  let est;
  try { est = estimateKappa(read(), { pair, sampling, minN }); }
  catch (e) { est = { method: KAPPA_METHOD, pair, sampling, minN, n: null, measured: false, why: `the divergence store could not be read (${e.message})` }; }
  if (!est.measured) {
    return { correlation: 0, estimate: est, detail: { correlation: 'unmeasured', correlationApplied: 0, correlationWhy: est.why, correlationBasis: { method: KAPPA_METHOD, pair, sampling, n: est.n, minN } } };
  }
  const { n, kappa, observed, chance } = est;
  return { correlation: est.correlation, estimate: est, detail: { correlation: { method: KAPPA_METHOD, n, kappa, observed, chance, pair, sampling, minN }, correlationApplied: est.correlation } };
}
