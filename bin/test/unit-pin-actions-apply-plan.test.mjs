// Replaces pinned lines with action references (bin/pin-actions.mjs applyPlan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../pin-actions.mjs';

test('returns the input text unchanged when the plans array is empty', () => {
  const text = 'line1\nline2\nline3';
  const result = applyPlan(text, []);
  assert.equal(result, 'line1\nline2\nline3');
});

test('skips plans that have no to property', () => {
  const text = 'a\nb\nc';
  const plans = [
    { line: 0, prefix: 'pin ', action: 'install', to: null },
    { line: 1, prefix: 'pin ', action: 'build', to: { sha: 'abc123', tag: 'v1.0' } }
  ];
  const result = applyPlan(text, plans);
  assert.equal(result, 'a\npin build@abc123 # v1.0\nc');
});

test('replaces the line at the specified index with the formatted action reference', () => {
  const text = 'first\nsecond\nthird';
  const plans = [
    { line: 1, prefix: 'pin ', action: 'install', to: { sha: 'def456', tag: 'v2.0' } }
  ];
  const result = applyPlan(text, plans);
  assert.equal(result, 'first\npin install@def456 # v2.0\nthird');
});

test('handles multiple plans modifying different lines', () => {
  const text = 'l0\nl1\nl2\nl3';
  const plans = [
    { line: 0, prefix: 'pin ', action: 'install', to: { sha: 'sha1', tag: 'tag1' } },
    { line: 2, prefix: 'pin ', action: 'build', to: { sha: 'sha2', tag: 'tag2' } }
  ];
  const result = applyPlan(text, plans);
  assert.equal(result, 'pin install@sha1 # tag1\nl1\npin build@sha2 # tag2\nl3');
});

test('handles multiple plans modifying the same line with the last one winning', () => {
  const text = 'original\nother';
  const plans = [
    { line: 0, prefix: 'pin ', action: 'install', to: { sha: 'first', tag: 'v1' } },
    { line: 0, prefix: 'pin ', action: 'build', to: { sha: 'second', tag: 'v2' } }
  ];
  const result = applyPlan(text, plans);
  assert.equal(result, 'pin build@second # v2\nother');
});

test('handles an empty prefix string', () => {
  const text = 'content';
  const plans = [
    { line: 0, prefix: '', action: 'install', to: { sha: 'xyz', tag: 'v3.0' } }
  ];
  const result = applyPlan(text, plans);
  assert.equal(result, 'install@xyz # v3.0');
});

test('handles a single line of text with no trailing newline', () => {
  const text = 'only';
  const plans = [
    { line: 0, prefix: 'pin ', action: 'test', to: { sha: 'abc', tag: 'v1.0' } }
  ];
  const result = applyPlan(text, plans);
  assert.equal(result, 'pin test@abc # v1.0');
});

test('preserves empty lines in the text that are not modified', () => {
  const text = 'a\n\nb';
  const plans = [
    { line: 0, prefix: 'pin ', action: 'install', to: { sha: 's1', tag: 't1' } }
  ];
  const result = applyPlan(text, plans);
  assert.equal(result, 'pin install@s1 # t1\n\nb');
});
