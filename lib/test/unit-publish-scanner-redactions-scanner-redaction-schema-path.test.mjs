// Picks the redactions schema path from the env override or the repo schema default (lib/publish-scanner-redactions.mjs scannerRedactionSchemaPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerRedactionSchemaPath } from '../publish-scanner-redactions.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_PATH = resolve(REPO_ROOT, 'schema', 'publish-scanner-redactions.schema.json');

test('returns the env value when CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA is an absolute path', () => {
  const r = scannerRedactionSchemaPath({ CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: '/custom/schema.json' });
  assert.equal(r, '/custom/schema.json');
});

test('returns the repo default schema path when the env object is empty', () => {
  const r = scannerRedactionSchemaPath({});
  assert.equal(r, DEFAULT_PATH);
});

test('returns the repo default schema path when the env key is an empty string', () => {
  const r = scannerRedactionSchemaPath({ CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: '' });
  assert.equal(r, DEFAULT_PATH);
});

test('returns the repo default schema path when the env key is zero', () => {
  const r = scannerRedactionSchemaPath({ CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: 0 });
  assert.equal(r, DEFAULT_PATH);
});

test('returns a relative env value unchanged without resolving it', () => {
  const r = scannerRedactionSchemaPath({ CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: 'relative/path.json' });
  assert.equal(r, 'relative/path.json');
});

test('returns the repo default schema path when the env key is null', () => {
  const r = scannerRedactionSchemaPath({ CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: null });
  assert.equal(r, DEFAULT_PATH);
});

test('returns the repo default schema path when the env key is explicitly undefined', () => {
  const r = scannerRedactionSchemaPath({ CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: undefined });
  assert.equal(r, DEFAULT_PATH);
});

test('returns a truthy non-string env value as is', () => {
  const r = scannerRedactionSchemaPath({ CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: true });
  assert.equal(r, true);
});
