// Validates URL scheme and host for safe delivery (bin/digest-deliver.mjs urlProblem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlProblem } from '../digest-deliver.mjs';

test('returns null for valid https URL', () => {
  assert.equal(urlProblem('https://example.com/path'), null);
});

test('returns null for http URL to localhost', () => {
  assert.equal(urlProblem('http://localhost:8080/path'), null);
});

test('returns null for http URL to 127.0.0.1', () => {
  assert.equal(urlProblem('http://127.0.0.1:3000/path'), null);
});

test('returns null for http URL to IPv6 loopback', () => {
  assert.equal(urlProblem('http://[::1]:8080/path'), null);
});

test('returns error for http URL to non-loopback host', () => {
  assert.equal(urlProblem('http://example.com/path'), 'scheme http: refused (https required off loopback)');
});

test('returns error for URL with username', () => {
  assert.equal(urlProblem('https://user@example.com/path'), 'URL carries credentials in its authority');
});

test('returns error for URL with password', () => {
  assert.equal(urlProblem('https://user:pass@example.com/path'), 'URL carries credentials in its authority');
});

test('returns not a URL for invalid input', () => {
  assert.equal(urlProblem('not-a-url'), 'not a URL');
});

test('returns error for ftp scheme', () => {
  assert.equal(urlProblem('ftp://example.com/file'), 'scheme ftp: refused (https required off loopback)');
});
