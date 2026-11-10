// Detects shell, inline-code, and unpinned npx invocations (bin/agent-config.mjs commandShell).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandShell } from '../agent-config.mjs';

test('returns shell message for bash', () => {
  assert.equal(commandShell('bash', ['-c', 'ls']), 'command is bash');
});

test('returns shell message for curl', () => {
  assert.equal(commandShell('curl', ['http://x']), 'command is curl');
});

test('returns empty string for git', () => {
  assert.equal(commandShell('git', ['status']), '');
});

test('returns empty string for node without eval flags', () => {
  assert.equal(commandShell('node', ['script.js']), '');
});

test('returns inline code message for node with -e', () => {
  assert.equal(commandShell('node', ['-e', 'console.log(1)']), 'node evaluates inline code');
});

test('returns inline code message for deno with --eval', () => {
  assert.equal(commandShell('deno', ['--eval', 'x']), 'deno evaluates inline code');
});

test('returns inline code message for bun with -p', () => {
  assert.equal(commandShell('bun', ['-p', 'x']), 'bun evaluates inline code');
});

test('returns inline code message for python with -c', () => {
  assert.equal(commandShell('python', ['-c', 'print(1)']), 'python evaluates inline code');
});

test('returns inline code message for python3 with -c', () => {
  assert.equal(commandShell('python3', ['-c', 'print(1)']), 'python3 evaluates inline code');
});

test('returns empty string for python without -c', () => {
  assert.equal(commandShell('python', ['script.py']), '');
});

test('returns unpinned package message for npx with unpinned package', () => {
  assert.equal(commandShell('npx', ['lodash']), 'npx runs unpinned package lodash');
});

test('returns empty string for npx with pinned package', () => {
  assert.equal(commandShell('npx', ['lodash@4.17.21']), '');
});

test('returns empty string for npx with local spec', () => {
  assert.equal(commandShell('npx', ['./local-tool']), '');
});

test('returns empty string for npx with no package', () => {
  assert.equal(commandShell('npx', []), '');
});

test('returns shell message for .exe extension', () => {
  assert.equal(commandShell('bash.exe', []), 'command is bash');
});

test('returns empty string for empty command', () => {
  assert.equal(commandShell('', []), '');
});

test('returns empty string for null command', () => {
  assert.equal(commandShell(null, []), '');
});

test('returns empty string for undefined command', () => {
  assert.equal(commandShell(undefined, []), '');
});

test('returns shell message for zsh', () => {
  assert.equal(commandShell('zsh', []), 'command is zsh');
});

test('returns shell message for fish', () => {
  assert.equal(commandShell('fish', []), 'command is fish');
});
