// Sorts vulnerability rows by KEV count, then critical count, then key (monitor/update-vulns.mjs rowOrder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowOrder } from '../update-vulns.mjs';

test('returns negative when b has more KEV entries than a', () => {
  const a = { key: 'a', fixedByUpdate: { kev: ['x'] }, vulnerableNow: {} };
  const b = { key: 'b', fixedByUpdate: { kev: ['x', 'y'] }, vulnerableNow: {} };
  assert.equal(rowOrder(a, b), 1);
});

test('returns positive when a has more KEV entries than b', () => {
  const a = { key: 'a', fixedByUpdate: { kev: ['x', 'y'] }, vulnerableNow: {} };
  const b = { key: 'b', fixedByUpdate: { kev: ['x'] }, vulnerableNow: {} };
  assert.equal(rowOrder(a, b), -1);
});

test('returns zero when KEV counts are equal and keys are equal', () => {
  const a = { key: 'z', fixedByUpdate: { kev: ['x'] }, vulnerableNow: {} };
  const b = { key: 'z', fixedByUpdate: { kev: ['y'] }, vulnerableNow: {} };
  assert.equal(rowOrder(a, b), 0);
});

test('returns negative when KEV equal and b has more critical entries', () => {
  const a = { key: 'a', fixedByUpdate: { published: { Critical: 1, High: 0 } }, vulnerableNow: {} };
  const b = { key: 'b', fixedByUpdate: { published: { Critical: 2, High: 0 } }, vulnerableNow: {} };
  assert.equal(rowOrder(a, b), 1);
});

test('returns positive when KEV equal and a has more critical entries', () => {
  const a = { key: 'a', fixedByUpdate: { published: { Critical: 2, High: 0 } }, vulnerableNow: {} };
  const b = { key: 'b', fixedByUpdate: { published: { Critical: 1, High: 0 } }, vulnerableNow: {} };
  assert.equal(rowOrder(a, b), -1);
});

test('returns negative when KEV and crit equal and a key is less than b key', () => {
  const a = { key: 'a', fixedByUpdate: {}, vulnerableNow: {} };
  const b = { key: 'b', fixedByUpdate: {}, vulnerableNow: {} };
  assert.equal(rowOrder(a, b), -1);
});

test('returns positive when KEV and crit equal and a key is greater than b key', () => {
  const a = { key: 'b', fixedByUpdate: {}, vulnerableNow: {} };
  const b = { key: 'a', fixedByUpdate: {}, vulnerableNow: {} };
  assert.equal(rowOrder(a, b), 1);
});

test('returns zero when KEV and crit equal and keys are equal', () => {
  const a = { key: 'x', fixedByUpdate: {}, vulnerableNow: {} };
  const b = { key: 'x', fixedByUpdate: {}, vulnerableNow: {} };
  assert.equal(rowOrder(a, b), 0);
});

test('handles vulnerableNow kev in count when fixedByUpdate is absent', () => {
  const a = { key: 'a', vulnerableNow: { kev: ['x', 'y'] } };
  const b = { key: 'b', vulnerableNow: { kev: ['x'] } };
  assert.equal(rowOrder(a, b), -1);
});

test('handles undetermined in crit count when published is absent', () => {
  const a = { key: 'a', fixedByUpdate: { undetermined: 1 } };
  const b = { key: 'b', fixedByUpdate: { undetermined: 2 } };
  assert.equal(rowOrder(a, b), 1);
});
