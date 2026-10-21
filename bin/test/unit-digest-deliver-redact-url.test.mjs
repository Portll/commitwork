// Redacts a URL to protocol, host, and ellipsis (bin/digest-deliver.mjs redactUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl } from '../digest-deliver.mjs';

test('redacts a standard https URL to protocol host and ellipsis', () => {
  assert.equal(redactUrl('https://example.com/path?q=1'), 'https://example.com/\u2026');
});

test('redacts an http URL with port to protocol host and ellipsis', () => {
  assert.equal(redactUrl('http://localhost:8080/api'), 'http://localhost:8080/\u2026');
});

test('redacts a URL with userinfo to protocol host and ellipsis', () => {
  assert.equal(redactUrl('https://user:pass@example.com/secret'), 'https://example.com/\u2026');
});

test('returns unparseable URL for empty string', () => {
  assert.equal(redactUrl(''), '(unparseable URL)');
});

test('returns unparseable URL for text that is not a URL', () => {
  assert.equal(redactUrl('not a url'), '(unparseable URL)');
});

test('redacts a URL with fragment to protocol host and ellipsis', () => {
  assert.equal(redactUrl('https://example.com/page#section'), 'https://example.com/\u2026');
});

test('redacts a URL with multiple path segments to protocol host and ellipsis', () => {
  assert.equal(redactUrl('https://sub.domain.co/a/b/c'), 'https://sub.domain.co/\u2026');
});

test('returns unparseable URL for relative path', () => {
  assert.equal(redactUrl('/relative/path'), '(unparseable URL)');
});
