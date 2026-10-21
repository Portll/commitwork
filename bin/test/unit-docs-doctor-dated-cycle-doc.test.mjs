// Determines if a root-level filename is a dated cycle artifact (bin/docs-doctor.mjs datedCycleDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datedCycleDoc } from '../docs-doctor.mjs';

test('returns false for paths containing a slash', () => {
  assert.equal(datedCycleDoc('lib/REMEDIATION-2026-01-01.md'), false);
});

test('returns false for filenames not matching cycle kinds', () => {
  assert.equal(datedCycleDoc('README-2026-01-01.md'), false);
});

test('returns true for valid remediation cycle doc with date', () => {
  assert.equal(datedCycleDoc('REMEDIATION-2026-01-01.md'), true);
});

test('returns true for valid scanner backlog cycle doc with date', () => {
  assert.equal(datedCycleDoc('SCANNER-BACKLOG-2026-01-01.md'), true);
});

test('returns false for invalid calendar date in filename', () => {
  assert.equal(datedCycleDoc('REMEDIATION-2026-13-45.md'), false);
});

test('returns false when the cycle kind is not followed by a hyphen', () => {
  assert.equal(datedCycleDoc('REMEDIATIONv2026-01-01.md'), false);
});

test('returns true for date at end of filename without extension', () => {
  assert.equal(datedCycleDoc('REMEDIATION-2026-01-01'), true);
});

test('returns false for non-cycle prefix with valid date', () => {
  assert.equal(datedCycleDoc('NOTES-2026-01-01.md'), false);
});
