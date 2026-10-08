// Pure decision helpers for bin/gate-ratchet.mjs — split out so the attribution CLAIM the gate
// journals is unit-testable (the gate itself is a Stop hook; importing it runs a measurement).
// The attribution is an explicit, separately-derived object an adjudicator can score.

/**
 * `at` of the earliest record in the unbroken trailing run of 'worse' records matching current
 * metrics AND baseline. Null means fresh — absence of history is never evidence of standing.
 * Suppressed records count: a suppressed turn was still a decision on these numbers.
 */
export function standingSince(records, nowMetrics, baseline, metricKeys) {
  let since = null;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r?.verdict !== 'worse') break;
    const same = metricKeys.every((k) => (r.metrics?.[k] ?? null) === (nowMetrics?.[k] ?? null))
      && metricKeys.every((k) => (r.baseline?.[k] ?? null) === (baseline?.[k] ?? null));
    if (!same) break;
    since = r.at ?? since;
  }
  return since;
}

/**
 * The scoreable claim: whose change does the evidence say this is?
 *   standing — this exact reading predates the turn (the gate's own journal already holds it)
 *   mine     — the touch ledger says only this session touched dirty files carrying drifted anchors
 *   theirs   — only other sessions touched them
 *   mixed    — both did, whether across different files or inside the same one
 *   unknown  — no attributable evidence (no ledger, no session id, or no dirty drifted files)
 * Standing wins over file overlap; one shared file is the strongest evidence of mixed, so it
 * decides before the disjoint case.
 */
export function attributionClaim({ mine = [], theirs = [], shared = [] } = {}, since) {
  if (since) return 'standing';
  if (shared.length) return 'mixed';
  if (mine.length && theirs.length) return 'mixed';
  if (mine.length) return 'mine';
  if (theirs.length) return 'theirs';
  return 'unknown';
}

// The co-author guard is unconditional; the accept-instruction is subordinate to it. Advice keys
// on POSITIVE ownership evidence only — `unknown` is what concurrent sessions produce, and
// answering it with "accept" would bank another session's debt as the permanent floor.
export const COAUTHOR_GUARD = "Do NOT baseline a co-author's break — that banks their half-landed change as the permanent floor and hides their next real one.";
export const ACCEPT_INSTRUCTION = 'If it is yours and deliberate, accept it with `node bin/gate-ratchet.mjs --baseline`.';
// This string is printed to a human on most ratchet alarms, so it is an instruction, not a comment —
// and it was wrong in two ways at once (found by FourEyes, 2026-08-30). It named `.jsonl.1`, which
// R-E removed as a proven subset of `.2`, leaving ~95% of rows in generations the sentence did not
// mention. And "filter on the `f` key" is exactly the evidence-blind read that produced today's
// false attributions: `f` alone says the ledger SAW the path, not that this session wrote it.
// Enumerate the chain rather than naming a generation, and ask for evidence rather than presence.
export const SEPARATE_FIRST = 'Separate yours from theirs before deciding: `git status`, then the touch ledger — enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row\'s `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.';

/**
 * The ONE claim that is positive evidence about THIS session. Nothing else may accept.
 *
 * `standing` does not belong here, though it reads as if it does. It is TEMPORAL — attributionClaim
 * returns it before looking at mine/theirs/shared, and standingSince has no session filter over a
 * journal 90 sessions write — so it means "somebody's reading predates this turn", and it overrode
 * even a correct `theirs`. While it was admitted, 913 of 1,546 records claimed it and 818 of those
 * carried `mine: []`: no evidence, plus an instruction to move the floor.
 */
export const ownsIt = (claim) => claim === 'mine';

/** The guard, then — only on positive ownership — the way out. Never the other order. */
export const advice = (claim) => `${COAUTHOR_GUARD} ${ownsIt(claim) ? ACCEPT_INSTRUCTION : SEPARATE_FIRST}`;

/** Headline for a worse reading, worded to match the claim — words never outrun the evidence. */
export function worseHeadline(claim, worseList, { since = null, theirs = [], emptyReason = null } = {}) {
  const detail = worseList.join('; ');
  const tail = advice(claim);
  switch (claim) {
    case 'standing':
      return `commitwork gate: debt REMAINS above baseline (standing since ${since}, not added this turn) — ${detail}. ${tail}`;
    case 'theirs':
      return `commitwork gate: debt increased since baseline — ${detail}. Attribution: ANOTHER session's uncommitted work (${theirs.slice(0, 3).join(', ')}${theirs.length > 3 ? ` +${theirs.length - 3} more` : ''}). ${tail}`;
    case 'mixed':
      return `commitwork gate: debt increased since baseline — ${detail}. Attribution: MIXED — this session and another both touched files carrying drifted anchors. ${tail}`;
    case 'mine':
      return `commitwork gate: this turn ADDED debt — ${detail}. ${tail}`;
    default:
      // Unknown is not permission. But WHICH unknown matters, and this line asserted the wrong one:
      // "no touch-ledger evidence" is a claim ABOUT the ledger, and it was printed even when the
      // ledger was never read — a git outage produced the identical sentence. A6's false warrant.
      // With emptyReason available (A5) the two are separable, and the honest one is the outage.
      return emptyReason === 'git-unavailable'
        ? `commitwork gate: debt increased since baseline — ${detail}. Attribution UNKNOWN — the touch ledger was NOT READ (git status failed), so nothing was checked. This is "we could not look", NOT "no evidence exists". ${tail}`
        : `commitwork gate: debt increased since baseline — ${detail}. Attribution UNKNOWN — no touch-ledger evidence, which is what a concurrent session's committed change produces, so this is not evidence that it is yours. ${tail}`;
  }
}

// ── A5 · WHY AN ATTRIBUTION IS EMPTY ────────────────────────────────────────────────────────────
// `whoTouched` had THREE returns of one shared `none` object, so an empty result could not say
// which of three very different things had happened:
//
//   'no-drift'        nothing drifted. Legitimately empty; there was nothing to attribute.
//   'no-dirty-match'  things drifted, but no dirty file matches them. Legitimately empty.
//   'git-unavailable' GIT FAILED. Not empty — UNKNOWN, and the drifted paths are exactly the ones
//                     we cannot speak about. Returning the same all-empty shape here made a broken
//                     check indistinguishable from a clean tree, which is an unsupported pass inside the
//                     gate that publishes attribution.
//
// The distinction is not cosmetic: `attributionClaim` reads mine/theirs/shared, and all-empty
// yields the same claim for "nobody touched anything" as for "we could not look".
export const EMPTY_REASONS = new Set(['no-drift', 'no-dirty-match', 'git-unavailable']);

/**
 * An empty attribution that says WHY. `unknown` carries the drifted paths when the reason is an
 * outage, because those are precisely the files whose ownership could not be determined — an outage
 * that reports zero unknowns is claiming to have checked.
 */
export function emptyAttribution(reason, drifted = []) {
  const known = EMPTY_REASONS.has(reason) ? reason : 'no-drift';
  const unknown = known === 'git-unavailable' ? [...drifted] : [];
  return { mine: [], theirs: [], unknown, others: [], shared: [], undetermined: [], emptyReason: known };
}

/** True when an empty attribution reflects an OUTAGE rather than a clean tree. */
export const isOutage = (a) => a?.emptyReason === 'git-unavailable';
