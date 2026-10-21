// monitor/set-difference.mjs — the set-difference / peer-asymmetry engine.
//
// WHERE THIS COMES FROM. admin/test/route-auth.test.mjs does one concrete thing: it derives the SET
// of modular route paths from the routes directory (a generated-ish artifact, not a hand list) and
// asserts a DECLARED property of each member — "is under /api/, therefore behind the login gate".
// The value is that a 65th route is judged by WHERE dispatch sits, not by whether its author
// remembered. This module generalizes that shape: given a set derived from a generated artifact and
// a declared property, publish the COMPLEMENT — the members that lack the property their peers have.
//
// THE FINDING IT PUBLISHES is "member X is the only one of N without <property> its N-1 peers have."
// That is a PLACE TO LOOK, denominated, and near-unfabricatable: the denominator and the peer set
// are both derived, so the claim carries its own evidence. It is NEVER "this is a vulnerability" —
// the engine cannot know necessity, only asymmetry, and it says which.
//
// THE THREE WAYS THIS LIES, each guarded here:
//   1. EMPTY-SET FLOOR (the import-guard trap). A derivation that silently returns nothing yields an
//      empty complement that reads as "no gaps" = false clean. An extractor with no independent
//      reason it HAD to be right has no way to notice when it stops being right. So the set's
//      cardinality needs a SECOND WITNESS; empty or implausible-vs-witness ⇒ unknown, never clean.
//   2. unsupported finding via name-matching. The property is DECLARED by the caller's predicate, never
//      pattern-matched from source here — name-matching floods false minorities and publishes a
//      void as a finding, the one direction a reader can check and we cannot defend.
//   3. MINORITY ≠ DEFECT. Where the property's necessity is not established the complement is a
//      tier-2 place-to-look, not a defect. And a lane whose complement is ~100% of every set, or a
//      constant ~1 across every set, is a DEFECT SIGNATURE of its own predicate — not a fleet in
//      crisis. defectSignature() exposes that guard.
//
// Identity is PLACE (repo/file/rule/package), never a line: a member that only moved lines is the
// SAME member, so members collapse by key before anything is counted. Pure, no I/O, deterministic.

import { unknown } from './unknown.mjs';

const SATURATION = 0.9;            // complement ≥ 90% of a set ⇒ the predicate matches almost nothing
const MIN_SET_FOR_SATURATION = 3; // below this, "~100%" is noise, not a signature

const defaultKey = (m) =>
  (m && typeof m === 'object')
    ? String(m.key ?? m.place ?? m.id ?? m.name ?? m.path ?? JSON.stringify(m))
    : String(m);

const q = (s) => `'${s}'`;
const pct = (f) => `${(f * 100).toFixed(1)}%`;
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const normaliseOracle = (o) => (o === true || o === 'declared' ? 'declared' : 'inferred');

/**
 * The complement of a declared property over a derived set.
 *
 * @param {object} spec
 * @param {Array}    spec.members      the set, derived from a GENERATED artifact by the caller
 * @param {Function} spec.hasProperty  (member) => boolean; a DECLARED check, not a source grep
 * @param {string}   [spec.label]      what the property IS, e.g. 'call requireSession'
 * @param {('declared'|'inferred'|boolean)} [spec.oracle]  'declared' (necessity established) ⇒ tier 1
 *                                       eligible; anything else ⇒ tier 2 (asymmetry, not defect)
 * @param {number|object|Function} [spec.witness]  the SECOND WITNESS on set cardinality — an
 *                                       independent expectation. number ⇒ floor (at least this many);
 *                                       {min,max} ⇒ range; {atLeast} ⇒ floor; function ⇒ an
 *                                       independent recount that must EQUAL the derived cardinality
 *                                       (the cross-check that gave the import guard its floor).
 * @param {number}   [spec.minPlausible] a set smaller than this is implausible even with no witness
 * @param {Function} [spec.key]        (member) => place-key; identity EXCLUDES line, by construction
 *
 * @returns a result `{ label, oracle, tier, denominator, set, complement, ... }`, OR an `unknown`
 *   (spread from monitor/unknown.mjs, `tier: null`) when the floor trips. Never a clean/empty pass.
 */
export function setDifference({
  members, hasProperty, label = 'the property',
  oracle = 'inferred', witness = null, minPlausible = 1, key = defaultKey,
} = {}) {
  const ora = normaliseOracle(oracle);
  // fail closed: a non-array derivation is unreadable, never an empty (clean) set
  if (!Array.isArray(members)) {
    return unknownResult('unparseable',
      `members must be an array derived from a generated artifact, got ${typeof members}`,
      { label, oracle: ora, denominator: 0, set: [], complement: [] });
  }
  if (typeof hasProperty !== 'function') {
    throw new Error('setDifference: hasProperty must be a predicate function over each member');
  }

  // Collapse to PLACES first: identity excludes line, so a member that merely moved is not new.
  const places = new Map();
  for (const m of members) {
    const k = String(key(m));
    if (!places.has(k)) places.set(k, m);
  }
  const denominator = places.size;

  // EMPTY-SET FLOOR — second witness required for plausibility; empty/implausible ⇒ unknown.
  const floor = checkFloor(denominator, witness, minPlausible, members.length);
  if (floor.tripped) {
    return unknownResult(floor.reason, floor.detail,
      { label, oracle: ora, denominator, set: [], complement: [], witness: floor.witness });
  }

  // Classify each place. A predicate that THROWS is unreadable — fail closed: it is neither a pass
  // (would hide a gap) nor a complement member (would fabricate a finding). It becomes undetermined.
  const set = [];
  const complement = [];
  const undetermined = [];
  for (const [k, m] of places) {
    let has;
    try { has = !!hasProperty(m); }
    catch (e) { undetermined.push({ key: k, error: String((e && e.message) || e).slice(0, 200) }); continue; }
    set.push({ key: k, has });
    if (!has) complement.push({ key: k });
  }
  set.sort(byKey);
  complement.sort(byKey);

  const complementFraction = denominator ? complement.length / denominator : 0;
  // Single-set defect signature: a complement that is ~100% of the set means the predicate matches
  // almost nothing — explicit uncertainty, so this is the check misfiring, not N real findings.
  const saturated = denominator >= MIN_SET_FOR_SATURATION && complementFraction >= SATURATION;

  // tier 1 (ground truth) requires BOTH a trusted-declared property AND a passing second witness:
  // without a cardinality floor the set has "no reason it HAD to be right". An unreadable member or
  // a saturated complement caps it back to tier 2.
  const witnessed = witness != null;
  let tier = (ora === 'declared' && witnessed && !saturated && undetermined.length === 0) ? 1 : 2;

  return {
    label,
    oracle: ora,
    necessity: ora === 'declared' ? 'declared' : 'observed',
    tier,
    denominator,
    set,
    complement,
    complementFraction,
    undetermined,
    witnessed,
    witness: floor.witness,
    plausibility: witnessed ? 'certified' : 'uncertified',
    saturated,
    defect: saturated ? 'saturated' : null,
    // A place to look is publishable at tier 2; a verdict is not published here at all. Saturated or
    // fully-clean or wholly-unreadable ⇒ nothing to point a reader at.
    publishAsFinding: !saturated && complement.length > 0,
    unknown: false,
  };
}

// The floor. Returns { tripped, reason, detail, witness } — the witness summary travels either way
// so a reader of an unknown sees what expectation it failed.
function checkFloor(denominator, witness, minPlausible, rawCount) {
  const w = summariseWitness(witness);
  if (denominator === 0) {
    return { tripped: true, reason: 'no-subject', witness: w,
      detail: 'the derived set is empty — a complement over nothing reads as "no gaps"; that is a false clean, not a result' };
  }
  if (denominator < minPlausible) {
    return { tripped: true, reason: 'unexaminable', witness: w,
      detail: `the derived set has ${denominator} member(s), below the plausibility floor of ${minPlausible}` };
  }
  if (witness == null) return { tripped: false, witness: w };

  // number ⇒ floor; {min,max}/{atLeast} ⇒ range; function ⇒ an independent recount that must agree.
  if (typeof witness === 'number') {
    if (denominator < witness) {
      return { tripped: true, reason: 'unexaminable', witness: w,
        detail: `derivation found ${denominator} member(s); the second witness expected at least ${witness} — the derivation likely returned too few` };
    }
  } else if (typeof witness === 'function') {
    let n;
    try { n = witness(rawCount); } catch (e) {
      return { tripped: true, reason: 'unexaminable', witness: w,
        detail: `the second-witness recount threw (${String((e && e.message) || e).slice(0, 120)}) — cardinality uncertified` };
    }
    if (!Number.isFinite(n) || n !== denominator) {
      return { tripped: true, reason: 'unexaminable', witness: w,
        detail: `two derivations disagree on the set size: this pass found ${denominator}, the independent witness found ${n} — one of them is wrong and neither can be trusted` };
    }
  } else if (witness && typeof witness === 'object') {
    const min = witness.min ?? witness.atLeast ?? null;
    const max = witness.max ?? null;
    if (min != null && denominator < min) {
      return { tripped: true, reason: 'unexaminable', witness: w,
        detail: `derivation found ${denominator}; witness expected at least ${min}` };
    }
    if (max != null && denominator > max) {
      return { tripped: true, reason: 'unexaminable', witness: w,
        detail: `derivation found ${denominator}; witness expected at most ${max} — an over-derivation is as suspect as an under-one` };
    }
  }
  return { tripped: false, witness: w };
}

function summariseWitness(witness) {
  if (witness == null) return null;
  if (typeof witness === 'number') return { kind: 'floor', atLeast: witness };
  if (typeof witness === 'function') return { kind: 'recount' };
  if (witness && typeof witness === 'object') return { kind: 'range', min: witness.min ?? witness.atLeast ?? null, max: witness.max ?? null };
  return null;
}

function unknownResult(reason, detail, extra = {}) {
  // Spread unknown() so isUnknown() and the closed reason vocabulary apply; preserve the partial set.
  return { ...unknown(reason, detail), tier: null, publishAsFinding: false, unknown: true, ...extra };
}

/**
 * The one-line rendering. Always denominated; the word "vulnerability" never appears, and neither
 * does "clean" — an empty complement is "all N share it", which for tier 2 is "nothing stands out".
 */
export function render(r) {
  if (r.unknown) {
    return `undetermined (${r.unknownReason})${r.unknownDetail ? ` — ${r.unknownDetail}` : ''}: NOT clean, NOT a finding`;
  }
  const n = r.denominator;
  if (r.saturated) {
    return `${r.complement.length} of ${n} lack ${q(r.label)} — a ${pct(r.complementFraction)} complement is a DEFECT SIGNATURE of the check itself, not a finding about the fleet`;
  }
  if (r.complement.length === 0) {
    return r.tier === 1
      ? `all ${n} members satisfy the declared invariant ${q(r.label)}`
      : `all ${n} members share ${q(r.label)} — tier 2: necessity not established, so this is "nothing stands out", not "clean"`;
  }
  const c = r.complement.length;
  const peers = n - c;
  const lead = c === 1
    ? `${r.complement[0].key} is the only one of ${n} without ${q(r.label)} its ${peers} peers have`
    : `${c} of ${n} lack ${q(r.label)} the other ${peers} have`;
  return `${lead} — tier ${r.tier}, a place to look, not a verdict`;
}

/**
 * The cross-set defect-signature guard: run over a COLLECTION of setDifference results (e.g. the
 * same invariant across a fleet). Fires when the lane's own predicate is the problem:
 *   - 'saturated'         — the complement is ~100% in ~every set (the predicate matches ~nothing)
 *   - 'constant-minority' — the complement is exactly 1 in ~every set regardless of denominator (a
 *                           systematic single non-matcher, not N independent gaps)
 * This is a signal for a human, never an auto-verdict. It does the thing the house rule names: a
 * lane that fails a control on ~100% of members, or flags ~1 of every set, is measured and called a
 * defect signature rather than read as a fleet in crisis.
 */
export function defectSignature(results, { saturation = SATURATION, minSets = 3, prevalence = 0.8 } = {}) {
  const usable = (results || []).filter(
    (r) => r && r.unknown !== true && Number.isFinite(r.denominator) && r.denominator > 0 && Array.isArray(r.complement));
  if (usable.length < minSets) {
    return { fires: false, kind: null, reason: 'too-few-sets', sets: usable.length };
  }
  const fracOf = (r) => (Number.isFinite(r.complementFraction) ? r.complementFraction : r.complement.length / r.denominator);
  const satSets = usable.filter((r) => fracOf(r) >= saturation);
  const oneSets = usable.filter((r) => r.complement.length === 1);
  const satFrac = satSets.length / usable.length;
  const oneFrac = oneSets.length / usable.length;

  if (satFrac >= prevalence) {
    return { fires: true, kind: 'saturated', prevalence: satFrac, sets: usable.length,
      detail: `the complement is ~100% in ${satSets.length}/${usable.length} sets — the property check matches almost nothing; this is the predicate, not the fleet` };
  }
  if (oneFrac >= prevalence) {
    return { fires: true, kind: 'constant-minority', prevalence: oneFrac, sets: usable.length,
      detail: `the complement is exactly 1 in ${oneSets.length}/${usable.length} sets regardless of denominator — a systematic single non-matcher, not ${usable.length} independent gaps` };
  }
  return { fires: false, kind: null, prevalence: Math.max(satFrac, oneFrac), sets: usable.length };
}

// ── commitwork.json invariants[] — SHAPE ONLY, execution deliberately not wired ─────────────────
//
// A repo-local invariant declares one add-only check: over a SET, every member MUST have a property.
//   { set: 'handlers under /api/', must: 'call requireSession' }
// It resolves to a setDifference() call with oracle:'declared' — the repo asserts the property's
// NECESSITY, which is what tier 1 needs. Two contracts govern it, both enforced by validateInvariant:
//
//   ADD-ONLY. A repo-local invariant may only ADD a required property. It may NOT exempt a member,
//   narrow the set, waive a finding, or invert a `must` into a prohibition — those would let a
//   repo quietly shrink a fleet-wide check from inside the repo it checks. Enforced by WHITELIST:
//   any key that is not a known-additive field is refused, because the safe default for an
//   untrusted channel is to refuse the unrecognised, not to wave it through.
//
//   UNTRUSTED BY DEFAULT. Reusing the --trust-repo-manifest precedent (bin/commitwork.mjs
//   assertManifestTrusted): a repo-local invariant is arbitrary input, so even a VALID one does not
//   EXECUTE without --trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1). validateInvariant
//   validates the SHAPE and reports requiresTrust:true; it never runs anything.

export const INVARIANT_ALLOWED_KEYS = Object.freeze(['set', 'must', 'label', 'id', 'why', 'severity', 'tier']);
export const INVARIANT_EXAMPLE = Object.freeze({ set: 'handlers under /api/', must: 'call requireSession' });

// A `must` whose text reads as an exemption rather than a positive requirement. `must: 'call X'`
// passes; `must: 'not call X'` / `'be exempt from auth'` / `'skip the gate'` are refused — a
// positive-shaped field is the obvious place to smuggle a narrowing.
const NEGATED_MUST = /^(?:do\s?n['o]?t|not|never)\b|\b(?:exempt|except|skip|waive|suppress|ignore|bypass)\b/i;

/**
 * Validate a repo-local invariant's SHAPE. Refuses any narrowing/exempting invariant. Never executes.
 *
 * @returns {{ ok, errors, invariant, addOnly, requiresTrust, trustFlag }}
 */
export function validateInvariant(inv) {
  const errors = [];
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) {
    return {
      ok: false, errors: ['an invariant must be an object of the shape { set, must }'],
      invariant: null, addOnly: true, requiresTrust: true,
      trustFlag: '--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)',
    };
  }
  // Whitelist: an unrecognised key in an untrusted add-only channel is a narrowing vector by default.
  for (const k of Object.keys(inv)) {
    if (!INVARIANT_ALLOWED_KEYS.includes(k)) {
      errors.push(`unknown key ${JSON.stringify(k)} — a repo-local invariant is ADD-ONLY and may carry only { ${INVARIANT_ALLOWED_KEYS.join(', ')} }. Exempting/narrowing keys (exempt, except, only, skip, mustNot, override, disable, …) are refused so a repo cannot shrink a fleet check from inside itself.`);
    }
  }
  if (typeof inv.set !== 'string' || !inv.set.trim()) {
    errors.push('`set` must be a non-empty string selecting the population (e.g. "handlers under /api/")');
  }
  if (typeof inv.must !== 'string' || !inv.must.trim()) {
    errors.push('`must` must be a non-empty string naming the REQUIRED property — an invariant with no `must` adds nothing and can only be present to narrow, so it is refused');
  } else if (NEGATED_MUST.test(inv.must.trim())) {
    errors.push(`\`must\` reads as an exemption (${JSON.stringify(inv.must)}); an ADD-ONLY invariant states a POSITIVE requirement, never a prohibition that removes members from a check`);
  }

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    invariant: ok
      ? { set: inv.set.trim(), must: inv.must.trim(), label: (inv.label && String(inv.label)) || `${inv.set.trim()} — every member must ${inv.must.trim()}`, id: inv.id ?? null }
      : null,
    addOnly: true,
    // Even a valid invariant does not run without explicit trust — the --trust-repo-manifest precedent.
    requiresTrust: true,
    trustFlag: '--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)',
  };
}
