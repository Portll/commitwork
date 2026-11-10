// removes hidden Unicode control characters and returns cleaned text with count (lib/prompt-envelope.mjs stripHidden)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHidden } from '../prompt-envelope.mjs';

test('removes a null character and counts it', () => {
  const result = stripHidden('\u0000');
  assert.deepStrictEqual(result, { text: '', stripped: 1 });
});

test('leaves a tab character unchanged', () => {
  const result = stripHidden('\u0009');
  assert.deepStrictEqual(result, { text: '\u0009', stripped: 0 });
});

test('removes a mix of hidden characters and leaves others', () => {
  const input = '\u0000A\u200b\u202eB\u2065';
  const result = stripHidden(input);
  assert.deepStrictEqual(result, { text: 'AB\u2065', stripped: 3 });
});

test('null input becomes empty string with zero stripped', () => {
  const result = stripHidden(null);
  assert.deepStrictEqual(result, { text: '', stripped: 0 });
});

test('undefined input becomes empty string with zero stripped', () => {
  const result = stripHidden(undefined);
  assert.deepStrictEqual(result, { text: '', stripped: 0 });
});

test('numeric input is stringified and not stripped', () => {
  const result = stripHidden(42);
  assert.deepStrictEqual(result, { text: '42', stripped: 0 });
});

test('supplementary private-use characters are stripped', () => {
  const input = '\u{e0000}x\u{e007f}';
  const result = stripHidden(input);
  assert.deepStrictEqual(result, { text: 'x', stripped: 2 });
});

test('characters just outside hidden ranges are not stripped', () => {
  const input = '\u0009\u200c\u202f\u2065\u{e0080}';
  const result = stripHidden(input);
  assert.deepStrictEqual(result, { text: input, stripped: 0 });
});
