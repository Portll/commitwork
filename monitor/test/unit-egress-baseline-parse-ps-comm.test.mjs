// Maps pid to command string from ps output (monitor/egress-baseline.mjs parsePsComm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePsComm } from '../egress-baseline.mjs';

test('returns empty map for null input', () => {
  const r = parsePsComm(null);
  assert.deepEqual(r, new Map([]));
});

test('returns empty map for empty string', () => {
  const r = parsePsComm('');
  assert.deepEqual(r, new Map([]));
});

test('parses single pid and command', () => {
  const r = parsePsComm('1234 node server.js');
  assert.deepEqual(r, new Map([[1234, "node server.js"]]));
});

test('parses multiple pids with varying whitespace', () => {
  const r = parsePsComm('  100  cmd one\n200  cmd two\n300 cmd three');
  assert.deepEqual(r, new Map([[100, "cmd one"], [200, "cmd two"], [300, "cmd three"]]));
});

test('ignores lines without valid pid prefix', () => {
  const r = parsePsComm('PID COMMAND\n1234 node app.js\nno pid here');
  assert.deepEqual(r, new Map([[1234, "node app.js"]]));
});

test('handles command with trailing spaces', () => {
  const r = parsePsComm('555  node   server.js   ');
  assert.deepEqual(r, new Map([[555, "node   server.js"]]));
});

test('overwrites duplicate pid with last occurrence', () => {
  const r = parsePsComm('100 first\n100 second');
  assert.deepEqual(r, new Map([[100, "second"]]));
});

test('parses pid with leading zeros', () => {
  const r = parsePsComm('007  agent');
  assert.deepEqual(r, new Map([[7, "agent"]]));
});
