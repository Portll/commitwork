// Parses pid/ppid/comm lines into a map keyed by pid (monitor/process-ancestry.mjs parsePidPpidComm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePidPpidComm } from '../process-ancestry.mjs';

test('returns an empty map for null input', () => {
  const r = parsePidPpidComm(null);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map for undefined input', () => {
  const r = parsePidPpidComm(undefined);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map for an empty string', () => {
  const r = parsePidPpidComm('');
  assert.deepEqual(r, new Map([]));
});

test('parses a single valid line into a map entry keyed by pid', () => {
  const r = parsePidPpidComm('1 0 init');
  assert.deepEqual(r, new Map([[1, { ppid: 0, comm: "init" }]]));
});

test('parses multiple lines and keeps the last entry for duplicate pids', () => {
  const r = parsePidPpidComm('1 0 init\n2 1 bash\n1 0 systemd');
  assert.deepEqual(r, new Map([[1, { ppid: 0, comm: "systemd" }], [2, { ppid: 1, comm: "bash" }]]));
});

test('skips lines that do not match the pid ppid comm pattern', () => {
  const r = parsePidPpidComm('garbage\n1 0 init\n  2 1 bash  ');
  assert.deepEqual(r, new Map([[1, { ppid: 0, comm: "init" }], [2, { ppid: 1, comm: "bash" }]]));
});

test('trims trailing whitespace from the comm field', () => {
  const r = parsePidPpidComm('10 5  node   ');
  assert.deepEqual(r, new Map([[10, { ppid: 5, comm: "node" }]]));
});

test('handles a line with extra internal spaces between fields', () => {
  const r = parsePidPpidComm('  7   3   chrome  ');
  assert.deepEqual(r, new Map([[7, { ppid: 3, comm: "chrome" }]]));
});
