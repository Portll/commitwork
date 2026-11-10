// Filters and summarises built feed groups by focus mode (monitor/feed-groups.mjs feedView).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedView } from '../feed-groups.mjs';

const built = {
  groups: [
    { id: 'a', inFocus: true },
    { id: 'b', inFocus: false },
    { id: 'c', inFocus: true }
  ],
  totals: { groups: 3, open: 5, closed: 2 },
  undeclaredLanes: ['lane-x', 'lane-y']
};

test('returns all groups when mode is all', () => {
  const r = feedView(built, { mode: 'all' });
  assert.deepEqual(r, { mode: "all", groups: [{ id: "a", inFocus: true }, { id: "b", inFocus: false }, { id: "c", inFocus: true }], totals: { groups: 3, open: 5, closed: 2 }, hidden: 0, undeclaredLanes: ["lane-x", "lane-y"] });
});

test('returns only inFocus groups when mode is focus', () => {
  const r = feedView(built, { mode: 'focus' });
  assert.deepEqual(r, { mode: "focus", groups: [{ id: "a", inFocus: true }, { id: "c", inFocus: true }], totals: { groups: 3, open: 5, closed: 2 }, hidden: 1, undeclaredLanes: ["lane-x", "lane-y"] });
});

test('defaults to focus mode when options are omitted', () => {
  const r = feedView(built);
  assert.deepEqual(r, { mode: "focus", groups: [{ id: "a", inFocus: true }, { id: "c", inFocus: true }], totals: { groups: 3, open: 5, closed: 2 }, hidden: 1, undeclaredLanes: ["lane-x", "lane-y"] });
});

test('throws for invalid mode string', () => {
  assert.throws(() => feedView(built, { mode: 'invalid' }), {
    name: 'Error',
    message: 'feedView: mode must be focus|all, got "invalid"'
  });
});

test('throws for undefined mode value', () => {
  assert.deepStrictEqual(feedView(built, { mode: undefined }), { mode: "focus", groups: [{ id: "a", inFocus: true }, { id: "c", inFocus: true }], totals: { groups: 3, open: 5, closed: 2 }, hidden: 1, undeclaredLanes: ["lane-x", "lane-y"] });
});

test('throws for null mode value', () => {
  assert.throws(() => feedView(built, { mode: null }), {
    name: 'Error',
    message: 'feedView: mode must be focus|all, got null'
  });
});

test('computes hidden count as total groups minus returned groups', () => {
  const r = feedView(built, { mode: 'focus' });
  assert.equal(r.hidden, 1);
});

test('returns empty groups array when no groups are in focus', () => {
  const b = {
    groups: [
      { id: 'x', inFocus: false },
      { id: 'y', inFocus: false }
    ],
    totals: { groups: 2, open: 1, closed: 1 },
    undeclaredLanes: []
  };
  const r = feedView(b, { mode: 'focus' });
  assert.deepEqual(r, { mode: "focus", groups: [], totals: { groups: 2, open: 1, closed: 1 }, hidden: 2, undeclaredLanes: [] });
});
