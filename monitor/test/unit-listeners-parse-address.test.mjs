// Parses lsof NAME field into address, port, and portLabel (monitor/listeners.mjs parseAddress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress } from '../listeners.mjs';

test('returns null for empty string', () => {
  assert.deepEqual(parseAddress(''), null);
});

test('returns null for arrow notation', () => {
  assert.deepEqual(parseAddress('127.0.0.1:8080->10.0.0.1:443'), null);
});

test('returns null for non-address string', () => {
  assert.deepEqual(parseAddress('tcp'), null);
});

test('parses wildcard address', () => {
  assert.deepEqual(parseAddress('*:8081'), { address: "*", port: 8081, portLabel: "8081" });
});

test('parses IPv4 address', () => {
  assert.deepEqual(parseAddress('127.0.0.1:8099'), { address: "127.0.0.1", port: 8099, portLabel: "8099" });
});

test('parses IPv6 loopback', () => {
  assert.deepEqual(parseAddress('[::1]:9229'), { address: "::1", port: 9229, portLabel: "9229" });
});

test('parses IPv6 wildcard', () => {
  assert.deepEqual(parseAddress('[::]:8080'), { address: "::", port: 8080, portLabel: "8080" });
});

test('returns null for null input', () => {
  assert.deepEqual(parseAddress(null), null);
});
