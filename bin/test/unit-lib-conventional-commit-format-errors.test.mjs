// Formats lint errors and optional subject preview (bin/lib/conventional-commit.mjs formatErrors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatErrors } from '../lib/conventional-commit.mjs';

test('returns empty string when no errors and no subject', () => {
  const r = formatErrors({ errors: [] }, { subject: '' });
  assert.equal(r, "");
});

test('returns empty string when no errors and subject omitted', () => {
  const r = formatErrors({ errors: [] });
  assert.equal(r, "");
});

test('formats single error without subject', () => {
  const r = formatErrors({ errors: [{ clause: 'type', message: 'bad type', fix: 'use feat' }] });
  assert.equal(r, "  \u00b7 [clause type] bad type\n      fix: use feat");
});

test('formats single error with short subject', () => {
  const r = formatErrors({ errors: [{ clause: 'scope', message: 'bad scope', fix: 'remove scope' }] }, { subject: 'fix: thing' });
  assert.equal(r, "  subject was: \"fix: thing\"\n  \u00b7 [clause scope] bad scope\n      fix: remove scope");
});

test('formats multiple errors with subject', () => {
  const r = formatErrors(
    { errors: [
      { clause: 'type', message: 'm1', fix: 'f1' },
      { clause: 'subject', message: 'm2', fix: 'f2' }
    ] },
    { subject: 'update docs' }
  );
  assert.equal(r, "  subject was: \"update docs\"\n  \u00b7 [clause type] m1\n      fix: f1\n  \u00b7 [clause subject] m2\n      fix: f2");
});

test('truncates subject at 120 characters', () => {
  const r = formatErrors({ errors: [] }, { subject: 'a'.repeat(150) });
  assert.equal(r, "  subject was: \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"");
});

test('subject of exactly 120 characters is not truncated', () => {
  const r = formatErrors({ errors: [] }, { subject: 'b'.repeat(120) });
  assert.equal(r, "  subject was: \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"");
});

test('subject of 121 characters is truncated to 120', () => {
  const r = formatErrors({ errors: [] }, { subject: 'c'.repeat(121) });
  assert.equal(r, "  subject was: \"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"");
});
