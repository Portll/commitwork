// Strips comments and string literals from source code (bin/module-seams.mjs stripNonCode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripNonCode } from '../module-seams.mjs';

test('preserves leading characters when starting index is zero', () => {
  const r = stripNonCode('a');
  assert.equal(r, "a");
});

test('handles line comments without trailing newline', () => {
  const r = stripNonCode('//x');
  assert.equal(r, "   ");
});

test('handles block comments without closing delimiter', () => {
  const r = stripNonCode('/*x');
  assert.equal(r, "   ");
});

test('handles double-quoted strings with escaped quotes', () => {
  const r = stripNonCode('"a\\"b"');
  assert.equal(r, "      ");
});

test('handles single-quoted strings with escaped quotes', () => {
  const r = stripNonCode("'a\\'b'");
  assert.equal(r, "      ");
});

test('handles template literals with nested expressions', () => {
  const r = stripNonCode('`a${x}b`');
  assert.equal(r, "    x   ");
});

test('handles template literals with nested braces in expressions', () => {
  const r = stripNonCode('`a${{x}}b`');
  assert.equal(r, "    {x}   ");
});

test('handles template literals with escaped backticks', () => {
  const r = stripNonCode('`a\\`b`');
  assert.equal(r, "      ");
});

test('handles template literals with newlines', () => {
  const r = stripNonCode('`a\nb`');
  assert.equal(r, "  \n  ");
});

test('handles mixed content with all comment and string types', () => {
  const r = stripNonCode('a // c\nb /* d */ e "f" \'g\' `h`');
  assert.equal(r, "a     \nb         e            ");
});
