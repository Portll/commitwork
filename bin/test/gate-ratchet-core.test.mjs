// The ratchet's attribution claim, pinned at the defect: standing detection from the gate's own
// journal, the claim lattice, and wording that must not outrun the evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standingSince, attributionClaim, worseHeadline, advice, ownsIt, COAUTHOR_GUARD } from '../gate-ratchet-core.mjs';

const KEYS = ['conflicts', 'unreviewed', 'drifted'];
const M = (drifted) => ({ conflicts: 0, unreviewed: 90, drifted });
const rec = (at, verdict, metrics, baseline) => ({ at, verdict, metrics, baseline });

test('standing: an unbroken trailing run of identical worse readings dates from its EARLIEST record', () => {
  const records = [
    rec('t1', 'steady', M(55), M(55)),
    rec('t2', 'worse', M(61), M(56)),
    rec('t3', 'worse', M(61), M(56)),
    rec('t4', 'worse', M(61), M(56)),
  ];
  assert.equal(standingSince(records, M(61), M(56), KEYS), 't2');
});

test('standing: a metric that MOVED breaks the run — a fresh increase is never softened into standing', () => {
  const records = [rec('t1', 'worse', M(60), M(56)), rec('t2', 'worse', M(61), M(56))];
  // now reads 62: the trailing run at 61 is not this reading
  assert.equal(standingSince(records, M(62), M(56), KEYS), null);
});

test('standing: a moved BASELINE breaks the run — same numbers over a different floor is a different decision', () => {
  const records = [rec('t1', 'worse', M(61), M(55))];
  assert.equal(standingSince(records, M(61), M(56), KEYS), null);
});

test('standing: empty or unreadable history is never evidence of standing', () => {
  assert.equal(standingSince([], M(61), M(56), KEYS), null);
});

test('standing: an interrupting non-worse verdict ends the run', () => {
  const records = [rec('t1', 'worse', M(61), M(56)), rec('t2', 'steady', M(56), M(56)), rec('t3', 'worse', M(61), M(56))];
  assert.equal(standingSince(records, M(61), M(56), KEYS), 't3');
});

test('claim lattice: standing beats file overlap; then mine/theirs/mixed/unknown from the ledger split', () => {
  assert.equal(attributionClaim({ mine: ['a'], theirs: [] }, 't1'), 'standing');
  assert.equal(attributionClaim({ mine: ['a'], theirs: [] }, null), 'mine');
  assert.equal(attributionClaim({ mine: [], theirs: ['b'] }, null), 'theirs');
  assert.equal(attributionClaim({ mine: ['a'], theirs: ['b'] }, null), 'mixed');
  // a file BOTH sessions hold is mixed, not theirs (shared ⊆ theirs)
  assert.equal(attributionClaim({ mine: [], theirs: ['a'], shared: ['a'] }, null), 'mixed');
  assert.equal(attributionClaim({ mine: [], theirs: ['a', 'b'], shared: ['a'] }, null), 'mixed');
  assert.equal(attributionClaim({ mine: [], theirs: ['a'], shared: ['a'] }, 't1'), 'standing', 'standing still outranks it');
  assert.equal(attributionClaim({ mine: [], theirs: [] }, null), 'unknown');
  assert.equal(attributionClaim({}, null), 'unknown');
  assert.equal(attributionClaim(undefined, null), 'unknown');
});

test('wording: "this turn ADDED debt" appears for MINE and for no other claim', () => {
  const worse = ['open findings whose anchor drifted: 56 → 61 (+5)'];
  const added = (c, opts) => /this turn ADDED debt/.test(worseHeadline(c, worse, opts));
  assert.ok(added('mine'));
  for (const [c, opts] of [['standing', { since: 't1' }], ['theirs', { theirs: ['x.mjs'] }], ['mixed', {}], ['unknown', {}]]) {
    assert.ok(!added(c, opts), `claim '${c}' must not accuse the current turn`);
  }
});

test('wording: theirs names the files and forbids baselining someone else\'s break', () => {
  const h = worseHeadline('theirs', ['drifted: 56 → 61 (+5)'], { theirs: ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'] });
  assert.match(h, /a\.mjs, b\.mjs, c\.mjs \+1 more/);
  assert.match(h, /Do NOT baseline/);
});

// ── THE LAUNDERING CHANNEL ───────────────────────────────────────────────────────────────────────
// The co-author guard was once emitted only for 'theirs' while the accept-instruction was
// unconditional — re-adding a bare `--baseline` sentence to any non-owned branch restores the channel.
const ALL_CLAIMS = [
  ['standing', { since: 't1' }],
  ['theirs', { theirs: ['x.mjs'] }],
  ['mixed', {}],
  ['mine', {}],
  ['unknown', {}],
  ['some-future-claim-nobody-has-written-yet', {}],   // the default arm must launder no more than the rest
];

test('laundering: the co-author guard is stated on EVERY claim, unconditionally', () => {
  for (const [claim, opts] of ALL_CLAIMS) {
    const h = worseHeadline(claim, ['drifted: 56 → 61 (+5)'], opts);
    assert.ok(h.includes(COAUTHOR_GUARD), `claim '${claim}' dropped the co-author guard`);
    assert.ok(advice(claim).includes(COAUTHOR_GUARD), `advice('${claim}') dropped the co-author guard`);
  }
});

// BOTH surfaces: the defect lived in advice() (the Stop-hook additionalContext), not the headline —
// a headline-only test passes against the broken code.
test('laundering: `--baseline` is offered ONLY on positive ownership (mine), never on absence of evidence', () => {
  for (const [claim, opts] of ALL_CLAIMS) {
    for (const [surface, text] of [['advice', advice(claim)], ['headline', worseHeadline(claim, ['drifted: 56 → 61 (+5)'], opts)]]) {
      const offered = text.includes('--baseline');
      // A LITERAL set, never ownsIt(). advice() IS `ownsIt(c) ? ACCEPT : SEPARATE`, so comparing
      // against ownsIt() is a tautology that holds for any membership — which is how `standing`
      // stayed in the owned set under a green test that names the members in its title.
      const OWNED = new Set(['mine']);
      assert.equal(offered, OWNED.has(claim),
        offered
          ? `${surface}('${claim}') offers --baseline without positive evidence of ownership — that is the laundering channel`
          : `${surface}('${claim}') is owned by this session and must still offer a deliberate way out`);
      assert.equal(ownsIt(claim), OWNED.has(claim),
        `ownsIt('${claim}') disagrees with the literal owned set this test pins — one of them moved without the other`);
      // and where it IS offered, it comes AFTER the guard, never instead of it
      if (offered) assert.ok(text.indexOf(COAUTHOR_GUARD) < text.indexOf('--baseline'), `${surface}('${claim}'): accept-instruction must be subordinate to the guard`);
    }
  }
});

// Pins the pre-fix text verbatim and asserts the same rule fails it — a regression test never
// shown to fail is a claim, not a control.
test('laundering: the PRE-FIX advice shape is rejected by the same rule', () => {
  const preFix = (claim) => `If the increase is intentional and understood, accept it with \`node bin/gate-ratchet.mjs --baseline\`.${claim === 'theirs' ? ' If it is another session’s, LEAVE IT — baselining a co-author’s break hides their next real one.' : ''}`;
  for (const claim of ['unknown', 'mixed']) {
    assert.ok(!preFix(claim).includes(COAUTHOR_GUARD), 'fixture drifted: the pre-fix text is supposed to LACK the guard');
    assert.ok(preFix(claim).includes('--baseline') && !ownsIt(claim),
      `the pre-fix shape offered --baseline on '${claim}' with no ownership evidence — that is what this suite now forbids`);
  }
  // and the one branch it did guard still had no accept-instruction subordinated to anything
  assert.ok(!preFix('theirs').includes(COAUTHOR_GUARD), 'the pre-fix guard was differently worded and theirs-only');
});

test('laundering: unknown says why absence of evidence is not permission', () => {
  const h = worseHeadline('unknown', ['drifted: 56 → 61 (+5)'], {});
  assert.match(h, /concurrent session's committed change/);
  assert.match(h, /not evidence that it is yours/);
  assert.ok(!/--baseline/.test(h));
});

test('wording: standing carries its date, so the say-once fingerprint is stable across turns', () => {
  const a = worseHeadline('standing', ['x'], { since: '2026-08-09T00:00:00Z' });
  const b = worseHeadline('standing', ['x'], { since: '2026-08-09T00:00:00Z' });
  assert.equal(a, b);
  assert.match(a, /standing since 2026-08-09T00:00:00Z/);
  assert.match(a, /not added this turn/);
});
