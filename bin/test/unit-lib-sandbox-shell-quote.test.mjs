// Quote shell arguments safely (bin/lib/sandbox.mjs shellQuote).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellQuote } from '../lib/sandbox.mjs';

test('returns a single safe argument unchanged', () => {
  assert.equal(shellQuote(['hello']), "hello");
});

test('returns multiple safe arguments joined by spaces', () => {
  assert.equal(shellQuote(['foo', 'bar', 'baz']), "foo bar baz");
});

test('quotes an argument containing a space', () => {
  assert.equal(shellQuote(['hello world']), "'hello world'");
});

test('quotes an argument containing a single quote', () => {
  assert.equal(shellQuote(["it's"]), "'it'\\''s'");
});

test('quotes an argument containing a dollar sign', () => {
  assert.equal(shellQuote(['$HOME']), "'$HOME'");
});

test('quotes an argument containing a semicolon', () => {
  assert.equal(shellQuote(['ls; rm']), "'ls; rm'");
});

test('quotes an argument containing a pipe', () => {
  assert.equal(shellQuote(['cat | grep']), "'cat | grep'");
});

test('quotes an argument containing a backtick', () => {
  assert.equal(shellQuote(['`cmd`']), "'`cmd`'");
});

test('quotes an argument containing a newline', () => {
  assert.equal(shellQuote(['line1\nline2']), "'line1\nline2'");
});

test('quotes an argument containing a tab', () => {
  assert.equal(shellQuote(['col1\tcol2']), "'col1\tcol2'");
});
