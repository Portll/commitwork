// node --test monitor/test/ — set-difference.mjs: the peer-asymmetry engine. It generalizes
// admin/test/route-auth.test.mjs (derive a set, assert each member's declared property, publish the
// complement). The subjects here are the three ways it could lie: an empty derived set reading as
// "no gaps" (the import-guard floor), a name-matched property flooding a false minority (unsupported finding),
// and a predicate whose own ~100%/~1 misfire is a defect signature, not a fleet in crisis.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setDifference, render, defectSignature, validateInvariant, INVARIANT_EXAMPLE } from '../set-difference.mjs';
import { isUnknown } from '../unknown.mjs';

// The route-auth shape: handlers, most declaring the property, one not.
const handlers = [
  { key: 'admin/routes/report.mjs#states', auth: true },
  { key: 'admin/routes/report.mjs#evidence', auth: true },
  { key: 'admin/routes/posture.mjs#get', auth: true },
  { key: 'admin/routes/a11y.mjs#get', auth: false }, // the odd one out
];
const hasAuth = (h) => h.auth === true;

// N members where the first `missing` lack the property.
function buildSet(n, missing, tag = 'r') {
  const members = [];
  for (let i = 0; i < n; i++) members.push({ key: `${tag}/h${i}`, auth: i >= missing });
  return members;
}

describe('complement correctness + denominator', () => {
  test('the complement is exactly the members lacking the property, and denominator is the set size', () => {
    const r = setDifference({ members: handlers, hasProperty: hasAuth, label: 'call requireSession', oracle: 'declared', witness: 4 });
    assert.equal(r.unknown, false);
    assert.equal(r.denominator, 4);
    assert.equal(r.complement.length, 1);
    assert.equal(r.complement[0].key, 'admin/routes/a11y.mjs#get');
    assert.equal(r.set.length, 4);
    assert.equal(r.complementFraction, 0.25);
    assert.equal(r.publishAsFinding, true, 'a tier-with-a-real-complement is a place to look');
  });

  test('an all-satisfying set has an empty complement and is NOT rendered as "clean"', () => {
    const r = setDifference({ members: buildSet(6, 0), hasProperty: hasAuth, label: 'call requireSession', oracle: 'declared', witness: 6 });
    assert.equal(r.complement.length, 0);
    assert.equal(r.publishAsFinding, false);
    assert.doesNotMatch(render(r), /\bclean\b/i, 'explicit uncertainty: never the word clean');
  });

  test('output is deterministic — complement sorted by place-key', () => {
    const shuffled = [handlers[3], handlers[0], handlers[2], handlers[1]];
    const a = setDifference({ members: handlers, hasProperty: hasAuth, oracle: 'declared', witness: 4 });
    const b = setDifference({ members: shuffled, hasProperty: hasAuth, oracle: 'declared', witness: 4 });
    assert.deepEqual(a.complement, b.complement);
    assert.deepEqual(a.set, b.set);
  });
});

describe('the EMPTY-SET FLOOR — a derivation that returns nothing is unknown, never clean', () => {
  test('an empty set yields an unknown (no-subject), not an empty complement that reads as "no gaps"', () => {
    const r = setDifference({ members: [], hasProperty: hasAuth, label: 'call requireSession' });
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'no-subject');
    assert.equal(r.tier, null);
    assert.equal(r.publishAsFinding, false);
    assert.match(render(r), /NOT clean, NOT a finding/, 'an empty derivation renders as explicitly-not-clean, never as a pass');
  });

  test('a set implausibly smaller than its second witness is unknown — the derivation likely returned too few', () => {
    // members derived 4, but an independent expectation says at least 20 handlers exist.
    const r = setDifference({ members: handlers, hasProperty: hasAuth, oracle: 'declared', witness: 20 });
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unexaminable');
    assert.match(r.unknownDetail, /too few|expected at least/);
  });

  test('two derivations that disagree on the set size are unknown — neither witness can be trusted', () => {
    // a function witness is an INDEPENDENT recount; here it sees 9 where the primary derived 4.
    const r = setDifference({ members: handlers, hasProperty: hasAuth, oracle: 'declared', witness: () => 9 });
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unexaminable');
    assert.match(r.unknownDetail, /disagree/);
  });

  test('a function witness that AGREES with the derived cardinality passes the floor', () => {
    const r = setDifference({ members: handlers, hasProperty: hasAuth, oracle: 'declared', witness: () => 4 });
    assert.equal(r.unknown, false);
    assert.equal(r.tier, 1);
  });

  test('a non-array derivation fails closed to unknown(unparseable), not to an empty set', () => {
    const r = setDifference({ members: null, hasProperty: hasAuth });
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unparseable');
  });
});

describe('ORACLE TIER — declared property ⇒ tier 1, inferred ⇒ tier 2', () => {
  test('a trusted-DECLARED property with a passing witness is tier 1 (ground truth)', () => {
    const r = setDifference({ members: handlers, hasProperty: hasAuth, oracle: 'declared', witness: 4 });
    assert.equal(r.tier, 1);
    assert.equal(r.necessity, 'declared');
  });

  test('the SAME set with an inferred property is tier 2 — minority != defect where necessity is unestablished', () => {
    const r = setDifference({ members: handlers, hasProperty: hasAuth, oracle: 'inferred', witness: 4 });
    assert.equal(r.tier, 2);
    assert.equal(r.necessity, 'observed');
    // the set and complement are preserved regardless of tier — a place to look, denominated
    assert.equal(r.complement.length, 1);
  });

  test('a declared property with NO second witness cannot reach tier 1 — no cardinality floor, no ground truth', () => {
    const r = setDifference({ members: handlers, hasProperty: hasAuth, oracle: 'declared' });
    assert.equal(r.tier, 2);
    assert.equal(r.plausibility, 'uncertified');
    assert.equal(r.complement.length, 1, 'still a place to look, just not certified ground truth');
  });
});

describe('MINORITY != DEFECT — the ~100% / ~1 defect-signature guard', () => {
  test('a single set whose complement is ~100% is marked a defect signature, NOT published as findings', () => {
    const r = setDifference({ members: buildSet(5, 5), hasProperty: hasAuth, oracle: 'declared', witness: 5 });
    assert.equal(r.saturated, true);
    assert.equal(r.defect, 'saturated');
    assert.equal(r.publishAsFinding, false, 'explicit uncertainty: ~100% is the check misfiring, not 5 real findings');
    assert.equal(r.tier, 2, 'a saturated complement cannot be tier-1 ground truth');
    assert.match(render(r), /DEFECT SIGNATURE/);
    assert.doesNotMatch(render(r), /vulnerab/i);
  });

  test('cross-set: a complement that is ~100% of every set fires the guard as "saturated"', () => {
    const results = [buildSet(5, 5), buildSet(6, 6), buildSet(4, 4)].map(
      (m, i) => setDifference({ members: m, hasProperty: hasAuth, oracle: 'declared', witness: m.length, key: (h) => `s${i}/${h.key}` }));
    const sig = defectSignature(results);
    assert.equal(sig.fires, true);
    assert.equal(sig.kind, 'saturated');
  });

  test('cross-set: a complement of exactly 1 in every set (regardless of N) fires as "constant-minority"', () => {
    const results = [buildSet(5, 1), buildSet(8, 1), buildSet(12, 1), buildSet(20, 1)].map(
      (m, i) => setDifference({ members: m, hasProperty: hasAuth, oracle: 'declared', witness: m.length, key: (h) => `s${i}/${h.key}` }));
    const sig = defectSignature(results);
    assert.equal(sig.fires, true);
    assert.equal(sig.kind, 'constant-minority');
    assert.match(sig.detail, /systematic single non-matcher/);
  });

  test('a genuine scatter of small complements does NOT fire the guard', () => {
    const results = [buildSet(10, 0), buildSet(10, 1), buildSet(10, 3), buildSet(10, 0)].map(
      (m, i) => setDifference({ members: m, hasProperty: hasAuth, oracle: 'declared', witness: m.length, key: (h) => `s${i}/${h.key}` }));
    assert.equal(defectSignature(results).fires, false);
  });

  test('too few sets cannot establish a signature', () => {
    const one = setDifference({ members: buildSet(5, 5), hasProperty: hasAuth, oracle: 'declared', witness: 5 });
    assert.equal(defectSignature([one]).fires, false);
  });
});

describe('identity is PLACE, never a line', () => {
  test('two members that differ only in line collapse to ONE — a finding that moved is the same finding', () => {
    const moved = [
      { key: 'admin/serve.mjs#js/request-forgery', line: 523, auth: false },
      { key: 'admin/serve.mjs#js/request-forgery', line: 527, auth: false }, // same place, moved down
      { key: 'admin/serve.mjs#other', auth: true },
    ];
    const r = setDifference({ members: moved, hasProperty: hasAuth, oracle: 'declared', witness: 2 });
    assert.equal(r.denominator, 2, 'the line move is not a new member');
    assert.equal(r.complement.length, 1);
    assert.equal(r.complement[0].key, 'admin/serve.mjs#js/request-forgery');
  });
});

describe('fail closed — a predicate that throws is undetermined, neither a pass nor a fabricated finding', () => {
  test('a throwing predicate parks the member as undetermined and forbids tier 1', () => {
    const hp = (h) => { if (h.key === 'boom') throw new Error('unreadable'); return h.auth === true; };
    const members = [{ key: 'a', auth: true }, { key: 'boom', auth: true }, { key: 'c', auth: false }];
    const r = setDifference({ members, hasProperty: hp, oracle: 'declared', witness: 3 });
    assert.equal(r.denominator, 3);
    assert.equal(r.undetermined.length, 1);
    assert.equal(r.undetermined[0].key, 'boom');
    assert.equal(r.set.length, 2, 'the unreadable member is not counted as a pass');
    assert.equal(r.complement.length, 1, 'nor fabricated into the complement');
    assert.equal(r.tier, 2, 'an unreadable member denies ground truth');
  });
});

describe('validateInvariant — a repo-local invariant is ADD-ONLY and untrusted', () => {
  test('the canonical shape validates and still reports it must not run without trust', () => {
    const v = validateInvariant(INVARIANT_EXAMPLE);
    assert.equal(v.ok, true);
    assert.equal(v.invariant.set, 'handlers under /api/');
    assert.equal(v.invariant.must, 'call requireSession');
    assert.equal(v.requiresTrust, true, 'reusing the --trust-repo-manifest precedent: valid != executable');
    assert.match(v.trustFlag, /trust-repo-manifest/);
  });

  test('a narrowing invariant (an exempt list) is REFUSED', () => {
    const v = validateInvariant({ set: 'handlers under /api/', must: 'call requireSession', exempt: ['a11y'] });
    assert.equal(v.ok, false);
    assert.equal(v.invariant, null);
    assert.match(v.errors.join(' '), /exempt|unknown key|ADD-ONLY/i);
  });

  test('a set-narrowing key (only) is REFUSED', () => {
    const v = validateInvariant({ set: 'handlers', must: 'call requireSession', only: ['report'] });
    assert.equal(v.ok, false);
    assert.match(v.errors.join(' '), /only|unknown key/i);
  });

  test('a `must` inverted into a prohibition is REFUSED — that would exempt, not add', () => {
    const v = validateInvariant({ set: 'handlers', must: 'not call requireSession' });
    assert.equal(v.ok, false);
    assert.match(v.errors.join(' '), /exemption|positive requirement/i);
  });

  test('an invariant with no `must` adds nothing and is REFUSED', () => {
    const v = validateInvariant({ set: 'handlers' });
    assert.equal(v.ok, false);
    assert.match(v.errors.join(' '), /must/);
  });

  test('a non-object is refused without throwing', () => {
    assert.equal(validateInvariant(null).ok, false);
    assert.equal(validateInvariant('handlers must auth').ok, false);
  });
});

describe('render never publishes a verdict', () => {
  test('the complement-of-1 headline names the place and the denominator, never "vulnerability"', () => {
    const r = setDifference({ members: handlers, hasProperty: hasAuth, label: 'call requireSession', oracle: 'declared', witness: 4 });
    const s = render(r);
    assert.match(s, /only one of 4/);
    assert.match(s, /place to look, not a verdict/);
    assert.doesNotMatch(s, /vulnerab/i);
  });
});
