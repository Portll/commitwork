// Extracts listening TCP sockets with pid, addr, and port from netstat output (monitor/port-bind.mjs parseNetstatListeners).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetstatListeners } from '../port-bind.mjs';

test('returns empty array for empty string input', () => {
  assert.deepEqual(parseNetstatListeners(''), []);
});

test('returns empty array for null input', () => {
  assert.deepEqual(parseNetstatListeners(null), []);
});

test('returns empty array for undefined input', () => {
  assert.deepEqual(parseNetstatListeners(undefined), []);
});

test('parses a single LISTENING TCP row with no peer', () => {
  const input = 'TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    1234';
  assert.deepEqual(parseNetstatListeners(input), [{ pid: 1234, command: null, addr: "0.0.0.0", port: 8080 }]);
});

test('parses a single LISTENING TCP row with a peer', () => {
  const input = 'TCP    127.0.0.1:3000    192.168.1.5:443    LISTENING    5678';
  assert.deepEqual(parseNetstatListeners(input), [{ pid: 5678, command: null, addr: "127.0.0.1", port: 3000 }]);
});

test('skips UDP rows', () => {
  const input = 'UDP    0.0.0.0:53    0.0.0.0:0    999';
  assert.deepEqual(parseNetstatListeners(input), []);
});

test('skips non-LISTENING TCP rows with a peer', () => {
  const input = 'TCP    127.0.0.1:3000    192.168.1.5:443    ESTABLISHED    5678';
  assert.deepEqual(parseNetstatListeners(input), []);
});

test('skips rows with fewer than five columns', () => {
  const input = 'TCP    0.0.0.0:8080    0.0.0.0:0';
  assert.deepEqual(parseNetstatListeners(input), []);
});

test('skips rows with non-integer pid', () => {
  const input = 'TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    abc';
  assert.deepEqual(parseNetstatListeners(input), []);
});

test('parses multiple valid rows and skips invalid ones', () => {
  const lines = [
    'TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    100',
    'UDP    0.0.0.0:53    0.0.0.0:0    200',
    'TCP    127.0.0.1:3000    192.168.1.5:443    ESTABLISHED    300',
    'TCP    10.0.0.1:9000    10.0.0.2:9001    LISTENING    400',
    'TCP    0.0.0.0:8081    0.0.0.0:0    LISTENING    xyz'
  ];
  const input = lines.join('\n');
  assert.deepEqual(parseNetstatListeners(input), [{ pid: 100, command: null, addr: "0.0.0.0", port: 8080 }, { pid: 400, command: null, addr: "10.0.0.1", port: 9000 }]);
});
