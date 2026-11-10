// Replaces secret substrings with [REDACTED] (lib/mail.mjs redact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../mail.mjs';

test('returns empty string when text is null', () => {
  assert.equal(redact(null), "");
});

test('returns empty string when text is undefined', () => {
  assert.equal(redact(undefined), "");
});

test('returns stringified number when no secrets given', () => {
  assert.equal(redact(42), "42");
});

test('redacts a secret of length 8', () => {
  assert.equal(redact('key is abcdefgh here', 'abcdefgh'), "key is [REDACTED] here");
});

test('redacts a secret of length 9', () => {
  assert.equal(redact('key is abcdefghi here', 'abcdefghi'), "key is [REDACTED] here");
});

test('does not redact a secret of length 7', () => {
  assert.equal(redact('key is abcdefg here', 'abcdefg'), "key is abcdefg here");
});

test('does not redact a non-string secret', () => {
  assert.equal(redact('key is 12345678 here', 12345678), "key is 12345678 here");
});

test('redacts multiple occurrences of a secret', () => {
  assert.equal(redact('abcdefgh and abcdefgh', 'abcdefgh'), "[REDACTED] and [REDACTED]");
});

test('redacts multiple secrets in one call', () => {
  assert.equal(redact('abcdefgh and abcdefghi', 'abcdefgh', 'abcdefghi'), "[REDACTED] and [REDACTED]i");
});

test('returns text unchanged when secret is shorter than 8', () => {
  assert.equal(redact('short secret', 'abc'), "short secret");
});
