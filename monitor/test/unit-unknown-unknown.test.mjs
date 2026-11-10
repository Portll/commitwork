// Builds a tagged object for a declared unknown reason, or throws (monitor/unknown.mjs unknown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unknown } from '../unknown.mjs';

test('returns a tagged object with no detail key when detail is omitted', () => {
  const r = unknown('absent');
  assert.deepEqual(r, { unknown: true, unknownReason: "absent" });
});

test('returns a tagged object with the detail string when detail is provided', () => {
  const r = unknown('empty', 'no bytes');
  assert.deepEqual(r, { unknown: true, unknownReason: "empty", unknownDetail: "no bytes" });
});

test('truncates the detail string to 400 characters', () => {
  const r = unknown('unparseable', 'x'.repeat(500));
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
});

test('keeps the detail string intact when it is exactly 400 characters', () => {
  const r = unknown('truncated', 'y'.repeat(400));
  assert.deepEqual(r, { unknown: true, unknownReason: "truncated", unknownDetail: "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy" });
});

test('throws an error naming the undeclared reason', () => {
  assert.throws(() => unknown('bogus'), { name: "Error", message: "unknown(): 'bogus' is not a declared reason. Add it to UNKNOWN_REASONS in monitor/unknown.mjs with a sentence saying what a reader should DO about it \u2014 do not coin a new adjective at the call site. Declared: absent, empty, unparseable, truncated, not-run, no-subject, tool-failed, no-rules, not-adjudicated, subject-mismatch, not-produced, not-recorded, no-reference, not-permitted, unexaminable, unstated" });
});

test('throws an error when the reason is undefined', () => {
  assert.throws(() => unknown(undefined), { name: "Error", message: "unknown(): 'undefined' is not a declared reason. Add it to UNKNOWN_REASONS in monitor/unknown.mjs with a sentence saying what a reader should DO about it \u2014 do not coin a new adjective at the call site. Declared: absent, empty, unparseable, truncated, not-run, no-subject, tool-failed, no-rules, not-adjudicated, subject-mismatch, not-produced, not-recorded, no-reference, not-permitted, unexaminable, unstated" });
});

test('returns a tagged object for the not-run reason', () => {
  const r = unknown('not-run', 'skipped');
  assert.deepEqual(r, { unknown: true, unknownReason: "not-run", unknownDetail: "skipped" });
});

test('returns a tagged object for the no-rules reason', () => {
  const r = unknown('no-rules');
  assert.deepEqual(r, { unknown: true, unknownReason: "no-rules" });
});
