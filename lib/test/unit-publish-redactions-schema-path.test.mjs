// computes the schema file path, using env override or default location (lib/publish-redactions.mjs schemaPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaPath } from '../publish-redactions.mjs';

test('returns the override when CW_PUBLISH_REDACTIONS_SCHEMA is set to a non\u2011empty string', () => {
  const env = { CW_PUBLISH_REDACTIONS_SCHEMA: '/custom/path/schema.json' };
  const result = schemaPath(env);
  assert.strictEqual(result, '/custom/path/schema.json');
});

test('falls back to the default when CW_PUBLISH_REDACTIONS_SCHEMA is undefined', () => {
  const env = { CW_PUBLISH_REDACTIONS_SCHEMA: undefined };
  const result = schemaPath(env);
  assert.match(result, /schema[\\/]publish-redactions\.schema\.json$/);
  assert.ok(result.startsWith('/') || result.startsWith('C:\\') || result.startsWith('file:/'));
});

test('falls back to the default when CW_PUBLISH_REDACTIONS_SCHEMA is an empty string', () => {
  const env = { CW_PUBLISH_REDACTIONS_SCHEMA: '' };
  const result = schemaPath(env);
  assert.match(result, /schema[\\/]publish-redactions\.schema\.json$/);
});

test('falls back to the default when CW_PUBLISH_REDACTIONS_SCHEMA is not present', () => {
  const env = {};
  const result = schemaPath(env);
  assert.match(result, /schema[\\/]publish-redactions\.schema\.json$/);
});

test('uses a long generated override path unchanged', () => {
  const longPath = '/tmp/' + 'x'.repeat(1000) + '.json';
  const env = { CW_PUBLISH_REDACTIONS_SCHEMA: longPath };
  const result = schemaPath(env);
  assert.strictEqual(result, longPath);
});
