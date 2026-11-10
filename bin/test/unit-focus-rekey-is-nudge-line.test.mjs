// Detects whether a JSONL line is a bare nudge prompt (bin/focus-rekey.mjs isNudgeLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNudgeLine } from '../focus-rekey.mjs';

test('returns false when the line has no user prompt', () => {
  const r = isNudgeLine('{"role":"assistant","content":"hello"}');
  assert.equal(r, false);
});

test('returns true for a bare continue prompt', () => {
  const r = isNudgeLine('{"role":"user","content":"continue"}');
  assert.equal(r, true);
});

test('returns true for a bare question mark prompt', () => {
  const r = isNudgeLine('{"role":"user","content":"?"}');
  assert.equal(r, true);
});

test('returns false for a substantive prompt', () => {
  const r = isNudgeLine('{"role":"user","content":"fix the bug"}');
  assert.equal(r, false);
});

test('returns true for a prompt with trailing punctuation', () => {
  const r = isNudgeLine('{"role":"user","content":"go!"}');
  assert.equal(r, true);
});

test('returns true for a prompt with multiple question marks', () => {
  const r = isNudgeLine('{"role":"user","content":"???"}');
  assert.equal(r, true);
});

test('returns false for a prompt that is not in the nudge set', () => {
  const r = isNudgeLine('{"role":"user","content":"stop"}');
  assert.equal(r, false);
});

test('returns true for a prompt with leading and trailing spaces', () => {
  const r = isNudgeLine('{"role":"user","content":"  next  "}');
  assert.equal(r, true);
});
