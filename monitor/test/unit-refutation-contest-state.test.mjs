// Computes the contest state of a claim target (monitor/refutation.mjs contestState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contestState } from '../refutation.mjs';

test('returns uncontested when no refutation matches the target', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:other', state: 'open' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "uncontested", open: 0, total: 0, why: "no refutation has been filed against this claim" });
});

test('returns contested with grounds when an open refutation exists', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:abc', state: 'open', by: 'alice', independence: 'independent', ground: 'flawed' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "contested", open: 1, total: 1, grounds: [{ id: "r1", by: "alice", independence: "independent", ground: "flawed" }], why: "1 open refutation \u2014 the claim is recorded and does not stand unopposed" });
});

test('returns settled with claimStands false when refutation is conceded', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:abc', state: 'resolved', resolution: 'conceded' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "settled", open: 0, total: 1, resolutions: { conceded: 1 }, claimStands: false, why: "1 refutation filed and resolved (1 conceded) \u2014 the claim was CONCEDED, so it does not stand and anything published from it must be withdrawn or restated" });
});

test('returns settled with claimStands true when refutation is upheld', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:abc', state: 'resolved', resolution: 'upheld' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "settled", open: 0, total: 1, resolutions: { upheld: 1 }, claimStands: true, why: "1 refutation filed and resolved (1 upheld) \u2014 a claim upheld over a recorded contest, which is not an unchallenged one" });
});

test('returns settled with claimStands null when refutation is withdrawn', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:abc', state: 'resolved', resolution: 'withdrawn' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "settled", open: 0, total: 1, resolutions: { withdrawn: 1 }, claimStands: null, why: "1 refutation filed and withdrawn (1 withdrawn) \u2014 the contest ended without a ruling, so the claim was never tested rather than vindicated" });
});

test('returns uncontested when doc has no refutations property', () => {
  const doc = {};
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "uncontested", open: 0, total: 0, why: "no refutation has been filed against this claim" });
});

test('returns contested with plural why when multiple open refutations exist', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:abc', state: 'open', by: 'a', independence: 'i', ground: 'g' }, r2: { id: 'r2', target: 'closure:abc', state: 'open', by: 'b', independence: 'i', ground: 'g' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "contested", open: 2, total: 2, grounds: [{ id: "r1", by: "a", independence: "i", ground: "g" }, { id: "r2", by: "b", independence: "i", ground: "g" }], why: "2 open refutations \u2014 the claim is recorded and does not stand unopposed" });
});

test('returns settled with plural why when multiple refutations are conceded', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:abc', state: 'resolved', resolution: 'conceded' }, r2: { id: 'r2', target: 'closure:abc', state: 'resolved', resolution: 'conceded' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "settled", open: 0, total: 2, resolutions: { conceded: 2 }, claimStands: false, why: "2 refutations filed and resolved (2 conceded) \u2014 the claim was CONCEDED, so it does not stand and anything published from it must be withdrawn or restated" });
});

test('returns settled with plural why when multiple refutations are upheld', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:abc', state: 'resolved', resolution: 'upheld' }, r2: { id: 'r2', target: 'closure:abc', state: 'resolved', resolution: 'upheld' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "settled", open: 0, total: 2, resolutions: { upheld: 2 }, claimStands: true, why: "2 refutations filed and resolved (2 upheld) \u2014 a claim upheld over a recorded contest, which is not an unchallenged one" });
});

test('returns settled with plural why when multiple refutations are withdrawn', () => {
  const doc = { refutations: { r1: { id: 'r1', target: 'closure:abc', state: 'resolved', resolution: 'withdrawn' }, r2: { id: 'r2', target: 'closure:abc', state: 'resolved', resolution: 'withdrawn' } } };
  const r = contestState(doc, 'closure:abc');
  assert.deepEqual(r, { state: "settled", open: 0, total: 2, resolutions: { withdrawn: 2 }, claimStands: null, why: "2 refutations filed and withdrawn (2 withdrawn) \u2014 the contest ended without a ruling, so the claim was never tested rather than vindicated" });
});
