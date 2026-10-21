// Applies a sequence of regex replacement rules to a label string (bin/projectstatus.mjs releaseSafeLabel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseSafeLabel } from '../projectstatus.mjs';

test('returns the label unchanged when no rules are provided', () => {
  const result = releaseSafeLabel('hello', []);
  assert.equal(result, 'hello');
});

test('replaces a single pattern with its replacement', () => {
  const rules = [{ pattern: /a/g, replacement: 'b' }];
  const result = releaseSafeLabel('abc', rules);
  assert.equal(result, 'bbc');
});

test('applies multiple rules sequentially in order', () => {
  const rules = [
    { pattern: /a/g, replacement: 'b' },
    { pattern: /b/g, replacement: 'c' }
  ];
  const result = releaseSafeLabel('a', rules);
  assert.equal(result, 'c');
});

test('converts non-string label to string before processing', () => {
  const rules = [{ pattern: /1/g, replacement: 'one' }];
  const result = releaseSafeLabel(123, rules);
  assert.equal(result, 'one23');
});

test('handles null label by converting to string "null"', () => {
  const rules = [{ pattern: /null/g, replacement: 'nil' }];
  const result = releaseSafeLabel(null, rules);
  assert.equal(result, 'nil');
});

test('handles undefined label by converting to string "undefined"', () => {
  const rules = [{ pattern: /undefined/g, replacement: 'undef' }];
  const result = releaseSafeLabel(undefined, rules);
  assert.equal(result, 'undef');
});

test('handles boolean label by converting to string', () => {
  const rules = [{ pattern: /true/g, replacement: 'yes' }];
  const result = releaseSafeLabel(true, rules);
  assert.equal(result, 'yes');
});

test('handles object label by converting to string representation', () => {
  const rules = [{ pattern: /\[object Object\]/g, replacement: 'obj' }];
  const result = releaseSafeLabel({}, rules);
  assert.equal(result, 'obj');
});

test('handles number label with no matching pattern', () => {
  const rules = [{ pattern: /xyz/g, replacement: 'abc' }];
  const result = releaseSafeLabel(42, rules);
  assert.equal(result, '42');
});

test('handles empty string label', () => {
  const rules = [{ pattern: /a/g, replacement: 'b' }];
  const result = releaseSafeLabel('', rules);
  assert.equal(result, '');
});
