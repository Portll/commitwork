// Maps each sentence index to a kept/dropped fate and its second-pass fate (bin/comment-suggest.mjs fates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fates } from '../comment-suggest.mjs';

test('returns null fate pairs when void is true', () => {
  const d = { used: [0, 1], sentences: [0, 1, 2], void: true };
  const second = { fate: ['a', 'b'] };
  const result = fates(d, second);
  assert.deepEqual(result, [[null, null], [null, null], [null, null]]);
});

test('returns kept with second fate for indices present in used', () => {
  const d = { used: [0, 2], sentences: [0, 1, 2], void: false };
  const second = { fate: ['x', 'y', 'z'] };
  const result = fates(d, second);
  assert.deepEqual(result, [["kept", "x"], ["dropped", "dropped"], ["kept", "y"]]);
});

test('returns dropped for indices not in used when void is false', () => {
  const d = { used: [1], sentences: [0, 1, 2], void: false };
  const second = { fate: ['a', 'b', 'c'] };
  const result = fates(d, second);
  assert.deepEqual(result, [["dropped", "dropped"], ["kept", "a"], ["dropped", "dropped"]]);
});

test('handles empty used array with void false', () => {
  const d = { used: [], sentences: [0, 1], void: false };
  const second = { fate: [] };
  const result = fates(d, second);
  assert.deepEqual(result, [['dropped', 'dropped'], ['dropped', 'dropped']]);
});

test('handles empty sentences array', () => {
  const d = { used: [0, 1], sentences: [], void: false };
  const second = { fate: ['a', 'b'] };
  const result = fates(d, second);
  assert.deepEqual(result, []);
});

test('maps used indices to their positions in second.fate correctly', () => {
  const d = { used: [2, 0, 1], sentences: [0, 1, 2], void: false };
  const second = { fate: ['first', 'second', 'third'] };
  const result = fates(d, second);
  assert.deepEqual(result, [["kept", "second"], ["kept", "third"], ["kept", "first"]]);
});

test('returns kept for all sentences when used covers all indices', () => {
  const d = { used: [0, 1, 2, 3], sentences: [0, 1, 2, 3], void: false };
  const second = { fate: ['w', 'x', 'y', 'z'] };
  const result = fates(d, second);
  assert.deepEqual(result, [['kept', 'w'], ['kept', 'x'], ['kept', 'y'], ['kept', 'z']]);
});

test('handles single sentence with void true', () => {
  const d = { used: [0], sentences: [0], void: true };
  const second = { fate: ['a'] };
  const result = fates(d, second);
  assert.deepEqual(result, [[null, null]]);
});
