#!/usr/bin/env node
// monitor/lane-confidence.mjs — how well a lane has been MEASURED, said in words that cannot be
// multiplied by a severity.
//
// fact: a confidence weight that reaches a finding row can be multiplied by its severity, and the next measurement then samples the MODIFIED output / that is a control loop whose reported accuracy improves every quarter, which is exactly the trace of a project succeeding — scored detectability 10 in the plan evaluation because nothing in the artefact distinguishes the two (expiry: never, prev: unknown)
// fact: severity is already a word and confidence was going to be a float, so `sev * confidence` is the one-line mistake nobody would flag in review (expiry: never, prev: unknown)
//
// THREE BARS, EACH STOPPING A DIFFERENT ACTOR. All three, deliberately — dropping one later is then
// a visible loss rather than a silent one.
//
//   A — the band lives in a PER-LANE artifact keyed on detector, never on a finding row.
//       Bars the accidental join by anything iterating findings.
//   B — it is a WORD from a closed 7-point vocabulary, never a number.
//       Bars multiplication AS AN OPERATION. You cannot multiply `well-measured` by `high`.
//   C — schema/scanner-finding.schema.json carries additionalProperties:false on every row shape,
//       so a confidence field on a finding row is REFUSED rather than tolerated.
//       Bars anything crossing the whitelist. Enforced by assertNoRowConfidence() below.
//
// Bars A and C are containment; B is the one that holds even if a future reader deliberately joins
// the artifact to a finding, because at that point they still have a word.
//
// This is the third time this repository has used a non-collapsible type for the same reason:
// `undetermined` sits outside crit/high/med/low, and `verified` is a tri-state rather than a
// boolean. Both exist so a consumer cannot fold two facts into one.

/**
 * The 7-point band. Each rung names an EVIDENTIARY CONDITION rather than a degree of feeling, so a
 * lane's position is checkable by a third party and therefore refutable. A scale of
 * slightly/moderately/very would be an opinion with seven gradations.
 */
export const BANDS = Object.freeze([
  { band: 'unmeasured', rank: 1, condition: 'no adjudicated findings in this lane' },
  { band: 'anecdotal', rank: 2, condition: 'fewer than 5 adjudicated findings' },
  { band: 'indicative', rank: 3, condition: 'a sample exists; no interval stated' },
  { band: 'provisional', rank: 4, condition: 'sample with a wide interval' },
  { band: 'measured', rank: 5, condition: 'sample with a stated interval' },
  { band: 'well-measured', rank: 6, condition: 'stated interval AND inter-rater agreement' },
  { band: 'externally-verified', rank: 7, condition: 'independently evaluated by a third party' },
]);

const BY_NAME = new Map(BANDS.map((b) => [b.band, b]));
export const isBand = (v) => BY_NAME.has(String(v));

/**
 * Derive a lane's band from its evidence. Conditions are checked from the TOP down and the first
 * one whose requirements are met wins — so a lane cannot reach a high rung by satisfying a low one.
 *
 * `sampling` matters and is not cosmetic: an opportunistic set is a selection, not a sample, so it
 * can never exceed `anecdotal` however large it grows. That is the same guard rateBase() enforces,
 * applied one level up — and it is why 136 opportunistically-adjudicated findings do not make a
 * lane `measured`.
 */
export function bandFor({ adjudicated = 0, sampling = 'opportunistic', intervalStated = false, intervalWide = true, interRater = false, externalEval = false } = {}) {
  if (externalEval) return { ...BY_NAME.get('externally-verified'), why: 'a third party evaluated this lane independently' };
  if (adjudicated === 0) return { ...BY_NAME.get('unmeasured'), why: 'no adjudicated findings' };
  if (sampling !== 'random') {
    return {
      ...BY_NAME.get(adjudicated < 5 ? 'unmeasured' : 'anecdotal'),
      why: `sampling is '${sampling}' — a selection cannot become a measurement by growing, so this lane is capped at anecdotal regardless of count (${adjudicated} adjudicated)`,
    };
  }
  if (adjudicated < 5) return { ...BY_NAME.get('anecdotal'), why: `${adjudicated} adjudicated, fewer than 5` };
  if (!intervalStated) return { ...BY_NAME.get('indicative'), why: 'a random sample exists but no interval is stated' };
  if (interRater) return { ...BY_NAME.get('well-measured'), why: 'stated interval and inter-rater agreement' };
  if (intervalWide) return { ...BY_NAME.get('provisional'), why: 'stated interval, but wide' };
  return { ...BY_NAME.get('measured'), why: 'stated interval' };
}

/** Row types that can be arithmetic. A `str` cannot be multiplied by anything. */
const NUMERIC_ROW_TYPES = new Set(['num', 'int']);

/**
 * BAR C, as an executable assertion rather than a convention. Returns the offending field paths;
 * an empty array is the passing state. Called by the test, and callable by any gate.
 *
 * TYPE-AWARE, AND THAT IS WHAT REMOVED THE EXEMPTION. The first version matched on NAME alone and
 * flagged supplyChainPosture.score — which is OpenSSF Scorecard's own per-check result about the
 * REPOSITORY, and is declared `str`. It carried a hand-written exemption for one turn.
 *
 * The exemption was the wrong shape. The danger is not a field called `score`, it is a field that
 * can be multiplied by a severity, and a string cannot be — which is Bar B's argument applied one
 * level down. So the guard now requires BOTH a confidence-shaped name AND an arithmetic type. That
 * is strictly narrower and strictly more accurate: `score: 'str'` passes because it is inert, while
 * a future `score: 'num'` on any lane fails until somebody decides which kind of score it is.
 *
 * No exemption list, so no stale permission can accumulate in one.
 */
export function assertNoRowConfidence(rowSchemas) {
  const bad = [];
  for (const [cat, spec] of Object.entries(rowSchemas || {})) {
    for (const [field, type] of spec.fields || []) {
      if (!/^(confidence|band|weight|accuracy|score)$/i.test(field)) continue;
      if (!NUMERIC_ROW_TYPES.has(String(type))) continue;   // a word is inert; only arithmetic is dangerous
      bad.push(`${cat}.${field}`);
    }
  }
  return bad;
}

/**
 * A refutation against a lane's band. A band is a CLAIM, so it can be contested — including by an
 * upstream maintainer whose detector is being banded. The refutation is recorded beside the band
 * and the band does not silently win.
 */
export function refuteBand({ detector, band, by, reason, at }) {
  if (!detector) throw new Error('a refutation must name the detector whose band it contests');
  if (!isBand(band)) throw new Error(`'${band}' is not one of the ${BANDS.length} bands`);
  if (!reason || !String(reason).trim()) throw new Error('a refutation without a reason is a disagreement, not a refutation');
  return { detector, band, by: by || null, reason: String(reason), at: at || null };
}

/** The per-lane artifact — BAR A. Keyed on detector; carries no finding, no severity, no float. */
export function buildLaneConfidence(entries, { at = null, refutations = [] } = {}) {
  const lanes = [];
  for (const e of entries || []) {
    const b = bandFor(e);
    const contested = (refutations || []).filter((r) => r.detector === e.detector);
    lanes.push({
      detector: e.detector,
      band: b.band,
      condition: b.condition,
      why: b.why,
      adjudicated: e.adjudicated || 0,
      sampling: e.sampling || 'opportunistic',
      ...(contested.length ? { refutations: contested } : {}),
    });
  }
  lanes.sort((a, b) => a.detector.localeCompare(b.detector));
  const tally = {};
  for (const l of lanes) tally[l.band] = (tally[l.band] || 0) + 1;
  return {
    at,
    note: 'Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity — see monitor/lane-confidence.mjs for why.',
    vocabulary: BANDS.map((b) => b.band),
    lanes,
    tally,
  };
}

export default { BANDS, isBand, bandFor, assertNoRowConfidence, refuteBand, buildLaneConfidence };
