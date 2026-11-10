// Formats listener rows into a fixed-width table with counts and warnings (monitor/listeners.mjs formatTable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTable } from '../listeners.mjs';

test('returns unknown message when result is null', () => {
  assert.equal(formatTable(null), "listeners: UNKNOWN \u2014 no result\n  (this is NOT \"nothing is listening\". Nothing was observed, so nothing is claimed.)");
});

test('returns unknown message when result is undefined', () => {
  assert.equal(formatTable(undefined), "listeners: UNKNOWN \u2014 no result\n  (this is NOT \"nothing is listening\". Nothing was observed, so nothing is claimed.)");
});

test('returns unknown message when ok is false with reason', () => {
  assert.equal(formatTable({ ok: false, reason: 'boom' }), "listeners: UNKNOWN \u2014 boom\n  (this is NOT \"nothing is listening\". Nothing was observed, so nothing is claimed.)");
});

test('returns unknown message when ok is false without reason', () => {
  assert.equal(formatTable({ ok: false }), "listeners: UNKNOWN \u2014 no result\n  (this is NOT \"nothing is listening\". Nothing was observed, so nothing is claimed.)");
});

test('renders table with one row and no skipped lines', () => {
  const r = {
    ok: true,
    rows: [{ proto: 'TCP', ephemeral: false, binding: 'loopback', address: '127.0.0.1', portLabel: '8080', command: 'node', pid: 123, family: 'IPv4' }],
    counts: { total: 1, external: 0, tcp: 1, udp: 0, ephemeral: 0, loopback: 1, wildcard: 0, interface: 0 },
    skipped: []
  };
  assert.equal(formatTable(r), "PROTO  BINDING   ADDRESS    PORT  PROC  PID  FAM\n-----  --------  ---------  ----  ----  ---  ----\nTCP    loopback  127.0.0.1  8080  node  123  IPv4\n\n1 bound socket(s) \u2014 1 TCP, 0 UDP \u2014 0 EXTERNALLY BOUND (0 wildcard, 0 interface), 1 loopback.");
});

test('renders table with ephemeral row and skipped lines', () => {
  const r = {
    ok: true,
    rows: [
      { proto: 'UDP', ephemeral: true, binding: 'wildcard', address: '*', portLabel: '40000', command: 'node', pid: 456, family: 'IPv4' },
      { proto: 'TCP', ephemeral: false, binding: 'interface', address: '192.168.1.5', portLabel: '22', command: 'sshd', pid: 789, family: 'IPv4' }
    ],
    counts: { total: 2, external: 2, tcp: 1, udp: 1, ephemeral: 1, loopback: 0, wildcard: 1, interface: 1 },
    skipped: [
      { line: 'some line', why: 'not a (LISTEN) row', kind: 'excluded' },
      { line: 'bad line', why: 'expected >=9 whitespace fields, got 3', kind: 'unparsed' }
    ]
  };
  assert.equal(formatTable(r), "PROTO  BINDING    ADDRESS      PORT   PROC  PID  FAM\n-----  ---------  -----------  -----  ----  ---  ----\nUDP*   wildcard   *            40000  node  456  IPv4\nTCP    interface  192.168.1.5  22     sshd  789  IPv4\n\n2 bound socket(s) \u2014 1 TCP, 1 UDP \u2014 2 EXTERNALLY BOUND (1 wildcard, 1 interface), 0 loopback.\n1 marked * are UDP sockets in the ephemeral range (>= 32768) \u2014 transient client sockets, not services. They are shown because they were observed, and must not be read as owned ports.\nEXTERNALLY BOUND \u2014 reachable from off-box, and NOT covered by any tunnel/ingress declaration:\n  *:40000  node (pid 456)\n  192.168.1.5:22  sshd (pid 789)\n1 line(s) understood and excluded \u2014 not bound ports (first: not a (LISTEN) row)\n1 line(s) NOT UNDERSTOOD by the parser (first: expected >=9 whitespace fields, got 3)");
});

test('renders table with external rows and excluded skipped lines', () => {
  const r = {
    ok: true,
    rows: [
      { proto: 'TCP', ephemeral: false, binding: 'wildcard', address: '*', portLabel: '443', command: 'nginx', pid: 100, family: 'IPv4' },
      { proto: 'TCP', ephemeral: false, binding: 'loopback', address: '127.0.0.1', portLabel: '3000', command: 'node', pid: 200, family: 'IPv4' }
    ],
    counts: { total: 2, external: 1, tcp: 2, udp: 0, ephemeral: 0, loopback: 1, wildcard: 1, interface: 0 },
    skipped: [
      { line: 'udp line', why: 'UDP row is a connected socket, not a bound port', kind: 'excluded' },
      { line: 'tcp line', why: 'not a (LISTEN) row', kind: 'excluded' }
    ]
  };
  assert.equal(formatTable(r), "PROTO  BINDING   ADDRESS    PORT  PROC   PID  FAM\n-----  --------  ---------  ----  -----  ---  ----\nTCP    wildcard  *          443   nginx  100  IPv4\nTCP    loopback  127.0.0.1  3000  node   200  IPv4\n\n2 bound socket(s) \u2014 2 TCP, 0 UDP \u2014 1 EXTERNALLY BOUND (1 wildcard, 0 interface), 1 loopback.\nEXTERNALLY BOUND \u2014 reachable from off-box, and NOT covered by any tunnel/ingress declaration:\n  *:443  nginx (pid 100)\n2 line(s) understood and excluded \u2014 not bound ports (first: UDP row is a connected socket, not a bound port)");
});

test('renders table with unparsed skipped lines only', () => {
  const r = {
    ok: true,
    rows: [{ proto: 'TCP', ephemeral: false, binding: 'loopback', address: '127.0.0.1', portLabel: '80', command: 'httpd', pid: 50, family: 'IPv4' }],
    counts: { total: 1, external: 0, tcp: 1, udp: 0, ephemeral: 0, loopback: 1, wildcard: 0, interface: 0 },
    skipped: [
      { line: 'garbage', why: 'PID field is not numeric', kind: 'unparsed' },
      { line: 'more garbage', why: 'NAME is not address:port', kind: 'unparsed' }
    ]
  };
  assert.equal(formatTable(r), "PROTO  BINDING   ADDRESS    PORT  PROC   PID  FAM\n-----  --------  ---------  ----  -----  ---  ----\nTCP    loopback  127.0.0.1  80    httpd  50   IPv4\n\n1 bound socket(s) \u2014 1 TCP, 0 UDP \u2014 0 EXTERNALLY BOUND (0 wildcard, 0 interface), 1 loopback.\n2 line(s) NOT UNDERSTOOD by the parser (first: PID field is not numeric)");
});

test('renders table with no skipped lines property', () => {
  const r = {
    ok: true,
    rows: [{ proto: 'UDP', ephemeral: false, binding: 'loopback', address: '127.0.0.1', portLabel: '53', command: 'dnsmasq', pid: 60, family: 'IPv4' }],
    counts: { total: 1, external: 0, tcp: 0, udp: 1, ephemeral: 0, loopback: 1, wildcard: 0, interface: 0 }
  };
  assert.equal(formatTable(r), "PROTO  BINDING   ADDRESS    PORT  PROC     PID  FAM\n-----  --------  ---------  ----  -------  ---  ----\nUDP    loopback  127.0.0.1  53    dnsmasq  60   IPv4\n\n1 bound socket(s) \u2014 0 TCP, 1 UDP \u2014 0 EXTERNALLY BOUND (0 wildcard, 0 interface), 1 loopback.");
});
