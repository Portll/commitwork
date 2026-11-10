// Verdict on model turns that claim a checked outcome with no tool witness, against a policy limit (bin/lib/turn-gate-core.mjs unwitnessedClaims).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwitnessedClaims } from '../lib/turn-gate-core.mjs';

const CLAIM = 'I ran the tests and verified it: all tests pass, confirmed fixed and working.';

const shape = (r) => ({
  ...r,
  evidence: {
    count: r.evidence.count,
    turns: r.evidence.turns.map(({ openedByUuid, text }) => ({ openedByUuid, text })),
  },
});

const passed = (n, limit, turns = []) => ({
  rule: 'unwitnessed-claim',
  verdict: 'pass',
  reason: `${n} unwitnessed claim(s), at or under the limit of ${limit}`,
  evidence: { count: n, turns },
  policy: { unwitnessedClaims: limit },
});

const blocked = (n, limit, turns) => ({
  rule: 'unwitnessed-claim',
  verdict: 'block',
  reason: `${n} turn(s) asserted a checked outcome with no tool call or tool result in the same turn (limit ${limit})`,
  evidence: { count: n, turns },
  policy: { unwitnessedClaims: limit },
});

test('a non-array turns value counts nothing and passes under the default limit of one', () => {
  assert.deepEqual(unwitnessedClaims(null), passed(0, 1));
  assert.deepEqual(unwitnessedClaims({ openedByUuid: 'o1', text: CLAIM }), passed(0, 1));
});

test('no claims against a limit of zero is at the limit and passes', () => {
  assert.deepEqual(unwitnessedClaims([], { unwitnessedClaims: 0 }), passed(0, 0));
});

test('a model turn that claims nothing is not counted', () => {
  const turns = [{ modelAuthored: true, openedByUuid: 'q1', text: 'Let me open the parser first.' }];
  assert.deepEqual(unwitnessedClaims(turns, { unwitnessedClaims: 0 }), passed(0, 0));
});

test('a turn the harness wrote is skipped even when its text claims a checked outcome', () => {
  const turns = [{ modelAuthored: false, openedByUuid: 'h1', text: CLAIM }];
  assert.deepEqual(unwitnessedClaims(turns, { unwitnessedClaims: 0 }), passed(0, 0));
});

test('one unwitnessed model claim is recorded and sits at the default limit of one, so it passes', () => {
  const turns = [{ modelAuthored: true, openedByUuid: 'm1', text: CLAIM }];
  const r = unwitnessedClaims(turns);
  assert.deepEqual(shape(r), passed(1, 1, [{ openedByUuid: 'm1', text: CLAIM }]));
});

test('a turn with no modelAuthored flag is counted and one claim over a limit of zero blocks', () => {
  const turns = [{ openedByUuid: 'u1', text: CLAIM }];
  const r = unwitnessedClaims(turns, { unwitnessedClaims: 0 });
  assert.deepEqual(shape(r), blocked(1, 0, [{ openedByUuid: 'u1', text: CLAIM }]));
});

test('two unwitnessed model claims exceed the default limit of one while the harness turn is ignored', () => {
  const turns = [
    { modelAuthored: true, openedByUuid: 'a', text: CLAIM },
    { openedByUuid: 'b', text: CLAIM },
    { modelAuthored: false, openedByUuid: 'c', text: CLAIM },
  ];
  const r = unwitnessedClaims(turns);
  assert.deepEqual(shape(r), blocked(2, 1, [
    { openedByUuid: 'a', text: CLAIM },
    { openedByUuid: 'b', text: CLAIM },
  ]));
});

test('the evidence keeps only the first 200 characters of a claiming turn', () => {
  const turns = [{ modelAuthored: true, openedByUuid: 'l1', text: `${CLAIM} ${'x'.repeat(300)}` }];
  const r = unwitnessedClaims(turns);
  const kept = `${CLAIM} ${'x'.repeat(199 - CLAIM.length)}`;
  assert.equal(kept.length, 200);
  assert.deepEqual(shape(r), passed(1, 1, [{ openedByUuid: 'l1', text: kept }]));
});
