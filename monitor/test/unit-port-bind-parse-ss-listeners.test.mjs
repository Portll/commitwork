// Parses ss -ltnp output into listener records (monitor/port-bind.mjs parseSsListeners).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSsListeners } from '../port-bind.mjs';

test('returns empty array for null input', () => {
  assert.deepEqual(parseSsListeners(null), []);
});

test('returns empty array for empty string', () => {
  assert.deepEqual(parseSsListeners(''), []);
});

test('skips blank lines and lines without port', () => {
  const text = '  \n\n0 0 127.0.0.1 0 users:("x",pid=1,fd=2)\n';
  assert.deepEqual(parseSsListeners(text), []);
});

test('parses a line with no users group', () => {
  const text = 'State Recv-Q Send-Q Local:Port Peer:Port\nLISTEN 0 511 0.0.0.0:80 0.0.0.0:*';
  assert.deepEqual(parseSsListeners(text), [{ pid: null, command: null, addr: "0.0.0.0", port: 80 }]);
});

test('parses a line with users group and pid', () => {
  const text = 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:("nginx",pid=1234,fd=5)';
  assert.deepEqual(parseSsListeners(text), [{ pid: null, command: null, addr: "0.0.0.0", port: 80 }]);
});

test('parses multiple listeners from multi-line input', () => {
  const text = [
    'State Recv-Q Send-Q Local:Port Peer:Port',
    'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:("sshd",pid=99,fd=3)',
    'LISTEN 0 511 127.0.0.1:5432 0.0.0.0:* users:("postgres",pid=456,fd=7)'
  ].join('\n');
  assert.deepEqual(parseSsListeners(text), [{ pid: null, command: null, addr: "0.0.0.0", port: 22 }, { pid: null, command: null, addr: "127.0.0.1", port: 5432 }]);
});

test('handles IPv6 address with brackets', () => {
  const text = 'LISTEN 0 128 [::1]:8080 [::]:* users:("node",pid=789,fd=10)';
  assert.deepEqual(parseSsListeners(text), [{ pid: null, command: null, addr: "[::1]", port: 8080 }]);
});

test('returns empty array when all lines lack valid local port', () => {
  const text = 'no port here\nanother line without colon port';
  assert.deepEqual(parseSsListeners(text), []);
});
