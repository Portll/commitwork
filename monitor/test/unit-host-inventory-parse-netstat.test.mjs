// Extracts bound TCP/UDP ports from netstat output (monitor/host-inventory.mjs parseNetstat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetstat } from '../host-inventory.mjs';

test('parses a single TCP listener on port 8080', () => {
  const input = 'tcp4 0 0 127.0.0.1.8080 *.* LISTEN';
  const result = parseNetstat(input);
  assert.deepEqual(result, new Set(['8080/TCP']));
});

test('parses a UDP socket bound to wildcard', () => {
  const input = 'udp4 0 0 *.5353 *.*';
  const result = parseNetstat(input);
  assert.deepEqual(result, new Set(['5353/UDP']));
});

test('ignores established TCP connections', () => {
  const input = 'tcp4 0 0 192.168.1.1.443 10.0.0.1.51234 ESTABLISHED';
  const result = parseNetstat(input);
  assert.deepEqual(result, new Set());
});

test('ignores connected UDP sockets with peer address', () => {
  const input = 'udp4 0 0 192.168.1.1.123 10.0.0.1.53';
  const result = parseNetstat(input);
  assert.deepEqual(result, new Set());
});

test('ignores non-socket protocol lines', () => {
  const input = 'ip6 0 0 ::1.8080 *.* LISTEN';
  const result = parseNetstat(input);
  assert.deepEqual(result, new Set());
});

test('handles multiple listeners and deduplicates', () => {
  const input = [
    'tcp4 0 0 0.0.0.0.8080 *.* LISTEN',
    'tcp4 0 0 127.0.0.1.8080 *.* LISTEN',
    'udp4 0 0 *.5353 *.*'
  ].join('\n');
  const result = parseNetstat(input);
  assert.deepEqual(result, new Set(['8080/TCP', '5353/UDP']));
});

test('returns empty set for null input', () => {
  const result = parseNetstat(null);
  assert.deepEqual(result, new Set());
});

test('returns empty set for empty string', () => {
  const result = parseNetstat('');
  assert.deepEqual(result, new Set());
});

test('ignores lines with fewer than 5 fields', () => {
  const input = 'tcp4 0 0 127.0.0.1.8080';
  const result = parseNetstat(input);
  assert.deepEqual(result, new Set());
});

test('parses IPv6 TCP listener', () => {
  const input = 'tcp6 0 0 ::1.8080 ::1 LISTEN';
  const result = parseNetstat(input);
  assert.deepEqual(result, new Set(['8080/TCP']));
});
