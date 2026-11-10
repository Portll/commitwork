// Parses a CONNECT target line into host and port (bin/egress-proxy.mjs connectTarget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectTarget } from '../egress-proxy.mjs';

test('returns host and port for a valid target with explicit port', () => {
  const r = connectTarget('example.com:8080');
  assert.deepEqual(r, { host: "example.com", port: 8080 });
});

test('returns host and default port 443 when no port is given', () => {
  const r = connectTarget('example.com');
  assert.deepEqual(r, { host: "example.com", port: 443 });
});

test('returns null when the port is zero', () => {
  const r = connectTarget('example.com:0');
  assert.equal(r, null);
});

test('returns null when the port is 65536', () => {
  const r = connectTarget('example.com:65536');
  assert.equal(r, null);
});

test('returns host and port 65535 for the maximum valid port', () => {
  const r = connectTarget('example.com:65535');
  assert.deepEqual(r, { host: "example.com", port: 65535 });
});

test('returns host and port 1 for the minimum valid port', () => {
  const r = connectTarget('example.com:1');
  assert.deepEqual(r, { host: "example.com", port: 1 });
});

test('returns null when the line is not a valid URL', () => {
  const r = connectTarget('not a url');
  assert.equal(r, null);
});

test('returns null when the hostname is empty', () => {
  const r = connectTarget(':8080');
  assert.equal(r, null);
});
