// Picks the redactions JSON path from the env override or the repo monitor default (lib/publish-scanner-redactions.mjs scannerRedactionPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerRedactionPath } from '../publish-scanner-redactions.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_PATH = resolve(REPO, 'monitor', 'publish-scanner-redactions.json');

test('returns the env override when CW_PUBLISH_SCANNER_REDACTIONS is set', () => {
  const r = scannerRedactionPath({ CW_PUBLISH_SCANNER_REDACTIONS: '/custom/redactions.json' });
  assert.equal(r, '/custom/redactions.json');
});

test('falls back to the repo monitor path when the env var is absent', () => {
  const r = scannerRedactionPath({});
  assert.equal(r, DEFAULT_PATH);
});

test('falls back to the repo monitor path when the env var is an empty string', () => {
  const r = scannerRedactionPath({ CW_PUBLISH_SCANNER_REDACTIONS: '' });
  assert.equal(r, DEFAULT_PATH);
});

test('falls back to the repo monitor path when the env var is zero', () => {
  const r = scannerRedactionPath({ CW_PUBLISH_SCANNER_REDACTIONS: 0 });
  assert.equal(r, DEFAULT_PATH);
});

test('falls back to the repo monitor path when the env var is null', () => {
  const r = scannerRedactionPath({ CW_PUBLISH_SCANNER_REDACTIONS: null });
  assert.equal(r, DEFAULT_PATH);
});

test('falls back to the repo monitor path when the env var is undefined', () => {
  const r = scannerRedactionPath({ CW_PUBLISH_SCANNER_REDACTIONS: undefined });
  assert.equal(r, DEFAULT_PATH);
});

test('returns the env override unchanged for a long repeated path string', () => {
  const long = 'x'.repeat(100);
  const r = scannerRedactionPath({ CW_PUBLISH_SCANNER_REDACTIONS: long });
  assert.equal(r, long);
});

test('returns a relative env override as given without resolving it', () => {
  const r = scannerRedactionPath({ CW_PUBLISH_SCANNER_REDACTIONS: 'rel/redactions.json' });
  assert.equal(r, 'rel/redactions.json');
});
