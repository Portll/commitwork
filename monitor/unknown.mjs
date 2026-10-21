// unknown.mjs — ONE predicate for "this is not a result", and a closed vocabulary of reasons.
//
// THE DEFECT THIS EXISTS TO CLOSE. This project applies "absence of evidence is its own state"
// correctly at every individual site, and instantiated it FIFTEEN separate times: nosrc, noscan,
// norules, neverran, toolfailed, unparseable, undetermined, unstated, not-recorded, not-produced,
// unadjudicated, unproven, unexaminable, no-reference-list, detailUnreadable. Eight of those were
// added in a single day, by one session, each locally correct.
//
// fact: the pattern recurred but the FUNCTION did not — G7, verdict recorded and unqueryable: every unknown is recorded, none is queryable together, so "how much of what we published is unknown?" had no answer (expiry: never, prev: not built)
// fact: C4, unstable identity — `undetermined`, `unadjudicated`, `unproven` and `not-produced` are ONE state (a judgement not made) under four keys, so it cannot be counted once or tracked across lanes (expiry: never, prev: duplicated)
// fact: M5, unmeasurable by construction — the fleet's unknown-rate is unmeasurable not because the data is missing but because the SHAPE is not shared (expiry: never, prev: not built)
//
// THE RULE, which is the whole design: a state is unknown or it is not — that is ONE boolean, shared.
// The lane names its REASON, and reasons come from a closed set. A lane inventing a fifteenth
// adjective for "unknown" is the defect; a lane needing a sixteenth REASON is ordinary and adds one
// line here.
//
// ADDITIVE BY CONSTRUCTION. `noscan` appears in 41 files and `unparseable` in 79. Removing them
// would be a larger break than the fragmentation it cures, so producers set `unknown`/`unknownReason`
// ALONGSIDE their existing flag. The aggregate question becomes answerable immediately; the per-lane
// words retire later, under a test, when someone can prove no consumer reads them.

/**
 * The closed reason set, grouped by WHAT was missing. The grouping is not cosmetic: a reader
 * triaging an unknown needs to know whether to re-run something, fix a credential, or accept that
 * no tool can answer.
 */
export const UNKNOWN_REASONS = Object.freeze({
  // ── the artifact ──────────────────────────────────────────────────────────────────────────────
  absent: 'the check wrote no artifact at all — distinguish from a check that wrote an empty one',
  empty: 'the artifact exists and is empty — which is also what a run killed on its first syscall leaves',
  unparseable: 'the artifact exists and does not parse — treat as corrupt, never as zero findings',
  truncated: 'the artifact is incomplete, so its contents are a floor rather than a set',

  // ── the run ───────────────────────────────────────────────────────────────────────────────────
  'not-run': 'the check never executed — re-run it before reading anything into the silence',
  'no-subject': 'nothing to scan — the ecosystem, surface or manifest this check needs is absent',
  'tool-failed': 'the tool executed and failed; fix the tool, do not read its exit as a verdict',
  'no-rules': 'the tool ran with zero rules loaded, so a clean result proves nothing at all',

  // ── the judgement ─────────────────────────────────────────────────────────────────────────────
  'not-adjudicated': 'the analyser ran and declined to determine this one',
  'subject-mismatch': 'the evidence describes a different artifact than the one installed — matched by name, so the verdict is real about something else',
  'not-produced': 'the analyser was asked for this and produced no output',
  'not-recorded': 'nobody recorded it at the time, and it cannot be reconstructed after the fact',
  'no-reference': 'compared against nothing — no baseline, checksum list or sibling exists',
  'not-permitted': 'the credential or API withheld the evidence the check reads',
  'unexaminable': 'only one sample, so there is nothing to compare it against',
  'unstated': 'the subject answered and could not state the thing asked of it',
});

export const UNKNOWN_REASON_KEYS = Object.freeze(Object.keys(UNKNOWN_REASONS));

/** THE predicate. One question, one answer, every lane. */
export const isUnknown = (x) => !!(x && x.unknown === true);

/**
 * Build an unknown state. `reason` MUST be in the closed set — an unrecognised reason throws rather
 * than passing through, for the same reason CLASS_FOR_CATEGORY throws: a silent default is how a
 * vocabulary fragments in the first place, and this module exists because it did.
 */
export function unknown(reason, detail) {
  if (!Object.prototype.hasOwnProperty.call(UNKNOWN_REASONS, reason)) {
    throw new Error(
      `unknown(): '${reason}' is not a declared reason. Add it to UNKNOWN_REASONS in monitor/unknown.mjs `
      + `with a sentence saying what a reader should DO about it — do not coin a new adjective at the `
      + `call site. Declared: ${UNKNOWN_REASON_KEYS.join(', ')}`,
    );
  }
  return { unknown: true, unknownReason: reason, ...(detail ? { unknownDetail: String(detail).slice(0, 400) } : {}) };
}

/**
 * The fifteen words that already exist, mapped to the reason each MEANT.
 *
 * Kept so the aggregate is answerable over artifacts written before this module, and so a producer
 * can be migrated by adding one spread rather than by rewriting its states. This map is the
 * correspondence that was missing; the test beside it asserts every legacy key resolves.
 */
export const LEGACY_STATE_TO_REASON = Object.freeze({
  nosrc: 'no-subject',
  noscan: 'not-run',
  norules: 'no-rules',
  neverran: 'not-run',
  toolfailed: 'tool-failed',
  unparseable: 'unparseable',
  undetermined: 'not-adjudicated',
  unadjudicated: 'not-adjudicated',
  unproven: 'not-adjudicated',
  'not-produced': 'not-produced',
  'not-recorded': 'not-recorded',
  unstated: 'unstated',
  unexaminable: 'unexaminable',
  'no-reference-list': 'no-reference',
  detailUnreadable: 'unparseable',
});

/**
 * Read an unknown out of a value that may predate this module.
 *
 * Returns the reason, or null when the value is a genuine result. Consumers that need to ask "is
 * any of this unknown?" across mixed-vintage artifacts use this rather than testing fifteen fields.
 */
/**
 * The fields whose VALUE is a lane's own determination about its subject.
 *
 * fact: the vocabulary is DECLARED, never "any value that happens to match a legacy word" / `_toolProvenance` returns `{ provenance: 'not-recorded' }` for every category whose tool-version stamp is missing, so an any-value scan marked a lane that had scanned cleanly and found two HIGHs as `unknown: not-recorded` (expiry: never, prev: wrong)
 * fact: that is a fabricated grey over a real result — the over-reporting direction, which cost this fleet 1,311 false CRITICALs the last time it went unwatched (expiry: never, prev: wrong)
 * fact: `provenance` describes the TOOL STAMP, never the finding, and is deliberately absent from this set (expiry: never, prev: wrong)
 *
 * The set is narrow on purpose. A new field carrying a determination and not listed here fails
 * SHORT — an unknown read as a result — which is recoverable by adding one line. The opposite
 * error publishes a void as a finding, and that is the one a reader can check and we cannot defend.
 */
export const DETERMINATION_FIELDS = Object.freeze([
  'checksumCheck', 'reachabilityState', 'versionState', 'state',
]);

export function unknownReasonOf(x) {
  if (!x || typeof x !== 'object') return null;
  if (x.unknown === true && x.unknownReason) return x.unknownReason;
  // A legacy flag counts only when TRUTHY: `nosrc: false` is a producer saying "not this".
  for (const [legacy, reason] of Object.entries(LEGACY_STATE_TO_REASON)) {
    if (x[legacy] === true) return reason;
  }
  // Value-shaped producers, over DECLARED fields only.
  for (const f of DETERMINATION_FIELDS) {
    const reason = LEGACY_STATE_TO_REASON[x[f]];
    if (reason) return reason;
  }
  return null;
}

/** Convenience for a consumer counting across a set of category blocks. */
export function tallyUnknown(blocks) {
  const byReason = {};
  let unknownCount = 0;
  for (const b of blocks || []) {
    const r = unknownReasonOf(b);
    if (!r) continue;
    unknownCount += 1;
    byReason[r] = (byReason[r] || 0) + 1;
  }
  return { unknown: unknownCount, total: (blocks || []).length, byReason };
}
