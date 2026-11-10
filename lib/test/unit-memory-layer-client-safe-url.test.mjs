// Redacts userinfo credentials from a URL for safe display (lib/memory-layer-client.mjs safeUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl } from '../memory-layer-client.mjs';

test('returns the original string when the URL has no username or password', () => {
  const r = safeUrl('https://example.com/path');
  assert.equal(r, "https://example.com/path");
});

test('redacts the username and password when both are present', () => {
  const r = safeUrl('https://user:pass@example.com/path');
  assert.equal(r, "https://example.com/path (userinfo redacted)");
});

test('redacts the username when only a username is present', () => {
  const r = safeUrl('https://user@example.com/path');
  assert.equal(r, "https://example.com/path (userinfo redacted)");
});

test('redacts the password when only a password is present', () => {
  const r = safeUrl('https://:pass@example.com/path');
  assert.equal(r, "https://example.com/path (userinfo redacted)");
});

test('returns a placeholder when the input is not a parseable URL', () => {
  const r = safeUrl('not a url');
  assert.equal(r, "(unparseable url \u2014 not echoed)");
});

test('returns a placeholder when the input is null', () => {
  const r = safeUrl(null);
  assert.equal(r, "(unparseable url \u2014 not echoed)");
});

test('returns the original string when the URL has an empty username and empty password', () => {
  const r = safeUrl('https://:@example.com/path');
  assert.equal(r, "https://:@example.com/path");
});

test('redacts the userinfo when the URL has a username but no password', () => {
  const r = safeUrl('https://user@example.com');
  assert.equal(r, "https://example.com (userinfo redacted)");
});
