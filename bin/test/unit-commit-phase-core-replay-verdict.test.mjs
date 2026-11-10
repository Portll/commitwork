// Computes the replay verdict for a branch (bin/commit-phase-core.mjs replayVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayVerdict } from '../commit-phase-core.mjs';

test('refuses when base is missing', () => {
  const r = replayVerdict({ base: undefined, head: 'abc1234567890', commits: ['c1'], mineFiles: ['a'], theirFiles: ['a'], exempt: [] });
  assert.deepEqual(r, { verdict: "refuse", exit: 2, overlap: [], why: "base or head is UNKNOWN \u2014 refusing rather than coercing an unreadable sha to a value." });
});

test('refuses when head is missing', () => {
  const r = replayVerdict({ base: 'abc1234567890', head: undefined, commits: ['c1'], mineFiles: ['a'], theirFiles: ['a'], exempt: [] });
  assert.deepEqual(r, { verdict: "refuse", exit: 2, overlap: [], why: "base or head is UNKNOWN \u2014 refusing rather than coercing an unreadable sha to a value." });
});

test('returns noop when base equals head', () => {
  const r = replayVerdict({ base: 'abc1234567890', head: 'abc1234567890', commits: ['c1'], mineFiles: ['a'], theirFiles: ['a'], exempt: [] });
  assert.deepEqual(r, { verdict: "noop", exit: 0, overlap: [], why: "already at the target; nothing to replay." });
});

test('returns noop when there are no commits', () => {
  const r = replayVerdict({ base: 'abc1234567890', head: 'def4567890123', commits: [], mineFiles: ['a'], theirFiles: ['a'], exempt: [] });
  assert.deepEqual(r, { verdict: "noop", exit: 0, overlap: [], why: "no commits in abc1234..def4567 \u2014 this branch is behind, not ahead." });
});

test('refuses when paths overlap on both sides', () => {
  const r = replayVerdict({ base: 'abc1234567890', head: 'def4567890123', commits: ['c1', 'c2'], mineFiles: ['b', 'a'], theirFiles: ['a', 'c'], exempt: [] });
  assert.deepEqual(r, { verdict: "refuse", exit: 2, overlap: ["a"], why: "1 path(s) changed on BOTH sides, and a replay ASSIGNS rather than merges \u2014 it would take this branch's blob and drop theirs behind a clean-looking diff: a. Resolve those paths deliberately; this tool never picks a side." });
});

test('returns replay when paths are disjoint', () => {
  const r = replayVerdict({ base: 'abc1234567890', head: 'def4567890123', commits: ['c1', 'c2'], mineFiles: ['a', 'b'], theirFiles: ['c', 'd'], exempt: [] });
  assert.deepEqual(r, { verdict: "replay", exit: 0, overlap: [], why: "2 commit(s) over 2 disjoint path(s)." });
});

test('exempts paths from overlap refusal', () => {
  const r = replayVerdict({ base: 'abc1234567890', head: 'def4567890123', commits: ['c1'], mineFiles: ['a', 'b'], theirFiles: ['a', 'b'], exempt: ['a', 'b'] });
  assert.deepEqual(r, { verdict: "replay", exit: 0, overlap: [], why: "1 commit(s) over 2 disjoint path(s)." });
});

test('refuses when only some overlapping paths are exempted', () => {
  const r = replayVerdict({ base: 'abc1234567890', head: 'def4567890123', commits: ['c1'], mineFiles: ['a', 'b'], theirFiles: ['a', 'b'], exempt: ['a'] });
  assert.deepEqual(r, { verdict: "refuse", exit: 2, overlap: ["b"], why: "1 path(s) changed on BOTH sides, and a replay ASSIGNS rather than merges \u2014 it would take this branch's blob and drop theirs behind a clean-looking diff: b. Resolve those paths deliberately; this tool never picks a side." });
});
