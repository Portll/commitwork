// Clears the module-level shell-resolution memo (lib/posix-shell.mjs _clearShellMemo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _clearShellMemo } from '../posix-shell.mjs';

test('returns undefined when called with no arguments', () => {
  assert.equal(_clearShellMemo(), undefined);
});

test('returns undefined when called with an explicit undefined argument', () => {
  assert.equal(_clearShellMemo(undefined), undefined);
});

test('returns undefined when called with a null argument', () => {
  assert.equal(_clearShellMemo(null), undefined);
});

test('returns undefined when called with a string argument', () => {
  assert.equal(_clearShellMemo('bash'), undefined);
});

test('returns undefined when called with a number argument', () => {
  assert.equal(_clearShellMemo(42), undefined);
});

test('returns undefined when called with a boolean argument', () => {
  assert.equal(_clearShellMemo(true), undefined);
});

test('returns undefined when called with an object argument', () => {
  assert.equal(_clearShellMemo({ key: 'value' }), undefined);
});

test('returns undefined when called with an array argument', () => {
  assert.equal(_clearShellMemo(['a', 'b']), undefined);
});
