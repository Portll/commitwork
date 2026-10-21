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
//
// TWO MORE INPUTS, EACH IN ITS OWN FIELD. A lane's zero is a measurement only if the lane has
// recently been shown to fire on a planted positive (`positiveControl`, from the scan canary's
// record or a CW_POSITIVE_CONTROLS file), and a lane whose detector fires on nearly every repo it
// scans is describing itself (`defectSignature`, from monitor/defect-signature.mjs). Neither moves
// the band; both sit beside it as words or booleans, never as factors.

import { readFileSync } from 'node:fs';
import { nowISO } from '../lib/clock.mjs';
import { canaryEvidence } from './lane-capability.mjs';
import { signatureRows } from './defect-signature.mjs';

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
export function bandFor({ adjudicated = 0, sampling = 'opportunistic', intervalStated = false, intervalWide = true, interRater = false, externalEval = false, positiveControl = 'absent' } = {}) {
  if (!POSITIVE_CONTROL_STATES.includes(positiveControl)) throw new Error(`'${positiveControl}' is not a positive-control state (${POSITIVE_CONTROL_STATES.join('|')})`);
  const rung = (name, why) => ({ ...BY_NAME.get(name), why, positiveControl });
  if (externalEval) return rung('externally-verified', 'a third party evaluated this lane independently');
  if (adjudicated === 0) return rung('unmeasured', 'no adjudicated findings');
  if (sampling !== 'random') {
    return rung(adjudicated < 5 ? 'unmeasured' : 'anecdotal',
      `sampling is '${sampling}' — a selection cannot become a measurement by growing, so this lane is capped at anecdotal regardless of count (${adjudicated} adjudicated)`);
  }
  if (adjudicated < 5) return rung('anecdotal', `${adjudicated} adjudicated, fewer than 5`);
  if (!intervalStated) return rung('indicative', 'a random sample exists but no interval is stated');
  if (interRater) return rung('well-measured', 'stated interval and inter-rater agreement');
  if (intervalWide) return rung('provisional', 'stated interval, but wide');
  return rung('measured', 'stated interval');
}

// ── positive controls: has this lane been shown to fire on a planted positive, recently ──────────

export const POSITIVE_CONTROL_OUTCOMES = Object.freeze(['detected', 'missed', 'not-run']);
export const POSITIVE_CONTROL_STATES = Object.freeze(['absent', 'missed', 'stale', 'current']);
export const DEFAULT_POSITIVE_CONTROL_MAX_AGE_DAYS = 30;

const positiveControlsPath = () => process.env.CW_POSITIVE_CONTROLS || '';

export function positiveControlMaxAgeDays(env = process.env) {
  const raw = env.CW_POSITIVE_CONTROL_MAX_AGE_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_POSITIVE_CONTROL_MAX_AGE_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`CW_POSITIVE_CONTROL_MAX_AGE_DAYS=${JSON.stringify(raw)} is not a number of days`);
  return n;
}

/**
 * The per-lane positive-control record. With CW_POSITIVE_CONTROLS set it is that file:
 * `{ [lane]: { ranAt, outcome } }` (optionally under a `lanes` key), outcome from
 * POSITIVE_CONTROL_OUTCOMES. Otherwise it is derived from the scan canary's measured record
 * (fixtures/scan-canary/EXPECTED.json, CW_CANARY_DIR), per LANE_ROSTER category: a credited
 * both-directions verdict is `detected`, any other recorded verdict is `missed` with the verdict
 * kept. ENOENT is the one absence; anything else unreadable throws.
 */
export function readPositiveControls({ path = positiveControlsPath(), canaryDir } = {}) {
  if (path) {
    let doc;
    try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
      if (e && e.code === 'ENOENT') return { source: 'positive-controls', path, read: false, lanes: {} };
      throw e;
    }
    const map = doc && typeof doc === 'object' && !Array.isArray(doc)
      ? (doc.lanes && typeof doc.lanes === 'object' && !Array.isArray(doc.lanes) ? doc.lanes : doc)
      : null;
    if (!map) throw new Error(`${path}: a positive-control record is an object keyed by lane`);
    const lanes = {};
    for (const lane of Object.keys(map).sort()) {
      const r = map[lane];
      if (!r || typeof r !== 'object' || !POSITIVE_CONTROL_OUTCOMES.includes(r.outcome)) {
        throw new Error(`${path}: lane '${lane}' needs an outcome from ${POSITIVE_CONTROL_OUTCOMES.join('|')}`);
      }
      lanes[lane] = { ranAt: r.ranAt ?? null, outcome: r.outcome };
    }
    return { source: 'positive-controls', path, read: true, lanes };
  }
  return positiveControlsFromCanary(canaryDir ? canaryEvidence(canaryDir) : canaryEvidence());
}

/** The positive-control record derived from an already-read canaryEvidence() result. */
export function positiveControlsFromCanary(canary) {
  if (!canary || !canary.read) return { source: 'scan-canary', read: false, lanes: {} };
  const lanes = {};
  for (const lane of Object.keys(canary.byCategory || {}).sort()) {
    const latest = [...canary.byCategory[lane]]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.lane).localeCompare(String(b.lane)))[0];
    lanes[lane] = { ranAt: latest.date || null, outcome: latest.credits ? 'detected' : 'missed', verdict: latest.verdict ?? null };
  }
  return { source: 'scan-canary', read: true, date: canary.date ?? null, lanes };
}

/** One lane's control, as a state word. A detection with no date cannot be shown current. */
export function positiveControlState(control, { now = nowISO(), maxAgeDays = positiveControlMaxAgeDays() } = {}) {
  if (!control || control.outcome === 'not-run') return 'absent';
  if (control.outcome === 'missed') return 'missed';
  if (control.outcome !== 'detected') throw new Error(`'${control.outcome}' is not a positive-control outcome`);
  if (!control.ranAt) return 'stale';
  const ran = Date.parse(control.ranAt);
  const at = Date.parse(now);
  if (Number.isNaN(ran)) throw new RangeError(`positive control ranAt is not a parseable timestamp: ${JSON.stringify(control.ranAt)}`);
  if (Number.isNaN(at)) throw new RangeError(`now is not a parseable timestamp: ${JSON.stringify(now)}`);
  return (at - ran) / 86_400_000 > maxAgeDays ? 'stale' : 'current';
}

/**
 * What a lane's sweep count means. Findings are findings whatever the control says; a ZERO is
 * `clean` only under a current control and `unmeasured` otherwise, because a lane that has not
 * recently been shown to fire has not been shown to look.
 */
export function sweepResultFor({ sweepFindings, positiveControl = 'absent' } = {}) {
  if (sweepFindings === undefined || sweepFindings === null) return null;
  const n = Number(sweepFindings);
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`sweepFindings must be a non-negative integer, got ${JSON.stringify(sweepFindings)}`);
  if (n > 0) return { result: 'findings', why: `${n} finding(s) this sweep` };
  if (positiveControl === 'current') return { result: 'clean', why: 'zero findings under a current positive control' };
  return { result: 'unmeasured', why: `zero findings, but the positive control is ${positiveControl}: the lane has not been shown to fire, so its silence is not a measurement` };
}

const laneOf = (e) => e.lane || String(e.detector || '').split('/')[0];

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

/**
 * The per-lane artifact — BAR A. Keyed on detector; carries no finding, no severity, no float.
 *
 * `positiveControls` is a readPositiveControls() record (read at call time when not given; pass
 * `null` for none). Each entry's lane is `entry.lane`, else the detector's prefix before `/`.
 * `defectSignatures` is a monitor/defect-signature.mjs artifact or its rows; a lane is flagged
 * when a signature names its detector exactly, or names its lane when the entry IS a lane.
 * `sweepFindings` on an entry yields `sweepResult` (findings | clean | unmeasured).
 */
export function buildLaneConfidence(entries, { at = null, refutations = [], positiveControls, defectSignatures, now, maxAgeDays } = {}) {
  const controls = positiveControls === undefined ? readPositiveControls() : positiveControls;
  const controlLanes = (controls && controls.lanes) || {};
  const stateOpts = { ...(now !== undefined ? { now } : {}), ...(maxAgeDays !== undefined ? { maxAgeDays } : {}) };
  const sigs = defectSignatures === undefined ? null : signatureRows(defectSignatures);
  const lanes = [];
  for (const e of entries || []) {
    const control = controlLanes[laneOf(e)] || null;
    const positiveControl = positiveControlState(control, stateOpts);
    const b = bandFor({ ...e, positiveControl });
    const contested = (refutations || []).filter((r) => r.detector === e.detector);
    const sweep = sweepResultFor({ sweepFindings: e.sweepFindings, positiveControl });
    const isLane = !String(e.detector || '').includes('/');
    const matched = sigs ? sigs.filter((s) => s.detector === e.detector || (isLane && s.lane === e.detector)).map((s) => s.detector).sort() : null;
    lanes.push({
      detector: e.detector,
      band: b.band,
      condition: b.condition,
      why: b.why,
      adjudicated: e.adjudicated || 0,
      sampling: e.sampling || 'opportunistic',
      positiveControl,
      positiveControlAt: control && control.ranAt ? control.ranAt : null,
      ...(sweep ? { sweepResult: sweep.result, sweepResultWhy: sweep.why } : {}),
      ...(matched ? { defectSignature: matched.length > 0, ...(matched.length ? { defectSignatures: matched } : {}) } : {}),
      ...(contested.length ? { refutations: contested } : {}),
    });
  }
  lanes.sort((a, b) => a.detector.localeCompare(b.detector));
  const tally = {};
  for (const l of lanes) tally[l.band] = (tally[l.band] || 0) + 1;
  const controlTally = {};
  for (const l of lanes) controlTally[l.positiveControl] = (controlTally[l.positiveControl] || 0) + 1;
  return {
    at,
    note: 'Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity — see monitor/lane-confidence.mjs for why.',
    vocabulary: BANDS.map((b) => b.band),
    positiveControls: { source: controls ? controls.source || null : null, read: !!(controls && controls.read), vocabulary: [...POSITIVE_CONTROL_STATES], tally: controlTally },
    lanes,
    tally,
  };
}

export default {
  BANDS, isBand, bandFor, assertNoRowConfidence, refuteBand, buildLaneConfidence,
  POSITIVE_CONTROL_OUTCOMES, POSITIVE_CONTROL_STATES, readPositiveControls, positiveControlsFromCanary, positiveControlState, positiveControlMaxAgeDays, sweepResultFor,
};
