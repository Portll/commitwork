// Determines whether a build tool output indicates a complete or aborted compilation (bin/lib/build-health-parse.mjs lintComplete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintComplete } from '../lib/build-health-parse.mjs';

test('returns complete false with reason when output contains compile error', () => {
  const r = lintComplete('cargo', 'error: could not compile `foo`\n');
  assert.deepEqual(r, { complete: false, reason: "error: could not compile `foo`" });
});

test('returns complete false with reason when output contains aborting due to error', () => {
  const r = lintComplete('cargo', 'error: aborting due to 1 previous error\n');
  assert.deepEqual(r, { complete: false, reason: "error: aborting due to 1 previous error" });
});

test('returns complete false with reason when output contains typecheck failed', () => {
  const r = lintComplete('tsc', 'Error: typecheck failed\n');
  assert.deepEqual(r, { complete: false, reason: "Error: typecheck failed" });
});

test('returns complete false with reason when output contains compilation failed', () => {
  const r = lintComplete('tsc', 'Error: compilation failed\n');
  assert.deepEqual(r, { complete: false, reason: "Error: compilation failed" });
});

test('returns complete true with null reason when output is empty', () => {
  const r = lintComplete('cargo', '');
  assert.deepEqual(r, { complete: true, reason: null });
});

test('returns complete true with null reason when output is success message', () => {
  const r = lintComplete('cargo', 'Finished dev profile in 0.5s\n');
  assert.deepEqual(r, { complete: true, reason: null });
});

test('returns complete true with null reason when output is null', () => {
  const r = lintComplete('cargo', null);
  assert.deepEqual(r, { complete: true, reason: null });
});

test('returns complete true with null reason when output is undefined', () => {
  const r = lintComplete('cargo', undefined);
  assert.deepEqual(r, { complete: true, reason: null });
});
