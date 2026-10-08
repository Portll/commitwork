// parseNpm used to degrade npm's `fixAvailable: true` (a fix exists, version unnamed) to the literal
// string 'available' — useless for ~88% of dep issues, which is the one directly-actionable datum.
// fixFromRange derives the patched floor from the vulnerable range's upper bound for the unambiguous
// single-boundary case, and stays empty (caller → 'available') for anything it cannot name safely.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// From the pure module, NOT from rollup.mjs. Importing rollup runs its pipeline and exits the
// process when no sweep batch exists, so this file used to pass only on a machine whose `reports/`
// was already populated and failed in every clean checkout — CI included. Redirecting
// CW_MONITOR_OUT made the run harmless, not hermetic: it still needed input nothing creates.
import { fixFromRange, remediationForFix } from '../fix-range.mjs';

describe('fixFromRange — a real target from the vulnerable range, never a bare "available"', () => {
  test("'<X' yields X, the first patched version (the dominant real case)", () => {
    assert.equal(fixFromRange('<7.26.10'), '7.26.10');
    assert.equal(fixFromRange('<v2.0.0'), '2.0.0');
    assert.equal(fixFromRange('< 1.2.3'), '1.2.3');
  });
  test("'<=X' yields >X — honest that the fix is above X, exact version unknown", () => {
    assert.equal(fixFromRange('<=7.29.0'), '>7.29.0');
  });
  test('ambiguous ranges stay empty so the caller keeps the honest "available"', () => {
    assert.equal(fixFromRange('1.9.1 - 1.10.1'), '');                    // hyphen form, no <-bound
    assert.equal(fixFromRange('>=1.0.0 <1.2.3 || >=2.0.0 <2.1.0'), '');  // two upper bounds — over-upgrade risk
    assert.equal(fixFromRange('>=1.0.0'), '');                           // no upper bound at all
    assert.equal(fixFromRange(''), '');
  });
  test('non-string input (the raw boolean fixAvailable) is empty, never a crash', () => {
    assert.equal(fixFromRange(true), '');
    assert.equal(fixFromRange(undefined), '');
    assert.equal(fixFromRange(null), '');
  });
});

// The honest fallback was being rendered dishonestly. `fixFromRange` correctly leaves 'available'
// when it cannot name a version, and the caller interpolated it into `fix available: ${fixed}` —
// so 110 of 1,938 live issues read "fix available: available", which reads as a tool that does not
// know what it is saying. The value was right; only the sentence was wrong.
describe('remediationForFix — the unnamed-version case gets a sentence, not a stutter', () => {
  test('a real version is named directly', () => {
    assert.equal(remediationForFix('4.17.21'), 'fix available: 4.17.21');
    assert.equal(remediationForFix('>7.29.0'), 'fix available: >7.29.0');
  });
  test("the honest 'available' fallback never renders as 'fix available: available'", () => {
    const r = remediationForFix('available');
    assert.doesNotMatch(r, /fix available: available/);
    assert.match(r, /a fix is available/);
    assert.match(r, /does not name the fixed version/,
      'it must say WHY no version is given, or the reader cannot tell a missing datum from a missing fix');
  });
  test('no fix is null, never a sentence claiming one', () => {
    for (const v of [null, undefined, '', 0, false]) assert.equal(remediationForFix(v), null);
  });
  test("the two states are DISTINGUISHABLE — a fix with an unknown version is not a fix with no version", () => {
    assert.notEqual(remediationForFix('available'), remediationForFix(null));
    assert.notEqual(remediationForFix('available'), remediationForFix('1.0.0'));
  });
});
