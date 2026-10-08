// commitwork — off-box attestation evidence: the only thing that can attest `authAt:'edge'`
// (DECISIONS.md D5: Portll/commitwork-remote's scheduled runner is the vantage). Evidence with no
// off-box vantage, stale, unparseable, or unmatched fails CLOSED — the row stays UNVERIFIABLE.

import { readFileSync } from 'node:fs';

// Vantages that are genuinely NOT this box; anything else is not off-box evidence.
export const OFFBOX_VANTAGES = Object.freeze(new Set(['github-actions']));

// 24h tolerates four missed 6-hourly upstream runs before the evidence stops counting.
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// A DEAD PROBER AND AN UNPROBED HOST USED TO BE THE SAME ANSWER.
//
// Both arrived at attestRows() as the absence of a record, so every row reverted to UNVERIFIABLE —
// byte-identical to the state before this repository existed. That matters more here than almost
// anywhere else in the fleet: commitwork-remote exists BECAUSE every on-box watcher shares a failure
// mode with what it watches, and a watcher that cannot report its own absence has inherited the
// property it was built to escape. GitHub disables scheduled workflows on repositories with 60 days
// of inactivity, and a 3-file repo that runs unattended has low commit activity as its NORMAL state.
//
// `livenessOf` reads the DOCUMENT, not a record: how old is this evidence against the cadence the
// prober itself declares? The states are deliberately not the per-host verdicts — this answers
// "is the witness still witnessing", which is a different question from "what did it see".
export const LIVENESS = Object.freeze({
  LIVE: 'live',                 // within cadence + grace; the prober is running
  LAGGING: 'lagging',           // past cadence but inside maxAge; records still count, cadence has slipped
  DEAD: 'dead',                 // past maxAge; no record can be attested and the SCHEDULE is the suspect
  UNDECLARED: 'undeclared',     // the document names no cadence, so lateness cannot be judged
  UNDATED: 'undated',           // no usable `generated` — age is unknowable, which is not youth
});

// Two missed runs before `lagging` becomes the reading: one missed run is an Actions queue, two is
// a pattern. Deliberately narrower than DEFAULT_MAX_AGE_MS (four missed runs), so the shape of the
// answer degrades in steps rather than flipping from fine to gone.
export const CADENCE_GRACE_RUNS = 2;

/**
 * Is the prober still running? Reads the document's own declared cadence.
 * Returns { state, ageMs, cadenceMs, why } — never throws, never guesses a cadence it was not given.
 */
export function livenessOf(doc, { now, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const t = nowMs(now);
  const stamped = Date.parse((doc && doc.generated) || '');
  if (!Number.isFinite(stamped)) {
    return { state: LIVENESS.UNDATED, ageMs: null, cadenceMs: null,
      why: 'the evidence carries no usable `generated` timestamp, so its age cannot be judged — that is not the same as being fresh' };
  }
  const ageMs = t - stamped;
  if (ageMs > maxAgeMs) {
    return { state: LIVENESS.DEAD, ageMs, cadenceMs: null,
      why: `the newest evidence is ${Math.round(ageMs / 3600000)}h old (limit ${Math.round(maxAgeMs / 3600000)}h) — no host here can be attested, and the SCHEDULE is the thing to check, not the hosts` };
  }
  const cadenceMs = Number.isFinite(Number(doc.cadenceSeconds)) && Number(doc.cadenceSeconds) > 0
    ? Number(doc.cadenceSeconds) * 1000 : null;
  if (!cadenceMs) {
    return { state: LIVENESS.UNDECLARED, ageMs, cadenceMs: null,
      why: 'the evidence declares no cadence, so "late" has no definition here — recorded rather than assumed' };
  }
  if (ageMs > cadenceMs * (CADENCE_GRACE_RUNS + 1)) {
    return { state: LIVENESS.LAGGING, ageMs, cadenceMs,
      why: `the evidence is ${Math.round(ageMs / 60000)}m old against a declared cadence of ${Math.round(cadenceMs / 60000)}m — roughly ${Math.floor(ageMs / cadenceMs)} runs have not landed` };
  }
  return { state: LIVENESS.LIVE, ageMs, cadenceMs, why: null };
}

/** Only `live` and `lagging` are states in which a record may attest anything. `dead`, `undated`
 *  and `undeclared` are the prober's own voids and must not be spent on a host's behalf. */
export const livenessPermitsAttestation = (l) => !!l && (l.state === LIVENESS.LIVE || l.state === LIVENESS.LAGGING);

// ── PROBE KINDS — a DELIBERATE second copy of commitwork-remote's table ──────────────────────────
//
// The two repositories cannot share a module, so this is duplicated on purpose and the duplication
// is made to earn its keep: the producer computes `outcome` and this consumer RE-DERIVES it, and a
// disagreement is a refusal rather than a preference. Trusting the producer's outcome would make the
// consumer a renderer of someone else's verdict; recomputing it without comparing would make the
// producer's field decorative. Comparing both is the only arrangement in which the copy is a second
// witness instead of a second place to be wrong.
//
// UNREACHABLE is the cell that inverts, and the reason the kinds exist at all: no-information for a
// protected host, a FAILURE for one that must be up, a PASS for one that must not answer. One token,
// three meanings, and before the kind existed all three were the first.
export const PROBE_KINDS = Object.freeze({
  protected: {
    EDGE_AUTH: 'pass', UNPROTECTED: 'fail', UNREACHABLE: 'no-information', UNVERIFIABLE: 'no-information',
  },
  'available-and-protected': {
    EDGE_AUTH: 'pass', UNPROTECTED: 'fail', UNREACHABLE: 'fail', UNVERIFIABLE: 'fail',
  },
  unreachable: {
    EDGE_AUTH: 'fail', UNPROTECTED: 'fail', UNREACHABLE: 'pass', UNVERIFIABLE: 'fail',
  },
});

/** Records written before `kind` existed asked the only question there was. Defaulting them is
 *  correct BACKWARD-compatibility and would be wrong going forward, which is why probe.mjs defaults
 *  at the read and refuses an unrecognised value rather than relying on this. */
export const LEGACY_KIND = 'protected';

export function outcomeOf(kind, verdict) {
  const t = PROBE_KINDS[kind];
  if (!t) return null;
  return t[verdict] ?? null;
}

export function evidencePath() {
  return process.env.CW_OFFBOX_EVIDENCE || null;
}

export function nowMs(now) {
  if (now !== undefined) return now instanceof Date ? now.getTime() : now;
  if (process.env.CW_NOW) {
    const t = Date.parse(process.env.CW_NOW);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

/**
 * Parse a commitwork-remote probe-results.json into hostname -> accepted record.
 * Returns { byHost: Map, rejected: [{hostname, why}], error } — rejections are reported, not dropped.
 */
export function parseEvidence(text, { now, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const byHost = new Map();
  const rejected = [];
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { byHost, rejected, error: `evidence is not parseable JSON (${e.message})` };
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.results)) {
    return { byHost, rejected, error: 'evidence has no results[] array' };
  }
  if (!OFFBOX_VANTAGES.has(doc.vantage)) {
    return { byHost, rejected, error: `vantage ${JSON.stringify(doc.vantage ?? null)} is not off-box — this cannot attest a layer in front of the origin` };
  }
  // Carried on every return from here on, including the empty ones: a caller must be able to tell
  // "no hosts matched" from "the prober stopped". `run` rides along for the same reason — provenance
  // the reader can go and CHECK beats a vantage string they have to trust (commitwork-remote's
  // probe.mjs emits repository/runId/url when it is genuinely on a runner).
  const liveness = livenessOf(doc, { now, maxAgeMs });
  const run = doc.run && typeof doc.run === 'object' ? doc.run : null;
  const t = nowMs(now);
  for (const r of doc.results) {
    if (!r || typeof r.hostname !== 'string' || typeof r.verdict !== 'string') {
      rejected.push({ hostname: r && r.hostname, why: 'record is missing hostname or verdict' });
      continue;
    }
    const stamped = Date.parse(r.started ?? doc.generated ?? '');
    if (!Number.isFinite(stamped)) {
      rejected.push({ hostname: r.hostname, why: 'record carries no usable timestamp, so its age cannot be judged' });
      continue;
    }
    const ageMs = t - stamped;
    if (ageMs > maxAgeMs) {
      rejected.push({ hostname: r.hostname, why: `evidence is ${Math.round(ageMs / 3600000)}h old (limit ${Math.round(maxAgeMs / 3600000)}h)` });
      continue;
    }
    // A KIND THIS CONSUMER DOES NOT KNOW IS A REFUSAL. Defaulting it would answer whichever question
    // this file happens to implement, on behalf of an entry that asked a different one — and for an
    // `unreachable` entry that inversion turns the pass condition into no-information.
    const kind = r.kind === undefined ? LEGACY_KIND : r.kind;
    if (!PROBE_KINDS[kind]) {
      rejected.push({ hostname: r.hostname, why: `probe kind ${JSON.stringify(r.kind)} is not one of: ${Object.keys(PROBE_KINDS).join(', ')} — refusing rather than defaulting a question` });
      continue;
    }
    const derived = outcomeOf(kind, r.verdict);
    if (derived === null) {
      rejected.push({ hostname: r.hostname, why: `verdict ${JSON.stringify(r.verdict)} has no outcome under kind '${kind}'` });
      continue;
    }
    // The producer's own outcome, cross-checked. Agreement is the normal case and is worth nothing
    // to state; DISAGREEMENT means the two tables have drifted, and a drifted pair of verdicts is
    // exactly the condition neither side can detect alone.
    if (r.outcome !== undefined && r.outcome !== derived) {
      rejected.push({ hostname: r.hostname, why: `the probe recorded outcome '${r.outcome}' and this consumer derives '${derived}' for kind '${kind}' + verdict '${r.verdict}' — the two kind tables have drifted and neither reading may be used` });
      continue;
    }
    // Last writer wins per hostname — a later record is the more recent observation.
    byHost.set(r.hostname, { ...r, kind, outcome: derived, ageMs, vantage: doc.vantage, ...(run ? { run } : {}) });
  }
  return { byHost, rejected, error: null, liveness, ...(run ? { run } : {}) };
}

export function loadEvidence(path = evidencePath(), opts = {}) {
  if (!path) return { byHost: new Map(), rejected: [], error: null, absent: true };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    // Fail closed: only ENOENT is absence.
    if (e.code === 'ENOENT') return { byHost: new Map(), rejected: [], error: null, absent: true };
    return { byHost: new Map(), rejected: [], error: `evidence unreadable: ${e.message}`, absent: false };
  }
  return { ...parseEvidence(text, opts), absent: false };
}

/** The verdict an off-box record supports, or null to leave the row untouched. Only EDGE_AUTH
 *  promotes; UNPROTECTED demotes; UNREACHABLE/UNVERIFIABLE change nothing. */
export function verdictFor(record) {
  if (!record) return null;
  // KEYED ON THE OUTCOME, NOT THE VERDICT NAME. The old form hardcoded EDGE_AUTH -> attested and
  // UNPROTECTED -> demoted, which is the `protected` row of the table and only that row. Under
  // `unreachable`, EDGE_AUTH is a FAILURE — the host answered at all — and the old code would have
  // promoted it. Under `available-and-protected`, an UNREACHABLE panel is a failure and the old code
  // returned null, which is how a 5.5-hour outage stays invisible.
  const outcome = record.outcome ?? outcomeOf(record.kind ?? LEGACY_KIND, record.verdict);
  const kind = record.kind ?? LEGACY_KIND;
  const detail = record.why || 'no detail given';
  if (outcome === 'pass') return { attested: true, why: `off-box probe from ${record.vantage} confirmed the '${kind}' expectation: ${detail}` };
  if (outcome === 'fail') return { attested: false, why: `off-box probe from ${record.vantage} contradicted the '${kind}' expectation: ${detail}` };
  return null;
}
