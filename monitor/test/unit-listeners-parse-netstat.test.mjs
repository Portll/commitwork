// Parses netstat output into listener rows with binding classification and ephemeral flags (monitor/listeners.mjs parseNetstat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetstat } from '../listeners.mjs';

test('parses a listening TCP row with a loopback address', () => {
  const stdout = 'Active\r\n  TCP    127.0.0.1:8080    0.0.0.0:0    LISTENING    1234\r\n';
  const r = parseNetstat(stdout, new Map([[1234, 'node']]));
  assert.deepEqual(r, { rows: [{ command: "node", pid: 1234, user: null, fd: null, family: "IPv4", proto: "TCP", address: "127.0.0.1", port: 8080, portLabel: "8080", binding: "loopback", ephemeral: false }], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }] });
});

test('parses a wildcard UDP row with no peer', () => {
  const stdout = 'Active\r\n  UDP    0.0.0.0:5353    0.0.0.0:0    5678\r\n';
  const r = parseNetstat(stdout, new Map([[5678, 'avahi']]));
  assert.deepEqual(r, { rows: [{ command: "avahi", pid: 5678, user: null, fd: null, family: "IPv4", proto: "UDP", address: "0.0.0.0", port: 5353, portLabel: "5353", binding: "wildcard", ephemeral: false }], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }] });
});

test('parses an IPv6 wildcard UDP row with no peer', () => {
  const stdout = 'Active\r\n  UDP    [::]:5353    [::]:0    5678\r\n';
  const r = parseNetstat(stdout, new Map([[5678, 'avahi']]));
  assert.deepEqual(r, { rows: [{ command: "avahi", pid: 5678, user: null, fd: null, family: "IPv6", proto: "UDP", address: "::", port: 5353, portLabel: "5353", binding: "wildcard", ephemeral: false }], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }] });
});

test('excludes a connected UDP row with a non-zero peer', () => {
  const stdout = 'Active\r\n  UDP    192.168.1.5:53    8.8.8.8:53    9999\r\n';
  const r = parseNetstat(stdout, new Map([[9999, 'dns']]));
  assert.deepEqual(r, { rows: [], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }, { line: "  UDP    192.168.1.5:53    8.8.8.8:53    9999", why: "UDP row is a connected socket, not a bound port", kind: "excluded" }] });
});

test('excludes a non-listening TCP row with a peer', () => {
  const stdout = 'Active\r\n  TCP    192.168.1.5:443    10.0.0.1:51234    ESTABLISHED    1111\r\n';
  const r = parseNetstat(stdout, new Map([[1111, 'nginx']]));
  assert.deepEqual(r, { rows: [], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }, { line: "  TCP    192.168.1.5:443    10.0.0.1:51234    ESTABLISHED    1111", why: "not a listening TCP row", kind: "excluded" }] });
});

test('excludes a TCP row with a zero peer even if state is not LISTENING', () => {
  const stdout = 'Active\r\n  TCP    10.0.0.1:80    0.0.0.0:0    TIME_WAIT    2222\r\n';
  const r = parseNetstat(stdout, new Map([[2222, 'httpd']]));
  assert.deepEqual(r, { rows: [{ command: "httpd", pid: 2222, user: null, fd: null, family: "IPv4", proto: "TCP", address: "10.0.0.1", port: 80, portLabel: "80", binding: "interface", ephemeral: false }], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }] });
});

test('drops a line with a non-numeric first field as unparsed', () => {
  const stdout = 'Active\r\n  ICMP   127.0.0.1:80    0.0.0.0:0    LISTENING    3333\r\n';
  const r = parseNetstat(stdout, new Map());
  assert.deepEqual(r, { rows: [], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }, { line: "  ICMP   127.0.0.1:80    0.0.0.0:0    LISTENING    3333", why: "first field 'ICMP' is not TCP or UDP", kind: "unparsed" }] });
});

test('drops a TCP row with too few fields as unparsed', () => {
  const stdout = 'Active\r\n  TCP    127.0.0.1:80    0.0.0.0:0\r\n';
  const r = parseNetstat(stdout, new Map());
  assert.deepEqual(r, { rows: [], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }, { line: "  TCP    127.0.0.1:80    0.0.0.0:0", why: "TCP row has 3 fields, expected 5", kind: "unparsed" }] });
});

test('drops a row with a non-numeric PID as unparsed', () => {
  const stdout = 'Active\r\n  TCP    127.0.0.1:80    0.0.0.0:0    LISTENING    abc\r\n';
  const r = parseNetstat(stdout, new Map());
  assert.deepEqual(r, { rows: [], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }, { line: "  TCP    127.0.0.1:80    0.0.0.0:0    LISTENING    abc", why: "PID field 'abc' is not numeric", kind: "unparsed" }] });
});

test('excludes a row whose local address names no port', () => {
  const stdout = 'Active\r\n  TCP    127.0.0.1:*    0.0.0.0:0    LISTENING    4444\r\n';
  const r = parseNetstat(stdout, new Map([[4444, 'svc']]));
  assert.deepEqual(r, { rows: [], skipped: [{ line: "Active", why: "first field 'Active' is not TCP or UDP", kind: "unparsed" }, { line: "  TCP    127.0.0.1:*    0.0.0.0:0    LISTENING    4444", why: "'127.0.0.1:*' names no port at all", kind: "excluded" }] });
});
