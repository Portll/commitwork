// A5 · an empty attribution must say WHICH empty it is.
//
// THE DEFECT. `whoTouched` in bin/gate-ratchet.mjs had three returns of one shared `none` object:
// nothing drifted, no dirty file matched, and — the dangerous one — `catch { return none }` when
// `git status` itself failed. All three produced the same all-empty shape, so a BROKEN CHECK was
// byte-identical to a CLEAN TREE.
//
// It is not cosmetic. `attributionClaim` reads mine/theirs/shared, so an outage and an untouched
// repo yield the same claim, and the gate then publishes advice built on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAttribution, isOutage, EMPTY_REASONS, attributionClaim } from '../gate-ratchet-core.mjs';

test('THE DEFECT: an outage is distinguishable from a clean tree', () => {
  const clean = emptyAttribution('no-drift');
  const broken = emptyAttribution('git-unavailable', ['a.mjs', 'b.mjs']);
  assert.notDeepEqual(clean, broken,
    'these were the same object; a git failure read as "nobody touched anything"');
  assert.equal(isOutage(broken), true);
  assert.equal(isOutage(clean), false);
});

test('an outage carries the drifted paths as UNKNOWN — it does not claim to have checked', () => {
  const a = emptyAttribution('git-unavailable', ['a.mjs', 'b.mjs']);
  assert.deepEqual(a.unknown, ['a.mjs', 'b.mjs'],
    'these are exactly the files whose ownership could not be determined; reporting zero unknowns asserts a check that did not happen');
  assert.deepEqual(a.mine, []);
  assert.deepEqual(a.theirs, []);
});

test('a legitimately empty result carries NO unknowns — the warning is not permanent', () => {
  for (const r of ['no-drift', 'no-dirty-match']) {
    assert.deepEqual(emptyAttribution(r, ['a.mjs']).unknown, [],
      `${r} means there was genuinely nothing to attribute, not that we failed`);
  }
});

test('the reason travels on the record so a reader is not left inferring it', () => {
  for (const r of EMPTY_REASONS) assert.equal(emptyAttribution(r).emptyReason, r);
});

test('an unrecognised reason degrades to no-drift rather than inventing a state', () => {
  assert.equal(emptyAttribution('whatever').emptyReason, 'no-drift');
  assert.equal(emptyAttribution().emptyReason, 'no-drift');
});

test('the shape still satisfies attributionClaim — this is additive, nothing downstream breaks', () => {
  const a = emptyAttribution('git-unavailable', ['a.mjs']);
  assert.doesNotThrow(() => attributionClaim(a, null),
    'the consumer reads mine/theirs/shared and all three must still be arrays');
});

// ── A6 · the false warrant ───────────────────────────────────────────────────────────────────────
// The unknown-attribution headline asserted "no touch-ledger evidence" — a claim ABOUT the ledger —
// and printed it even when the ledger had never been read. A git outage produced the identical
// sentence, so the gate told its reader that evidence was absent when in fact nothing had been
// looked at. Separable only once A5 gave the empty result a reason.

test('THE FALSE WARRANT: an outage does not claim "no evidence"', async () => {
  const { worseHeadline } = await import('../gate-ratchet-core.mjs');
  const outage = worseHeadline('unknown', ['x up 1'], { emptyReason: 'git-unavailable' });
  assert.match(outage, /NOT READ/, 'an outage must say the ledger was not read');
  assert.doesNotMatch(outage, /no touch-ledger evidence/,
    'claiming absent evidence about a store nobody opened is a false warrant');
  assert.match(outage, /we could not look/);
});

test('a genuine absence still says so — the old sentence is right when it is true', async () => {
  const { worseHeadline } = await import('../gate-ratchet-core.mjs');
  const absent = worseHeadline('unknown', ['x up 1'], { emptyReason: 'no-dirty-match' });
  assert.match(absent, /no touch-ledger evidence/);
  assert.doesNotMatch(absent, /NOT READ/);
});

test('no emptyReason at all keeps the original wording — legacy callers do not change behaviour', async () => {
  const { worseHeadline } = await import('../gate-ratchet-core.mjs');
  assert.match(worseHeadline('unknown', ['x up 1']), /no touch-ledger evidence/);
});

test('both branches still carry the advice tail — the warrant changed, not the guidance', async () => {
  const { worseHeadline, COAUTHOR_GUARD } = await import('../gate-ratchet-core.mjs');
  for (const r of ['git-unavailable', 'no-drift', null]) {
    assert.ok(worseHeadline('unknown', ['x up 1'], { emptyReason: r }).includes(COAUTHOR_GUARD.slice(0, 30)));
  }
});
