// Shannon entropy of a string (bin/agent-config.mjs shannon).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shannon } from '../agent-config.mjs';

test('returns 0 for an empty string', () => {
  assert.equal(shannon(''), 0);
});

test('returns 0 for a string of identical characters', () => {
  assert.equal(shannon('aaaa'), 0);
});

test('returns 1 for a binary string with equal frequencies', () => {
  assert.equal(shannon('ab'), 1);
});

test('returns 2 for a string with four equally frequent characters', () => {
  assert.equal(shannon('abcd'), 2);
});

test('computes entropy for a string with uneven character frequencies', () => {
  const s = 'aabbcc';
  const n = s.length;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const c of freq.values()) { const p = c / n; h -= p * Math.log2(p); }
  assert.equal(shannon(s), h);
});

test('handles a single character string', () => {
  assert.equal(shannon('a'), 0);
});

test('computes entropy for a longer string with mixed characters', () => {
  const s = 'aabbccdd';
  const n = s.length;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const c of freq.values()) { const p = c / n; h -= p * Math.log2(p); }
  assert.equal(shannon(s), h);
});

test('computes entropy for a string with many repeated characters', () => {
  const s = 'x'.repeat(100);
  assert.equal(shannon(s), 0);
});

test('computes entropy for a string with two characters in 3:1 ratio', () => {
  const s = 'aaab';
  const n = s.length;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const c of freq.values()) { const p = c / n; h -= p * Math.log2(p); }
  assert.equal(shannon(s), h);
});

test('computes entropy for a string with three characters in 2:1:1 ratio', () => {
  const s = 'aabb';
  const n = s.length;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const c of freq.values()) { const p = c / n; h -= p * Math.log2(p); }
  assert.equal(shannon(s), h);
});
