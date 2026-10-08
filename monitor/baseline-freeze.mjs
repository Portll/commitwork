#!/usr/bin/env node
// monitor/baseline-freeze.mjs — the 1.0 pre-registration, and proof it actually happened.
//
// fact: a hash chain proves a record was not ALTERED and says nothing about whether the thing it records ever RAN / a freeze that silently no-ops leaves no event, and "no event" is indistinguishable from "not yet due" until somebody cites a baseline that does not exist (expiry: never, prev: unknown)
// fact: a pre-registration written AFTER the first measurement is a post-registration wearing the word "pre" / the only thing separating the two is a timestamp somebody can check, so the record has to carry one and the liveness state has to read it (expiry: never, prev: unknown)
//
// TWO PROPERTIES, AND THEY ARE DIFFERENT PROBLEMS.
//
//   INTEGRITY — the pre-registration must not be editable after the fact. Solved by the same chain
//   shape monitor/issue-store.mjs uses: each record carries prevHash, and verifyFreezeChain() walks
//   it. A rewrite that re-chains is still detectable because the FIRST record's hash changes.
//
//   OCCURRENCE — the freeze must be provably to have happened, or its absence must be loud. Solved
//   by borrowing the sweep-liveness deadman's discipline from monitor/freshness.mjs, which fails
//   closed to `unknown` and never to fresh.
//
// ONE STATE THE SWEEP DOES NOT HAVE. `pending` — scheduled and not yet due — is legitimately
// different from missing, and collapsing it into `expired` would make an on-schedule programme
// report a failure every day until the freeze date. Equally, collapsing it the other way would let
// a never-scheduled baseline sit quietly as "not yet". So `expectedBy` is REQUIRED: a freeze with
// no due date is `unknown`, not `pending`, because nothing can be said about a deadline nobody set.

import { createHash } from 'node:crypto';

/** Stable hash over the record's content plus its predecessor. Key order is fixed, not object order. */
export function freezeHash(prevHash, rec) {
  const material = JSON.stringify([
    prevHash, rec.at, rec.laneSet, rec.sampling, rec.adjudicationProtocol, rec.interRaterPlan, rec.by, rec.note,
  ]);
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Append a pre-registration. Every field is required BEFORE any measurement exists, which is the
 * whole point: a lane set chosen after seeing the results is not a pre-registration.
 */
export function appendFreeze(records, { laneSet, sampling, adjudicationProtocol, interRaterPlan, by = null, note = '', at }) {
  if (!Array.isArray(laneSet) || !laneSet.length) throw new Error('a freeze must name the lane set it covers — an unbounded pre-registration pre-registers nothing');
  if (sampling !== 'random') throw new Error("a freeze must declare sampling:'random'; an opportunistic set is a selection and cannot be pre-registered as a sample");
  if (!adjudicationProtocol || !String(adjudicationProtocol).trim()) throw new Error('a freeze must state how findings will be adjudicated, before any are');
  if (!interRaterPlan || !String(interRaterPlan).trim()) throw new Error('a freeze must state how inter-rater agreement will be established');
  if (!at) throw new Error('a freeze must carry the time it was made — it is what separates a pre-registration from a post-registration');

  const prev = records.length ? records[records.length - 1] : null;
  const prevHash = prev ? prev.hash : null;
  const rec = {
    at, laneSet: [...laneSet].sort(), sampling, adjudicationProtocol: String(adjudicationProtocol),
    interRaterPlan: String(interRaterPlan), by, note: String(note || ''), prevHash, hash: '',
  };
  rec.hash = freezeHash(prevHash, rec);
  return [...records, rec];
}

/** Walk the chain. Returns problems; an empty array is the passing state. */
export function verifyFreezeChain(records) {
  const problems = [];
  let prev = null;
  (records || []).forEach((r, i) => {
    if (r.prevHash !== prev) problems.push(`freeze[${i}]: prevHash mismatch`);
    if (r.hash !== freezeHash(r.prevHash, r)) problems.push(`freeze[${i}]: hash mismatch (at ${r.at})`);
    prev = r.hash;
  });
  return problems;
}

/**
 * Did the freeze happen, and is it still the current one?
 *
 * States: `pending` (due date not reached, no freeze yet) · `frozen` (a valid freeze exists and is
 * current) · `expired` (due date passed with no freeze, OR the freeze predates a stated
 * supersede-by) · `unknown` (unreadable, unverifiable, or no due date set — never `pending`, and
 * never `frozen`).
 *
 * FAILS CLOSED. Anything it cannot establish reads `unknown`, which is neither a pass nor a
 * scheduled-and-fine. That is the deadman's discipline: a baseline that should exist and does not
 * becomes a loud state rather than an absence.
 */
export function freezeLiveness(records, { expectedBy = null, now = null } = {}) {
  const nowMs = now ? Date.parse(now) : NaN;
  if (!Number.isFinite(nowMs)) return { state: 'unknown', why: 'no readable current time to judge against', freeze: null };
  if (!expectedBy) {
    return { state: 'unknown', why: 'no expected-freeze-by date is set — nothing can be said about a deadline nobody declared', freeze: null };
  }
  const dueMs = Date.parse(expectedBy);
  if (!Number.isFinite(dueMs)) return { state: 'unknown', why: `expectedBy '${expectedBy}' is unparseable`, freeze: null };

  const list = Array.isArray(records) ? records : null;
  if (!list) return { state: 'unknown', why: 'freeze records are unreadable', freeze: null };

  const problems = verifyFreezeChain(list);
  if (problems.length) {
    // An unverifiable chain is NOT a missing freeze and NOT a valid one. Reporting it as either
    // would be the more damaging error, so it is its own loud state.
    return { state: 'unknown', why: `freeze chain does not verify: ${problems[0]}`, freeze: null, problems };
  }

  if (!list.length) {
    return nowMs < dueMs
      ? { state: 'pending', why: `no freeze yet; due by ${expectedBy}`, freeze: null }
      : { state: 'expired', why: `expected by ${expectedBy} and no freeze exists — a baseline that should exist and does not`, freeze: null };
  }

  const latest = list[list.length - 1];
  const madeMs = Date.parse(latest.at);
  if (!Number.isFinite(madeMs)) return { state: 'unknown', why: 'the latest freeze carries an unparseable timestamp', freeze: latest };
  return { state: 'frozen', why: `frozen at ${latest.at} over ${latest.laneSet.length} lane(s)`, freeze: latest };
}

/**
 * Was this freeze made BEFORE the measurement it governs? The one check that separates a
 * pre-registration from a post-registration, and it is answered from timestamps rather than trust.
 */
export function isPreRegistration(freeze, firstMeasurementAt) {
  if (!freeze || !freeze.at) return { ok: false, why: 'no freeze to check' };
  const f = Date.parse(freeze.at); const m = Date.parse(firstMeasurementAt);
  if (!Number.isFinite(f) || !Number.isFinite(m)) return { ok: false, why: 'unparseable timestamp on one side — cannot establish order' };
  return f < m
    ? { ok: true, why: `frozen ${freeze.at} before first measurement ${firstMeasurementAt}` }
    : { ok: false, why: `frozen ${freeze.at} at or AFTER first measurement ${firstMeasurementAt} — this is a post-registration` };
}

export default { freezeHash, appendFreeze, verifyFreezeChain, freezeLiveness, isPreRegistration };
