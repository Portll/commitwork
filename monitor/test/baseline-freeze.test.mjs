// node --test monitor/test/ — I2: the 1.0 pre-registration, and proof it happened.
//
// F3 FROM THE PLAN EVALUATION, RPN 360, DETECTABILITY 10. A hash chain proves a record was not
// altered; it says nothing about whether the thing it records ever RAN. A freeze that silently
// no-ops leaves no event, and "no event" is indistinguishable from "not yet due" — until somebody
// cites a baseline that does not exist.
//
// So integrity and occurrence are tested separately, because they are different problems and only
// one of them is solved by hashing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFreeze, verifyFreezeChain, freezeLiveness, isPreRegistration, freezeHash } from '../baseline-freeze.mjs';

const OK = {
  laneSet: ['secrets', 'sastSemgrep'], sampling: 'random',
  adjudicationProtocol: 'two adjudicators, disagreement recorded not averaged',
  interRaterPlan: 'Cohen kappa over a 10% double-labelled subset',
  at: '2026-09-01T00:00:00.000Z',
};

// ---- what a freeze must state BEFORE any measurement exists -------------------------------------

test('a freeze must name its lane set — an unbounded pre-registration pre-registers nothing', () => {
  assert.throws(() => appendFreeze([], { ...OK, laneSet: [] }), /must name the lane set/);
  assert.throws(() => appendFreeze([], { ...OK, laneSet: undefined }), /must name the lane set/);
});

test('a freeze REFUSES opportunistic sampling — a selection cannot be pre-registered as a sample', () => {
  assert.throws(() => appendFreeze([], { ...OK, sampling: 'opportunistic' }), /cannot be pre-registered as a sample/);
});

test('protocol and inter-rater plan are stated before any finding is adjudicated', () => {
  assert.throws(() => appendFreeze([], { ...OK, adjudicationProtocol: '  ' }), /how findings will be adjudicated/);
  assert.throws(() => appendFreeze([], { ...OK, interRaterPlan: '' }), /inter-rater agreement/);
});

test('a freeze must carry its own timestamp — it is what separates pre from post', () => {
  assert.throws(() => appendFreeze([], { ...OK, at: null }), /separates a pre-registration from a post-registration/);
});

test('the lane set is stored SORTED, so two freezes over the same lanes hash identically', () => {
  const a = appendFreeze([], { ...OK, laneSet: ['b', 'a'] })[0];
  const b = appendFreeze([], { ...OK, laneSet: ['a', 'b'] })[0];
  assert.deepEqual(a.laneSet, ['a', 'b']);
  assert.equal(a.hash, b.hash, 'declaration order is not a difference in what was declared');
});

// ---- INTEGRITY ------------------------------------------------------------------------------------

test('the chain verifies, and an edit to a PAST record breaks it', () => {
  let recs = appendFreeze([], OK);
  recs = appendFreeze(recs, { ...OK, at: '2026-09-02T00:00:00.000Z', note: 'second' });
  assert.deepEqual(verifyFreezeChain(recs), []);

  const tampered = structuredClone(recs);
  tampered[0].adjudicationProtocol = 'whatever we decide later';
  assert.ok(verifyFreezeChain(tampered).length, 'editing the first record must be detectable');
});

test('a rewrite that RE-CHAINS is still detectable, because the first hash changes', () => {
  // The subtle one: an attacker who edits a record and recomputes every subsequent hash produces a
  // self-consistent chain. It is caught only because the record's own hash covers its content.
  let recs = appendFreeze([], OK);
  recs = appendFreeze(recs, { ...OK, at: '2026-09-02T00:00:00.000Z' });
  const before = recs[0].hash;
  const rewritten = structuredClone(recs);
  rewritten[0].laneSet = ['everything'];
  rewritten[0].hash = freezeHash(null, rewritten[0]);
  rewritten[1].prevHash = rewritten[0].hash;
  rewritten[1].hash = freezeHash(rewritten[1].prevHash, rewritten[1]);
  assert.deepEqual(verifyFreezeChain(rewritten), [], 'internally consistent — hashing alone cannot catch this');
  assert.notEqual(rewritten[0].hash, before,
    'THE CHECK: the first hash moved, so a published hash is what makes the rewrite visible');
});

// ---- OCCURRENCE: the part hashing does not solve ---------------------------------------------------

test('NO FREEZE BEFORE THE DUE DATE IS `pending`, NOT a failure', () => {
  const l = freezeLiveness([], { expectedBy: '2026-12-01', now: '2026-09-01T00:00:00.000Z' });
  assert.equal(l.state, 'pending');
  assert.notEqual(l.state, 'expired', 'an on-schedule programme must not report a failure every day until the date');
});

test('NO FREEZE AFTER THE DUE DATE IS `expired` — the silent no-op becomes loud', () => {
  const l = freezeLiveness([], { expectedBy: '2026-09-01', now: '2026-12-01T00:00:00.000Z' });
  assert.equal(l.state, 'expired');
  assert.match(l.why, /should exist and does not/);
});

test('a valid freeze reads `frozen`', () => {
  const l = freezeLiveness(appendFreeze([], OK), { expectedBy: '2026-12-01', now: '2026-12-05T00:00:00.000Z' });
  assert.equal(l.state, 'frozen');
  assert.equal(l.freeze.laneSet.length, 2);
});

test('NO DUE DATE IS `unknown`, never `pending` — nothing can be said about a deadline nobody set', () => {
  const l = freezeLiveness([], { now: '2026-09-01T00:00:00.000Z' });
  assert.equal(l.state, 'unknown');
  assert.notEqual(l.state, 'pending');
  assert.match(l.why, /deadline nobody declared/);
});

test('AN UNVERIFIABLE CHAIN IS ITS OWN STATE — not missing, and not valid', () => {
  // Reporting it as either would be the more damaging error: `expired` invites a re-freeze that
  // overwrites evidence of tampering; `frozen` blesses a record that does not verify.
  let recs = appendFreeze([], OK);
  recs = structuredClone(recs);
  recs[0].sampling = 'opportunistic';
  const l = freezeLiveness(recs, { expectedBy: '2026-09-01', now: '2026-12-01T00:00:00.000Z' });
  assert.equal(l.state, 'unknown');
  assert.match(l.why, /does not verify/);
});

test('fails closed on unreadable input rather than reading as scheduled', () => {
  assert.equal(freezeLiveness(null, { expectedBy: '2026-12-01', now: '2026-09-01' }).state, 'unknown');
  assert.equal(freezeLiveness([], { expectedBy: 'not-a-date', now: '2026-09-01' }).state, 'unknown');
  assert.equal(freezeLiveness([], { expectedBy: '2026-12-01', now: 'nonsense' }).state, 'unknown');
});

// ---- pre vs post registration, answered from timestamps rather than trust ---------------------------

test('a freeze made AFTER the first measurement is a post-registration, and says so', () => {
  const f = appendFreeze([], OK)[0];
  assert.equal(isPreRegistration(f, '2026-10-01T00:00:00.000Z').ok, true);
  const late = isPreRegistration(f, '2026-08-01T00:00:00.000Z');
  assert.equal(late.ok, false);
  assert.match(late.why, /post-registration/);
});

test('an equal timestamp is NOT a pre-registration — strictly before, or it is not prior', () => {
  const f = appendFreeze([], OK)[0];
  assert.equal(isPreRegistration(f, OK.at).ok, false);
});

test('an unparseable timestamp cannot establish order and says so rather than guessing', () => {
  const f = appendFreeze([], OK)[0];
  assert.equal(isPreRegistration(f, 'whenever').ok, false);
  assert.match(isPreRegistration(f, 'whenever').why, /cannot establish order/);
});

// ---- non-vacuity -------------------------------------------------------------------------------------

test('NOT VACUOUS: an untampered two-record chain really does verify clean', () => {
  let recs = appendFreeze([], OK);
  recs = appendFreeze(recs, { ...OK, at: '2026-09-02T00:00:00.000Z', note: 'second' });
  assert.deepEqual(verifyFreezeChain(recs), [], 'if this ever fails, every tamper test above is passing for the wrong reason');
  assert.equal(recs[1].prevHash, recs[0].hash);
});
