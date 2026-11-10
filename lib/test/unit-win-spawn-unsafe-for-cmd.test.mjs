// Detects cmd.exe metacharacters in a single argument (lib/win-spawn.mjs unsafeForCmd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsafeForCmd } from '../win-spawn.mjs';

test('returns null for a plain argument with no metacharacters', () => {
  assert.equal(unsafeForCmd('hello world'), null);
});

test('returns a message for an ampersand metacharacter', () => {
  assert.equal(unsafeForCmd('a&b'), "contains the cmd.exe metacharacter \"&\"");
});

test('returns a message for a pipe metacharacter', () => {
  assert.equal(unsafeForCmd('a|b'), "contains the cmd.exe metacharacter \"|\"");
});

test('returns a message for a double quote metacharacter', () => {
  assert.equal(unsafeForCmd('a"b'), "contains the cmd.exe metacharacter \"\\\"\"");
});

test('returns a message for a percent metacharacter', () => {
  assert.equal(unsafeForCmd('a%b'), "contains the cmd.exe metacharacter \"%\"");
});

test('returns a message for an exclamation mark metacharacter', () => {
  assert.equal(unsafeForCmd('a!b'), "contains the cmd.exe metacharacter \"!\"");
});

test('returns a message for a caret metacharacter', () => {
  assert.equal(unsafeForCmd('a^b'), "contains the cmd.exe metacharacter \"^\"");
});

test('returns a message for a less-than metacharacter', () => {
  assert.equal(unsafeForCmd('a<b'), "contains the cmd.exe metacharacter \"<\"");
});

test('returns a message for a greater-than metacharacter', () => {
  assert.equal(unsafeForCmd('a>b'), "contains the cmd.exe metacharacter \">\"");
});

test('returns a newline message for an embedded carriage return', () => {
  assert.equal(unsafeForCmd('a\rb'), "contains a newline or NUL byte");
});

test('returns a newline message for an embedded line feed', () => {
  assert.equal(unsafeForCmd('a\nb'), "contains a newline or NUL byte");
});

test('returns a NUL message for an embedded NUL byte', () => {
  assert.equal(unsafeForCmd('a\u0000b'), "contains a newline or NUL byte");
});
