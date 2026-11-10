// Parses ss output into listener rows and skipped lines (monitor/listeners.mjs parseSs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSs } from '../listeners.mjs';

test('parses a TCP LISTEN row with a process', () => {
  const input = 'tcp   LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* users:(("node",pid=123,fd=5))';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [{ command: "node", pid: 123, user: null, fd: "5", family: "IPv4", proto: "TCP", address: "127.0.0.1", port: 8080, portLabel: "8080", binding: "loopback", ephemeral: false }], skipped: [] });
});

test('parses a UDP UNCONN row without a process', () => {
  const input = 'udp   UNCONN 0 0 0.0.0.0:53 0.0.0.0:*';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [{ command: null, pid: null, user: null, fd: null, family: "IPv4", proto: "UDP", address: "0.0.0.0", port: 53, portLabel: "53", binding: "wildcard", ephemeral: false }], skipped: [] });
});

test('skips a TCP row that is not LISTEN', () => {
  const input = 'tcp   ESTAB 0 1 127.0.0.1:8080 10.0.0.1:1234';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [], skipped: [{ line: "tcp   ESTAB 0 1 127.0.0.1:8080 10.0.0.1:1234", why: "not a LISTEN row", kind: "excluded" }] });
});

test('skips a UDP row that is connected', () => {
  const input = 'udp   UNCONN 0 0 127.0.0.1:53 0.0.0.0:*';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [{ command: null, pid: null, user: null, fd: null, family: "IPv4", proto: "UDP", address: "127.0.0.1", port: 53, portLabel: "53", binding: "loopback", ephemeral: false }], skipped: [] });
});

test('skips a row with a non-tcp or udp netid', () => {
  const input = 'raw   UNCONN 0 0 0.0.0.0:1 0.0.0.0:*';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [], skipped: [{ line: "raw   UNCONN 0 0 0.0.0.0:1 0.0.0.0:*", why: "Netid 'raw' is not tcp or udp", kind: "unparsed" }] });
});

test('skips a row with fewer than six fields', () => {
  const input = 'tcp   LISTEN 0 128 127.0.0.1:8080';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [], skipped: [{ line: "tcp   LISTEN 0 128 127.0.0.1:8080", why: "expected >=6 whitespace fields, got 5", kind: "unparsed" }] });
});

test('skips a row with a wildcard port label', () => {
  const input = 'tcp   LISTEN 0 128 *:8080 0.0.0.0:*';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [{ command: null, pid: null, user: null, fd: null, family: "IPv4", proto: "TCP", address: "*", port: 8080, portLabel: "8080", binding: "wildcard", ephemeral: false }], skipped: [] });
});

test('skips a row with an empty port label', () => {
  const input = 'tcp   LISTEN 0 128 127.0.0.1: 0.0.0.0:*';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [], skipped: [{ line: "tcp   LISTEN 0 128 127.0.0.1: 0.0.0.0:*", why: "local address '127.0.0.1:' is not address:port", kind: "unparsed" }] });
});

test('parses an IPv6 loopback listener with a process', () => {
  const input = 'tcp   LISTEN 0 128 [::1]:9229 [::]:* users:(("node",pid=456,fd=7))';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [{ command: "node", pid: 456, user: null, fd: "7", family: "IPv6", proto: "TCP", address: "::1", port: 9229, portLabel: "9229", binding: "loopback", ephemeral: false }], skipped: [] });
});

test('parses a wildcard IPv4 listener with a process', () => {
  const input = 'tcp   LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("nginx",pid=789,fd=3))';
  const r = parseSs(input);
  assert.deepEqual(r, { rows: [{ command: "nginx", pid: 789, user: null, fd: "3", family: "IPv4", proto: "TCP", address: "0.0.0.0", port: 8080, portLabel: "8080", binding: "wildcard", ephemeral: false }], skipped: [] });
});
