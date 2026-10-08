// lib/test/memory-layer-client-units.test.mjs — case tests for safeUrl.
import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl } from '../memory-layer-client.mjs';

test('returns the same string for a URL without userinfo', () => {
  assert.equal(safeUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1');
});

test('redacts username and password and appends a note', () => {
  assert.equal(
    safeUrl('https://user:pass@example.com/path'),
    'https://example.com/path (userinfo redacted)'
  );
});

test('redacts username only when password is empty', () => {
  assert.equal(
    safeUrl('https://user@example.com/'),
    'https://example.com (userinfo redacted)'
  );
});

test('redacts password only when username is empty', () => {
  assert.equal(
    safeUrl('https://:secret@example.com/'),
    'https://example.com (userinfo redacted)'
  );
});

test('returns a fixed placeholder for an unparseable URL', () => {
  assert.equal(safeUrl('not a url'), '(unparseable url — not echoed)');
});

test('returns a fixed placeholder for null or undefined input', () => {
  assert.equal(safeUrl(null), '(unparseable url — not echoed)');
  assert.equal(safeUrl(undefined), '(unparseable url — not echoed)');
});

test('strips a trailing slash before appending the redaction note', () => {
  assert.equal(
    safeUrl('https://user:pass@example.com/'),
    'https://example.com (userinfo redacted)'
  );
});
