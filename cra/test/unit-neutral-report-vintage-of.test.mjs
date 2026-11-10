// Computes the runner-vintage receipt summary for a rollup (cra/neutral-report.mjs vintageOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vintageOf } from '../neutral-report.mjs';

test('returns the unrecorded receipt when the rollup is null', () => {
  const r = vintageOf(null);
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the rollup has no vintage', () => {
  const r = vintageOf({});
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the vintage has no code', () => {
  const r = vintageOf({ vintage: {} });
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the code is an empty string', () => {
  const r = vintageOf({ vintage: { code: '' } });
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the code is zero', () => {
  const r = vintageOf({ vintage: { code: 0 } });
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the code is false', () => {
  const r = vintageOf({ vintage: { code: false } });
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the code is null', () => {
  const r = vintageOf({ vintage: { code: null } });
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the code is undefined', () => {
  const r = vintageOf({ vintage: { code: undefined } });
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the code is NaN', () => {
  const r = vintageOf({ vintage: { code: NaN } });
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: "this rollup predates the runner-vintage receipt \u2014 the build that produced these rows is UNRECORDED, which is not the same as one build" });
});

test('returns the unrecorded receipt when the code is an empty object', () => {
  const r = vintageOf({ vintage: { code: {} } });
  assert.deepEqual(r, { distinct: 0, recorded: 0, unrecorded: 0, mixed: false, note: null });
});
