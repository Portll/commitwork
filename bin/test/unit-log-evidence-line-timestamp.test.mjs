// Extracts the first timestamp from a log line, normalised to YYYY-MM-DD HH:MM:SS (bin/log-evidence.mjs lineTimestamp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineTimestamp } from '../log-evidence.mjs';

test('returns null when the line has no timestamp', () => {
  assert.equal(lineTimestamp('GET /index.html 200'), null);
});

test('parses an ISO timestamp with a T separator', () => {
  assert.equal(lineTimestamp('2024-01-15T10:30:00Z request'), '2024-01-15 10:30:00');
});

test('parses an ISO timestamp with a space separator', () => {
  assert.equal(lineTimestamp('2024-01-15 10:30:00 request'), '2024-01-15 10:30:00');
});

test('parses an Apache timestamp with a slash separator', () => {
  assert.equal(lineTimestamp('[15/Jan/2024:10:30:00 +0000] GET /'), '2024-01-15 10:30:00');
});

test('parses a PHP timestamp with a dash separator', () => {
  assert.equal(lineTimestamp('[15-Jan-2024 10:30:00] GET /'), '2024-01-15 10:30:00');
});

test('returns null when the month name is not recognised', () => {
  assert.equal(lineTimestamp('[15/Foo/2024:10:30:00] GET /'), null);
});

test('handles a lowercase month name in the Apache format', () => {
  assert.equal(lineTimestamp('[15/jan/2024:10:30:00 +0000] GET /'), '2024-01-15 10:30:00');
});

test('returns null for a line with only a date but no time', () => {
  assert.equal(lineTimestamp('2024-01-15'), null);
});
