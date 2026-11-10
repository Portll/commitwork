// Parses security.txt into fields, contact, canonical, scope, and expires (bin/lib/probe-oracle.mjs parseSecurityTxt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSecurityTxt } from '../lib/probe-oracle.mjs';

test('parses a complete security.txt with all fields', () => {
  const input = 'Contact: mail@example.com\nCanonical: example.com\nScope: a.example.com\nExpires: 2025-01-01T00:00:00Z';
  const r = parseSecurityTxt(input);
  assert.deepEqual(r, { fields: { contact: ["mail@example.com"], canonical: ["example.com"], scope: ["a.example.com"], expires: ["2025-01-01T00:00:00Z"] }, contact: ["mail@example.com"], canonical: ["example.com"], scope: ["a.example.com"], expires: 1735689600000, expiresRaw: "2025-01-01T00:00:00Z" });
});

test('returns empty arrays and null expires for empty string', () => {
  const r = parseSecurityTxt('');
  assert.deepEqual(r, { fields: {}, contact: [], canonical: [], scope: [], expires: null, expiresRaw: null });
});

test('returns empty arrays and null expires for null input', () => {
  const r = parseSecurityTxt(null);
  assert.deepEqual(r, { fields: {}, contact: [], canonical: [], scope: [], expires: null, expiresRaw: null });
});

test('returns empty arrays and null expires for undefined input', () => {
  const r = parseSecurityTxt(undefined);
  assert.deepEqual(r, { fields: {}, contact: [], canonical: [], scope: [], expires: null, expiresRaw: null });
});

test('parses only contact field with no expires', () => {
  const r = parseSecurityTxt('Contact: support@example.com');
  assert.deepEqual(r, { fields: { contact: ["support@example.com"] }, contact: ["support@example.com"], canonical: [], scope: [], expires: null, expiresRaw: null });
});

test('parses only canonical field with no contact or scope', () => {
  const r = parseSecurityTxt('Canonical: example.com');
  assert.deepEqual(r, { fields: { canonical: ["example.com"] }, contact: [], canonical: ["example.com"], scope: [], expires: null, expiresRaw: null });
});

test('parses only scope field with no contact or canonical', () => {
  const r = parseSecurityTxt('Scope: *.example.com');
  assert.deepEqual(r, { fields: { scope: ["*.example.com"] }, contact: [], canonical: [], scope: ["*.example.com"], expires: null, expiresRaw: null });
});

test('parses only expires field with no contact, canonical, or scope', () => {
  const r = parseSecurityTxt('Expires: 2025-06-15T12:00:00Z');
  assert.deepEqual(r, { fields: { expires: ["2025-06-15T12:00:00Z"] }, contact: [], canonical: [], scope: [], expires: 1749988800000, expiresRaw: "2025-06-15T12:00:00Z" });
});

test('handles CRLF line endings and comments', () => {
  const input = 'Contact: a@b.com\r\n# comment\nCanonical: c.com';
  const r = parseSecurityTxt(input);
  assert.deepEqual(r, { fields: { contact: ["a@b.com"], canonical: ["c.com"] }, contact: ["a@b.com"], canonical: ["c.com"], scope: [], expires: null, expiresRaw: null });
});

test('parses multiple values for the same field', () => {
  const input = 'Contact: a@b.com\nContact: c@d.com\nScope: x.com\nScope: y.com';
  const r = parseSecurityTxt(input);
  assert.deepEqual(r, { fields: { contact: ["a@b.com", "c@d.com"], scope: ["x.com", "y.com"] }, contact: ["a@b.com", "c@d.com"], canonical: [], scope: ["x.com", "y.com"], expires: null, expiresRaw: null });
});
