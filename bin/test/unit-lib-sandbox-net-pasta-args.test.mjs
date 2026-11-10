// Builds the pasta CLI argument array for a sandboxed process (bin/lib/sandbox-net.mjs pastaArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pastaArgs } from '../lib/sandbox-net.mjs';

test('returns the full argument list with defaults and no optional interfaces', () => {
  const r = pastaArgs({ pid: 1, pidFile: '/tmp/p' });
  assert.deepEqual(r, ["--config-net", "--quiet", "--foreground", "--no-map-gw", "--tcp-ports", "none", "--udp-ports", "none", "--tcp-ns", "none", "--udp-ns", "none", "--dns-forward", "169.254.1.1", "--pid", "/tmp/p", "1"]);
});

test('joins multiple loopback entries into a single tcp-ns value', () => {
  const r = pastaArgs({ pid: 2, loopback: ['127.0.0.1', '127.0.0.2'], pidFile: '/tmp/p' });
  assert.deepEqual(r, ["--config-net", "--quiet", "--foreground", "--no-map-gw", "--tcp-ports", "none", "--udp-ports", "none", "--tcp-ns", "127.0.0.1,127.0.0.2", "--udp-ns", "none", "--dns-forward", "169.254.1.1", "--pid", "/tmp/p", "2"]);
});

test('includes outbound interface flags when v4 and v6 are provided', () => {
  const r = pastaArgs({ pid: 3, v4: 'eth0', v6: 'eth1', pidFile: '/tmp/p' });
  assert.deepEqual(r, ["--config-net", "--quiet", "--foreground", "--no-map-gw", "--tcp-ports", "none", "--udp-ports", "none", "--tcp-ns", "none", "--udp-ns", "none", "--dns-forward", "169.254.1.1", "--outbound-if4", "eth0", "--outbound-if6", "eth1", "--pid", "/tmp/p", "3"]);
});

test('omits outbound interface flags when v4 and v6 are null', () => {
  const r = pastaArgs({ pid: 4, v4: null, v6: null, pidFile: '/tmp/p' });
  assert.deepEqual(r, ["--config-net", "--quiet", "--foreground", "--no-map-gw", "--tcp-ports", "none", "--udp-ports", "none", "--tcp-ns", "none", "--udp-ns", "none", "--dns-forward", "169.254.1.1", "--pid", "/tmp/p", "4"]);
});

test('uses none for tcp-ns when loopback is empty', () => {
  const r = pastaArgs({ pid: 5, loopback: [], pidFile: '/tmp/p' });
  assert.deepEqual(r, ["--config-net", "--quiet", "--foreground", "--no-map-gw", "--tcp-ports", "none", "--udp-ports", "none", "--tcp-ns", "none", "--udp-ns", "none", "--dns-forward", "169.254.1.1", "--pid", "/tmp/p", "5"]);
});

test('includes only v4 outbound flag when v6 is null', () => {
  const r = pastaArgs({ pid: 6, v4: 'wlan0', v6: null, pidFile: '/tmp/p' });
  assert.deepEqual(r, ["--config-net", "--quiet", "--foreground", "--no-map-gw", "--tcp-ports", "none", "--udp-ports", "none", "--tcp-ns", "none", "--udp-ns", "none", "--dns-forward", "169.254.1.1", "--outbound-if4", "wlan0", "--pid", "/tmp/p", "6"]);
});

test('includes only v6 outbound flag when v4 is null', () => {
  const r = pastaArgs({ pid: 7, v4: null, v6: 'wlan1', pidFile: '/tmp/p' });
  assert.deepEqual(r, ["--config-net", "--quiet", "--foreground", "--no-map-gw", "--tcp-ports", "none", "--udp-ports", "none", "--tcp-ns", "none", "--udp-ns", "none", "--dns-forward", "169.254.1.1", "--outbound-if6", "wlan1", "--pid", "/tmp/p", "7"]);
});

test('serializes the pid as a string in the argument list', () => {
  const r = pastaArgs({ pid: 12345, pidFile: '/var/run/pasta.pid' });
  assert.deepEqual(r, ["--config-net", "--quiet", "--foreground", "--no-map-gw", "--tcp-ports", "none", "--udp-ports", "none", "--tcp-ns", "none", "--udp-ns", "none", "--dns-forward", "169.254.1.1", "--pid", "/var/run/pasta.pid", "12345"]);
});
