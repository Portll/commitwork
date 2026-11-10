// Removes remedy details from items covered by read advice (monitor/daily-advice.mjs dropCoveredRemedy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropCoveredRemedy } from '../daily-advice.mjs';

test('returns repoPart unchanged when advice is missing', () => {
  const repoPart = { advice: null, items: [{ id: 'x', detail: { remedy: 'r' } }] };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: null, items: [{ id: "x", detail: { remedy: "r" } }] });
});

test('returns repoPart unchanged when advice state is not read', () => {
  const repoPart = { advice: { state: 'unread', ordered: [] }, items: [{ id: 'x', detail: { remedy: 'r' } }] };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: { state: "unread", ordered: [] }, items: [{ id: "x", detail: { remedy: "r" } }] });
});

test('returns repoPart unchanged when advice is present but state is read', () => {
  const repoPart = { advice: { state: 'read', ordered: [] }, items: [{ id: 'x', detail: { remedy: 'r' } }] };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: { state: "read", ordered: [] }, items: [{ id: "x", detail: { remedy: "r" } }] });
});

test('keeps remedy when item id is not covered by ordered findings', () => {
  const repoPart = { advice: { state: 'read', ordered: [{ findingIds: ['y'] }] }, items: [{ id: 'x', detail: { remedy: 'r' } }] };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: { state: "read", ordered: [{ findingIds: ["y"] }] }, items: [{ id: "x", detail: { remedy: "r" } }] });
});

test('keeps remedy when item has no detail object', () => {
  const repoPart = { advice: { state: 'read', ordered: [{ findingIds: ['x'] }] }, items: [{ id: 'x' }] };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: { state: "read", ordered: [{ findingIds: ["x"] }] }, items: [{ id: "x" }] });
});

test('keeps remedy when detail exists but remedy is undefined', () => {
  const repoPart = { advice: { state: 'read', ordered: [{ findingIds: ['x'] }] }, items: [{ id: 'x', detail: { other: 1 } }] };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: { state: "read", ordered: [{ findingIds: ["x"] }] }, items: [{ id: "x", detail: { other: 1 } }] });
});

test('removes remedy and detail when covered and detail has only remedy', () => {
  const repoPart = { advice: { state: 'read', ordered: [{ findingIds: ['x'] }] }, items: [{ id: 'x', detail: { remedy: 'r' } }] };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: { state: "read", ordered: [{ findingIds: ["x"] }] }, items: [{ id: "x" }] });
});

test('removes remedy but keeps detail when covered and detail has other keys', () => {
  const repoPart = { advice: { state: 'read', ordered: [{ findingIds: ['x'] }] }, items: [{ id: 'x', detail: { remedy: 'r', note: 'n' } }] };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: { state: "read", ordered: [{ findingIds: ["x"] }] }, items: [{ id: "x", detail: { note: "n" } }] });
});

test('handles multiple items with mixed coverage and detail states', () => {
  const repoPart = {
    advice: { state: 'read', ordered: [{ findingIds: ['a', 'b'] }, { findingIds: ['c'] }] },
    items: [
      { id: 'a', detail: { remedy: 'ra' } },
      { id: 'b', detail: { remedy: 'rb', extra: 1 } },
      { id: 'c', detail: { remedy: 'rc' } },
      { id: 'd', detail: { remedy: 'rd' } },
      { id: 'e' }
    ]
  };
  assert.deepEqual(dropCoveredRemedy(repoPart), { advice: { state: "read", ordered: [{ findingIds: ["a", "b"] }, { findingIds: ["c"] }] }, items: [{ id: "a" }, { id: "b", detail: { extra: 1 } }, { id: "c" }, { id: "d", detail: { remedy: "rd" } }, { id: "e" }] });
});
