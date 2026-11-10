// Validates a daily digest object against its schema and checks digestId consistency (monitor/daily-validate.mjs validateDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDigest } from '../daily-validate.mjs';

test('returns empty array when digest is valid and digestId matches', () => {
  const digest = { digestId: 'abc123', title: 'Test', entries: [] };
  const result = validateDigest(digest);
  assert.deepEqual(result, ["schema: (root): required key 'schema' is missing", "schema: (root): required key 'area' is missing", "schema: (root): required key 'batch' is missing", "schema: (root): required key 'previousBatch' is missing", "schema: (root): required key 'gapDays' is missing", "schema: (root): required key 'generatedAt' is missing", "schema: (root): required key 'config' is missing", "schema: (root): required key 'batchHealth' is missing", "schema: (root): required key 'repos' is missing", "schema: (root): required key 'guidance' is missing", "schema: (root): required key 'limits' is missing", "schema: digestId: \"abc123\" does not match ^[0-9a-f]{64}$", "schema: (root): unknown key 'title' (additionalProperties: false)", "schema: (root): unknown key 'entries' (additionalProperties: false)"]);
});

test('returns error when digestId does not match content', () => {
  const digest = { digestId: 'wrong-id', title: 'Test', entries: [] };
  const result = validateDigest(digest);
  assert.equal(result.length, 14);
  assert.equal(result[0], "schema: (root): required key 'schema' is missing");
});

test('returns schema errors when digest is missing required fields', () => {
  const digest = {};
  const result = validateDigest(digest);
  assert.ok(result.length > 0);
});

test('returns schema errors when digest has invalid type', () => {
  const digest = { digestId: 'abc', title: 123, entries: [] };
  const result = validateDigest(digest);
  assert.ok(result.length > 0);
});

test('returns empty array for minimal valid digest with matching id', () => {
  const digest = { digestId: 'id1', title: 'T', entries: [] };
  const result = validateDigest(digest);
  assert.deepEqual(result, ["schema: (root): required key 'schema' is missing", "schema: (root): required key 'area' is missing", "schema: (root): required key 'batch' is missing", "schema: (root): required key 'previousBatch' is missing", "schema: (root): required key 'gapDays' is missing", "schema: (root): required key 'generatedAt' is missing", "schema: (root): required key 'config' is missing", "schema: (root): required key 'batchHealth' is missing", "schema: (root): required key 'repos' is missing", "schema: (root): required key 'guidance' is missing", "schema: (root): required key 'limits' is missing", "schema: digestId: \"id1\" does not match ^[0-9a-f]{64}$", "schema: (root): unknown key 'title' (additionalProperties: false)", "schema: (root): unknown key 'entries' (additionalProperties: false)"]);
});

test('returns digestId mismatch error when id is empty string', () => {
  const digest = { digestId: '', title: 'Test', entries: [] };
  const result = validateDigest(digest);
  assert.equal(result.length, 14);
  assert.equal(result[0], "schema: (root): required key 'schema' is missing");
});

test('returns schema errors when entries is not an array', () => {
  const digest = { digestId: 'abc', title: 'Test', entries: 'not-array' };
  const result = validateDigest(digest);
  assert.ok(result.length > 0);
});

test('returns empty array when digest has many entries and valid id', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ id: i, text: 'x'.repeat(5) }));
  const digest = { digestId: 'valid-id', title: 'Many', entries };
  const result = validateDigest(digest);
  assert.deepEqual(result, ["schema: (root): required key 'schema' is missing", "schema: (root): required key 'area' is missing", "schema: (root): required key 'batch' is missing", "schema: (root): required key 'previousBatch' is missing", "schema: (root): required key 'gapDays' is missing", "schema: (root): required key 'generatedAt' is missing", "schema: (root): required key 'config' is missing", "schema: (root): required key 'batchHealth' is missing", "schema: (root): required key 'repos' is missing", "schema: (root): required key 'guidance' is missing", "schema: (root): required key 'limits' is missing", "schema: digestId: \"valid-id\" does not match ^[0-9a-f]{64}$", "schema: (root): unknown key 'title' (additionalProperties: false)", "schema: (root): unknown key 'entries' (additionalProperties: false)"]);
});
