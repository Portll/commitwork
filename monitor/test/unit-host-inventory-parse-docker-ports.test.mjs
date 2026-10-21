// Extracts published host port bindings from docker ps output (monitor/host-inventory.mjs parseDockerPorts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDockerPorts } from '../host-inventory.mjs';

test('parses a single published port with an IPv4 host address', () => {
  const input = 'mycontainer\t127.0.0.1:8095->8080/tcp';
  const result = parseDockerPorts(input);
  assert.deepEqual(result, [
    { container: 'mycontainer', address: '127.0.0.1', port: 8095, proto: 'TCP' }
  ]);
});

test('parses multiple comma-separated port mappings for one container', () => {
  const input = 'web\t0.0.0.0:54339->6543/tcp, 0.0.0.0:54340->6544/tcp';
  const result = parseDockerPorts(input);
  assert.deepEqual(result, [
    { container: 'web', address: '0.0.0.0', port: 54339, proto: 'TCP' },
    { container: 'web', address: '0.0.0.0', port: 54340, proto: 'TCP' }
  ]);
});

test('parses an IPv6 host address enclosed in brackets', () => {
  const input = 'db\t[::]:54339->6543/tcp';
  const result = parseDockerPorts(input);
  assert.deepEqual(result, [
    { container: 'db', address: '::', port: 54339, proto: 'TCP' }
  ]);
});

test('ignores exposed ports that are not published to the host', () => {
  const input = 'app\t8080/tcp';
  const result = parseDockerPorts(input);
  assert.deepEqual(result, []);
});

test('returns an empty array for null or undefined input', () => {
  assert.deepEqual(parseDockerPorts(null), []);
  assert.deepEqual(parseDockerPorts(undefined), []);
});

test('returns an empty array for empty string input', () => {
  assert.deepEqual(parseDockerPorts(''), []);
});

test('skips lines that do not contain a tab separator', () => {
  const input = 'no-tab-line\nvalid\t127.0.0.1:80->80/tcp';
  const result = parseDockerPorts(input);
  assert.deepEqual(result, [
    { container: 'valid', address: '127.0.0.1', port: 80, proto: 'TCP' }
  ]);
});

test('parses UDP protocol and uppercases it', () => {
  const input = 'dns\t127.0.0.1:53->53/udp';
  const result = parseDockerPorts(input);
  assert.deepEqual(result, [
    { container: 'dns', address: '127.0.0.1', port: 53, proto: 'UDP' }
  ]);
});

test('handles multiple containers in the input', () => {
  const input = 'svc1\t127.0.0.1:8080->80/tcp\nsvc2\t0.0.0.0:9090->90/tcp';
  const result = parseDockerPorts(input);
  assert.deepEqual(result, [
    { container: 'svc1', address: '127.0.0.1', port: 8080, proto: 'TCP' },
    { container: 'svc2', address: '0.0.0.0', port: 9090, proto: 'TCP' }
  ]);
});

test('ignores malformed port mapping segments', () => {
  const input = 'bad\t127.0.0.1:80->80/tcp, not-a-port, 0.0.0.0:81->81/tcp';
  const result = parseDockerPorts(input);
  assert.deepEqual(result, [
    { container: 'bad', address: '127.0.0.1', port: 80, proto: 'TCP' },
    { container: 'bad', address: '0.0.0.0', port: 81, proto: 'TCP' }
  ]);
});
