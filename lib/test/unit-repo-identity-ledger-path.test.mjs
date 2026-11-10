// the repo identity ledger file path, from an env override or the repo default (lib/repo-identity.mjs ledgerPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerPath } from '../repo-identity.mjs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_PATH = join(REPO_ROOT, '.claude', 'store', 'repo-identity.jsonl');

test('returns the default ledger path under the repo root when env is an empty object', () => {
  assert.equal(ledgerPath({}), DEFAULT_PATH);
});

test('returns the default ledger path when only unrelated variables are set', () => {
  assert.equal(ledgerPath({ OTHER_VAR: 'value' }), DEFAULT_PATH);
});

test('returns the override path when the variable is a non-empty string', () => {
  assert.equal(
    ledgerPath({ CW_REPO_IDENTITY_LEDGER: '/custom/path/repo-identity.jsonl' }),
    '/custom/path/repo-identity.jsonl'
  );
});

test('returns a one character override unchanged', () => {
  assert.equal(ledgerPath({ CW_REPO_IDENTITY_LEDGER: 'x' }), 'x');
});

test('returns the default ledger path when the variable is an empty string', () => {
  assert.equal(ledgerPath({ CW_REPO_IDENTITY_LEDGER: '' }), DEFAULT_PATH);
});

test('returns the default ledger path when the variable is the number zero', () => {
  assert.equal(ledgerPath({ CW_REPO_IDENTITY_LEDGER: 0 }), DEFAULT_PATH);
});

test('returns a truthy non-string override value as is', () => {
  assert.equal(ledgerPath({ CW_REPO_IDENTITY_LEDGER: 1 }), 1);
});

test('returns the default ledger path when env is a primitive number', () => {
  assert.equal(ledgerPath(42), DEFAULT_PATH);
});

test('throws a TypeError when env is null', () => {
  assert.throws(() => ledgerPath(null), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'CW_REPO_IDENTITY_LEDGER')"
  });
});
