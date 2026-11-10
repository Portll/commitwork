// Extracts the lowercased hostname from a URL string (bin/agent-config.mjs hostOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf } from '../agent-config.mjs';

test('returns empty string for null input', () => {
  assert.equal(hostOf(null), '');
});

test('returns empty string for undefined input', () => {
  assert.equal(hostOf(undefined), '');
});

test('returns empty string for empty string', () => {
  assert.equal(hostOf(''), '');
});

test('returns empty string for non-URL string without scheme', () => {
  assert.equal(hostOf('example.com'), '');
});

test('returns lowercased host from http URL', () => {
  assert.equal(hostOf('http://Example.COM/path'), 'example.com');
});

test('returns lowercased host from https URL with port', () => {
  assert.equal(hostOf('https://EXAMPLE.com:8080'), 'example.com');
});

test('returns lowercased host from URL with userinfo', () => {
  assert.equal(hostOf('http://user:pass@EXAMPLE.com'), 'example.com');
});

test('returns lowercased host from URL with IPv6 address', () => {
  assert.equal(hostOf('http://[2001:DB8::1]:8080'), '2001:db8::1');
});

test('returns lowercased host from ftp URL', () => {
  assert.equal(hostOf('ftp://EXAMPLE.org'), 'example.org');
});

test('returns empty string for URL with invalid scheme', () => {
  assert.equal(hostOf('1http://example.com'), '');
});
