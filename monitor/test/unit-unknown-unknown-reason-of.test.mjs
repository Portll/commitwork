// Extracts the declared unknown reason from a determination object (monitor/unknown.mjs unknownReasonOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unknownReasonOf } from '../unknown.mjs';

test('returns null for null input', () => {
  assert.equal(unknownReasonOf(null), null);
});

test('returns null for non-object input', () => {
  assert.equal(unknownReasonOf(42), null);
});

test('returns unknownReason when unknown is true', () => {
  assert.equal(unknownReasonOf({ unknown: true, unknownReason: 'absent' }), "absent");
});

test('returns null when unknown is false and no legacy flags', () => {
  assert.equal(unknownReasonOf({ unknown: false, unknownReason: 'absent' }), null);
});

test('returns reason when legacy flag is true', () => {
  assert.equal(unknownReasonOf({ nosrc: true }), "no-subject");
});

test('returns null when legacy flag is false', () => {
  assert.equal(unknownReasonOf({ nosrc: false }), null);
});

test('returns reason from determination field value', () => {
  assert.equal(unknownReasonOf({ state: 'nosrc' }), "no-subject");
});

test('returns null for empty object', () => {
  assert.equal(unknownReasonOf({}), null);
});
