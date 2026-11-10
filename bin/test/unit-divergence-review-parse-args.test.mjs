// Parses CLI flags into a config object with limit, dryRun, and retryFailed (bin/divergence-review.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../divergence-review.mjs';

test('returns defaults for empty argv', () => {
  assert.deepEqual(parseArgs([]), { limit: 5, dryRun: false, retryFailed: false });
});

test('sets dryRun to true when --dry-run is present', () => {
  assert.deepEqual(parseArgs(['--dry-run']), { limit: 5, dryRun: true, retryFailed: false });
});

test('sets retryFailed to true when --retry-failed is present', () => {
  assert.deepEqual(parseArgs(['--retry-failed']), { limit: 5, dryRun: false, retryFailed: true });
});

test('sets limit to 1 when --limit 1 is provided', () => {
  assert.deepEqual(parseArgs(['--limit', '1']), { limit: 1, dryRun: false, retryFailed: false });
});

test('sets limit to 100 when --limit 100 is provided', () => {
  assert.deepEqual(parseArgs(['--limit', '100']), { limit: 100, dryRun: false, retryFailed: false });
});

test('returns error for --limit 0', () => {
  assert.deepEqual(parseArgs(['--limit', '0']), { error: "--limit takes a whole number from 1 to 100, got \"0\"" });
});

test('returns error for --limit 101', () => {
  assert.deepEqual(parseArgs(['--limit', '101']), { error: "--limit takes a whole number from 1 to 100, got \"101\"" });
});

test('returns error for unknown argument', () => {
  assert.deepEqual(parseArgs(['--unknown']), { error: "unknown argument \"--unknown\"" });
});
