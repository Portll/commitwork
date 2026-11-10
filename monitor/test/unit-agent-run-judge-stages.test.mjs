// Splits a command string into pipelines of stages with executable and environment info (monitor/agent-run-judge.mjs stages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stages } from '../agent-run-judge.mjs';

test('splits on semicolon and ampersand-ampersand into separate pipelines', () => {
  const r = stages('ls; cat file && grep x');
  assert.deepEqual(r, [[{ text: "ls", exe: "ls", envs: [] }], [{ text: "cat file", exe: "cat", envs: [] }], [{ text: "grep x", exe: "grep", envs: [] }]]);
});

test('splits on pipe into pipeline stages', () => {
  const r = stages('ls | grep foo');
  assert.deepEqual(r, [[{ text: "ls", exe: "ls", envs: [] }, { text: "grep foo", exe: "grep", envs: [] }]]);
});

test('splits on newline into separate pipelines', () => {
  const r = stages('ls\ncat file');
  assert.deepEqual(r, [[{ text: "ls", exe: "ls", envs: [] }], [{ text: "cat file", exe: "cat", envs: [] }]]);
});

test('extracts environment variables from prefix', () => {
  const r = stages('FOO=1 BAR=2 ls');
  assert.deepEqual(r, [[{ text: "ls", exe: "ls", envs: ["FOO=1", "BAR=2"] }]]);
});

test('resolves runner executable to the program argument', () => {
  const r = stages('node bin/commitwork.mjs --flag');
  assert.deepEqual(r, [[{ text: "node bin/commitwork.mjs --flag", exe: "commitwork.mjs", envs: [] }]]);
});

test('keeps runner executable when next word is a flag', () => {
  const r = stages('node --version');
  assert.deepEqual(r, [[{ text: "node --version", exe: "node", envs: [] }]]);
});

test('strips path from executable name', () => {
  const r = stages('/usr/bin/python3 script.py');
  assert.deepEqual(r, [[{ text: "/usr/bin/python3 script.py", exe: "script.py", envs: [] }]]);
});

test('returns empty array for empty command string', () => {
  const r = stages('');
  assert.deepEqual(r, []);
});

test('handles multiple pipes in a single pipeline', () => {
  const r = stages('ls | grep x | wc -l');
  assert.deepEqual(r, [[{ text: "ls", exe: "ls", envs: [] }, { text: "grep x", exe: "grep", envs: [] }, { text: "wc -l", exe: "wc", envs: [] }]]);
});

test('handles command with only whitespace', () => {
  const r = stages('   ');
  assert.deepEqual(r, []);
});
