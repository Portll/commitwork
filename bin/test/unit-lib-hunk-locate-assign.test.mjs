// Assigns state and sessions to each hunk based on located ranges (bin/lib/hunk-locate.mjs assign).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assign } from '../lib/hunk-locate.mjs';

test('returns unmatched when no located ranges cover the hunk', () => {
  const hunks = [{ changedNew: [10, 20] }];
  const located = [{ range: [1, 5], s: 'alice' }];
  const r = assign(hunks, located, 'me');
  assert.deepEqual(r, [{ hunk: { changedNew: [10, 20] }, state: "unmatched", sessions: [], others: [] }]);
});

test('returns mine when only my session covers the hunk', () => {
  const hunks = [{ changedNew: [10, 20] }];
  const located = [{ range: [5, 15], s: 'me' }];
  const r = assign(hunks, located, 'me');
  assert.deepEqual(r, [{ hunk: { changedNew: [10, 20] }, state: "mine", sessions: ["me"], others: [] }]);
});

test('returns theirs when only another session covers the hunk', () => {
  const hunks = [{ changedNew: [10, 20] }];
  const located = [{ range: [5, 15], s: 'alice' }];
  const r = assign(hunks, located, 'me');
  assert.deepEqual(r, [{ hunk: { changedNew: [10, 20] }, state: "theirs", sessions: ["alice"], others: ["alice"] }]);
});

test('returns shared when my session and another session both cover the hunk', () => {
  const hunks = [{ changedNew: [10, 20] }];
  const located = [
    { range: [5, 15], s: 'me' },
    { range: [12, 25], s: 'alice' }
  ];
  const r = assign(hunks, located, 'me');
  assert.deepEqual(r, [{ hunk: { changedNew: [10, 20] }, state: "shared", sessions: ["me", "alice"], others: ["alice"] }]);
});

test('detects overlap when hunk start equals located end', () => {
  const hunks = [{ changedNew: [10, 20] }];
  const located = [{ range: [5, 10], s: 'alice' }];
  const r = assign(hunks, located, 'me');
  assert.deepEqual(r, [{ hunk: { changedNew: [10, 20] }, state: "theirs", sessions: ["alice"], others: ["alice"] }]);
});

test('detects overlap when hunk end equals located start', () => {
  const hunks = [{ changedNew: [10, 20] }];
  const located = [{ range: [20, 30], s: 'alice' }];
  const r = assign(hunks, located, 'me');
  assert.deepEqual(r, [{ hunk: { changedNew: [10, 20] }, state: "theirs", sessions: ["alice"], others: ["alice"] }]);
});

test('handles multiple hunks with different states', () => {
  const hunks = [
    { changedNew: [1, 5] },
    { changedNew: [10, 20] },
    { changedNew: [30, 40] }
  ];
  const located = [
    { range: [1, 5], s: 'me' },
    { range: [10, 20], s: 'alice' },
    { range: [30, 40], s: 'me' }
  ];
  const r = assign(hunks, located, 'me');
  assert.deepEqual(r, [{ hunk: { changedNew: [1, 5] }, state: "mine", sessions: ["me"], others: [] }, { hunk: { changedNew: [10, 20] }, state: "theirs", sessions: ["alice"], others: ["alice"] }, { hunk: { changedNew: [30, 40] }, state: "mine", sessions: ["me"], others: [] }]);
});
