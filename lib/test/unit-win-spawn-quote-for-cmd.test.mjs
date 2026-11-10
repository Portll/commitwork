// Argument string quoted for cmd.exe when it holds spaces, tabs or parens (lib/win-spawn.mjs quoteForCmd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteForCmd } from '../win-spawn.mjs';

test('an empty string becomes a pair of double quotes', () => {
  assert.equal(quoteForCmd(''), '""');
});

test('a plain word without whitespace or parentheses is returned unchanged', () => {
  assert.equal(quoteForCmd('foo'), 'foo');
});

test('a non-string argument is converted to a string and returned unchanged', () => {
  assert.equal(quoteForCmd(42), '42');
  assert.equal(quoteForCmd(null), 'null');
});

test('a trailing backslash is left alone when the argument needs no quoting', () => {
  assert.equal(quoteForCmd('path\\'), 'path\\');
});

test('an argument with a space, a tab or a parenthesis is wrapped in double quotes', () => {
  assert.equal(quoteForCmd('foo bar'), '"foo bar"');
  assert.equal(quoteForCmd('a\tb'), '"a\tb"');
  assert.equal(quoteForCmd('(x)'), '"(x)"');
  assert.equal(quoteForCmd('a)'), '"a)"');
});

test('a backslash that is not at the end is not doubled inside the quotes', () => {
  assert.equal(quoteForCmd('C:\\Program Files'), '"C:\\Program Files"');
});

test('a single trailing backslash is doubled when the argument is quoted', () => {
  assert.equal(quoteForCmd('a b\\'), '"a b\\\\"');
});

test('a run of trailing backslashes is doubled in full when the argument is quoted', () => {
  const input = 'C:\\My Dir' + '\\'.repeat(3);
  const expected = '"C:\\My Dir' + '\\'.repeat(6) + '"';
  assert.equal(quoteForCmd(input), expected);
});
