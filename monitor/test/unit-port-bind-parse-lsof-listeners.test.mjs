// Parses lsof -i output into listener records (monitor/port-bind.mjs parseLsofListeners).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLsofListeners } from '../port-bind.mjs';

test('returns an empty array for null input', () => {
  assert.deepEqual(parseLsofListeners(null), []);
});

test('returns an empty array for an empty string', () => {
  assert.deepEqual(parseLsofListeners(''), []);
});

test('parses a single listener with pid, command, and address', () => {
  const input = 'p123\ncnode\nn127.0.0.1:7878';
  assert.deepEqual(parseLsofListeners(input), [{ pid: 123, command: "node", addr: "127.0.0.1", port: 7878 }]);
});

test('parses a listener with a wildcard address', () => {
  const input = 'p456\ncpython\nn*:8000';
  assert.deepEqual(parseLsofListeners(input), [{ pid: 456, command: "python", addr: "*", port: 8000 }]);
});

test('parses a listener with an IPv6 address', () => {
  const input = 'p789\ncnginx\nn[::1]:7980';
  assert.deepEqual(parseLsofListeners(input), [{ pid: 789, command: "nginx", addr: "[::1]", port: 7980 }]);
});

test('resets command when a new pid line appears', () => {
  const input = 'p1\ncfirst\nn127.0.0.1:80\np2\ncsecond\nn127.0.0.1:81';
  assert.deepEqual(parseLsofListeners(input), [{ pid: 1, command: "first", addr: "127.0.0.1", port: 80 }, { pid: 2, command: "second", addr: "127.0.0.1", port: 81 }]);
});

test('ignores lines with unrecognized tags', () => {
  const input = 'p1\ncnode\nxfoo\nn127.0.0.1:90';
  assert.deepEqual(parseLsofListeners(input), [{ pid: 1, command: "node", addr: "127.0.0.1", port: 90 }]);
});

test('handles multiple listeners for the same pid', () => {
  const input = 'p100\ncnode\nn127.0.0.1:8000\nn127.0.0.1:8001';
  assert.deepEqual(parseLsofListeners(input), [{ pid: 100, command: "node", addr: "127.0.0.1", port: 8000 }, { pid: 100, command: "node", addr: "127.0.0.1", port: 8001 }]);
});
