// Filter registry areas that are paused and project their slug, since, and reason (monitor/sweep-scope.mjs pausedAreas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pausedAreas } from '../sweep-scope.mjs';

test('returns an empty array when the registry is null', () => {
  const r = pausedAreas(null);
  assert.deepEqual(r, []);
});

test('returns an empty array when the registry is undefined', () => {
  const r = pausedAreas(undefined);
  assert.deepEqual(r, []);
});

test('returns an empty array when the registry has no areas property', () => {
  const r = pausedAreas({});
  assert.deepEqual(r, []);
});

test('returns an empty array when the areas array is empty', () => {
  const r = pausedAreas({ areas: [] });
  assert.deepEqual(r, []);
});

test('keeps a paused area and drops a non-paused area', () => {
  const reg = {
    areas: [
      { slug: 'a', paused: { since: '2024-01-01', reason: 'maintenance' } },
      { slug: 'b' }
    ]
  };
  const r = pausedAreas(reg);
  assert.deepEqual(r, [{ slug: "a", since: "2024-01-01", reason: "maintenance" }]);
});

test('drops a null area entry and keeps a paused area', () => {
  const reg = {
    areas: [
      null,
      { slug: 'c', paused: { since: '2024-02-02', reason: 'blocked' } }
    ]
  };
  const r = pausedAreas(reg);
  assert.deepEqual(r, [{ slug: "c", since: "2024-02-02", reason: "blocked" }]);
});

test('drops an area whose paused is falsy and keeps a paused area', () => {
  const reg = {
    areas: [
      { slug: 'd', paused: null },
      { slug: 'e', paused: { since: '2024-03-03', reason: 'review' } }
    ]
  };
  const r = pausedAreas(reg);
  assert.deepEqual(r, [{ slug: "e", since: "2024-03-03", reason: "review" }]);
});

test('keeps every paused area and drops every non-paused area', () => {
  const reg = {
    areas: [
      { slug: 'f', paused: { since: '2024-04-04', reason: 'x' } },
      { slug: 'g' },
      { slug: 'h', paused: { since: '2024-05-05', reason: 'y' } },
      { slug: 'i', paused: false }
    ]
  };
  const r = pausedAreas(reg);
  assert.deepEqual(r, [{ slug: "f", since: "2024-04-04", reason: "x" }, { slug: "h", since: "2024-05-05", reason: "y" }]);
});
