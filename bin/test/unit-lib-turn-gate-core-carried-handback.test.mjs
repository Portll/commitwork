// Finds runs of consecutive model turns handing back the same item (bin/lib/turn-gate-core.mjs carriedHandback).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carriedHandback } from '../lib/turn-gate-core.mjs';

const MERGE = 'want me to merge the branch';
const turn = (uuid, text, extra = {}) => ({ openedByUuid: uuid, text, ...extra });
const pass = (longest, limit = 3) => ({
  rule: 'carried-handback',
  verdict: 'pass',
  reason: `longest carried hand-back was ${longest}, under the limit of ${limit}`,
  evidence: { count: 0, turns: [], runs: [], longest },
  policy: { carriedHandbackRun: limit },
});

test('three consecutive turns handing back the same item block with that run as evidence', () => {
  const turns = Array.from({ length: 3 }, (_, i) => turn(`u${i}`, MERGE));
  assert.deepEqual(carriedHandback(turns), {
    rule: 'carried-handback',
    verdict: 'block',
    reason: '1 run(s) of 3+ consecutive turns handing back the same item',
    evidence: {
      count: 1,
      turns: [
        { openedByUuid: 'u0', text: 'merge branch' },
        { openedByUuid: 'u1', text: 'merge branch' },
        { openedByUuid: 'u2', text: 'merge branch' },
      ],
      runs: [{ turns: ['u0', 'u1', 'u2'], item: ['merge', 'branch'] }],
      longest: 3,
    },
    policy: { carriedHandbackRun: 3 },
  });
});

test('two consecutive turns handing back the same item pass with longest two', () => {
  const turns = Array.from({ length: 2 }, (_, i) => turn(`u${i}`, MERGE));
  assert.deepEqual(carriedHandback(turns), pass(2));
});

test('an overlap of exactly one half keeps the run going', () => {
  const turns = [turn('u0', 'want me to merge'), turn('u1', MERGE), turn('u2', 'want me to merge')];
  assert.deepEqual(carriedHandback(turns), {
    rule: 'carried-handback',
    verdict: 'block',
    reason: '1 run(s) of 3+ consecutive turns handing back the same item',
    evidence: {
      count: 1,
      turns: [
        { openedByUuid: 'u0', text: 'merge' },
        { openedByUuid: 'u1', text: 'merge branch' },
        { openedByUuid: 'u2', text: 'merge' },
      ],
      runs: [{ turns: ['u0', 'u1', 'u2'], item: ['merge'] }],
      longest: 3,
    },
    policy: { carriedHandbackRun: 3 },
  });
});

test('different items in consecutive turns never form a run', () => {
  const turns = [
    turn('u0', MERGE),
    turn('u1', 'want me to deploy the release'),
    turn('u2', 'want me to publish the package'),
  ];
  assert.deepEqual(carriedHandback(turns), pass(0));
});

test('a turn with no hand-back ends the run and the run of two is the longest', () => {
  const turns = [turn('u0', MERGE), turn('u1', MERGE), turn('u2', 'ran the suite'), turn('u3', MERGE)];
  assert.deepEqual(carriedHandback(turns), pass(2));
});

test('a harness-authored turn is skipped without breaking the run', () => {
  const turns = [
    turn('a', MERGE, { modelAuthored: true }),
    turn('b', 'ran the suite', { modelAuthored: false }),
    turn('c', MERGE),
    turn('d', MERGE, { modelAuthored: true }),
  ];
  assert.deepEqual(carriedHandback(turns), {
    rule: 'carried-handback',
    verdict: 'block',
    reason: '1 run(s) of 3+ consecutive turns handing back the same item',
    evidence: {
      count: 1,
      turns: [
        { openedByUuid: 'a', text: 'merge branch' },
        { openedByUuid: 'c', text: 'merge branch' },
        { openedByUuid: 'd', text: 'merge branch' },
      ],
      runs: [{ turns: ['a', 'c', 'd'], item: ['merge', 'branch'] }],
      longest: 3,
    },
    policy: { carriedHandbackRun: 3 },
  });
});

test('a hand-back in a harness-authored turn is not counted toward the run', () => {
  const turns = [turn('a', MERGE), turn('b', MERGE), turn('c', MERGE, { modelAuthored: false })];
  assert.deepEqual(carriedHandback(turns), pass(2));
});

test('a policy limit of two blocks a run of two', () => {
  const turns = [turn('u0', MERGE), turn('u1', MERGE)];
  assert.deepEqual(carriedHandback(turns, { carriedHandbackRun: 2 }), {
    rule: 'carried-handback',
    verdict: 'block',
    reason: '1 run(s) of 2+ consecutive turns handing back the same item',
    evidence: {
      count: 1,
      turns: [
        { openedByUuid: 'u0', text: 'merge branch' },
        { openedByUuid: 'u1', text: 'merge branch' },
      ],
      runs: [{ turns: ['u0', 'u1'], item: ['merge', 'branch'] }],
      longest: 2,
    },
    policy: { carriedHandbackRun: 2 },
  });
});

test('a lone hand-back is not a run so longest stays zero', () => {
  assert.deepEqual(carriedHandback([turn('u0', MERGE)]), pass(0));
  assert.deepEqual(carriedHandback([turn('u0', MERGE), turn('u1', 'ran the suite')]), pass(0));
});

test('non-array input and hand-backs that leave no words both pass with longest zero', () => {
  assert.deepEqual(carriedHandback(null), pass(0));
  const turns = Array.from({ length: 3 }, (_, i) => turn(`u${i}`, 'pending your call'));
  assert.deepEqual(carriedHandback(turns), pass(0));
});
