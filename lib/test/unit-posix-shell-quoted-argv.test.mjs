// Splits a command string into an array of arguments, honouring double quotes (lib/posix-shell.mjs quotedArgv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotedArgv } from '../posix-shell.mjs';

test('returns an empty array when the input is null', () => {
  assert.deepEqual(quotedArgv(null), []);
});

test('returns an empty array when the input is an empty string', () => {
  assert.deepEqual(quotedArgv(''), []);
});

test('returns a single argument for a single unquoted word', () => {
  assert.deepEqual(quotedArgv('hello'), ["hello"]);
});

test('splits multiple unquoted words into separate arguments', () => {
  assert.deepEqual(quotedArgv('a b c'), ["a", "b", "c"]);
});

test('collapses multiple spaces between words into a single separator', () => {
  assert.deepEqual(quotedArgv('a   b'), ["a", "b"]);
});

test('treats a quoted word as a single argument', () => {
  assert.deepEqual(quotedArgv('"hello"'), ["hello"]);
});

test('keeps spaces inside double quotes as part of the argument', () => {
  assert.deepEqual(quotedArgv('"hello world"'), ["hello world"]);
});

test('splits a quoted word from an unquoted word', () => {
  assert.deepEqual(quotedArgv('"hello" world'), ["hello", "world"]);
});

test('treats two consecutive quotes as a deliberate empty argument', () => {
  assert.deepEqual(quotedArgv('""'), [""]);
});

test('handles a quoted word followed by an unquoted word with no space', () => {
  assert.deepEqual(quotedArgv('"hello"world'), ["helloworld"]);
});
