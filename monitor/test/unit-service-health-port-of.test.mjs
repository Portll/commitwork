// Extracts the port number from a service URL (monitor/service-health.mjs portOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portOf } from '../service-health.mjs';

test('returns the explicit port from an http URL', () => {
  assert.equal(portOf('http://example.com:8080/path'), 8080);
});

test('returns the explicit port from an https URL', () => {
  assert.equal(portOf('https://example.com:8443/api'), 8443);
});

test('returns 443 for an https URL without a port', () => {
  assert.equal(portOf('https://example.com/path'), 443);
});

test('returns 80 for an http URL without a port', () => {
  assert.equal(portOf('http://example.com/path'), 80);
});

test('returns null for a URL without a scheme', () => {
  assert.equal(portOf('example.com:8080'), null);
});

test('returns null for an empty string', () => {
  assert.equal(portOf(''), null);
});

test('returns null for undefined input', () => {
  assert.equal(portOf(undefined), null);
});

test('returns null for null input', () => {
  assert.equal(portOf(null), null);
});
