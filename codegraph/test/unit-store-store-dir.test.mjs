// Computes an absolute path for the codegraph store directory (codegraph/store.mjs storeDir).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeDir } from '../store.mjs';

test('returns the default relative path resolved to absolute when no env variable is set', () => {
  const result = storeDir({});
  assert.ok(result.startsWith(process.cwd()));
  assert.ok(result.endsWith('reports/codegraph'));
});

test('returns the default relative path resolved to absolute when env is omitted', () => {
  const result = storeDir();
  assert.ok(result.startsWith(process.cwd()));
  assert.ok(result.endsWith('reports/codegraph'));
});

test('resolves a custom relative path from the environment to an absolute path', () => {
  const result = storeDir({ CW_CODEGRAPH_STORE: 'custom/path' });
  assert.ok(result.startsWith(process.cwd()));
  assert.ok(result.endsWith('custom/path'));
});

test('returns an absolute path unchanged when the environment variable is an absolute path', () => {
  const abs = `${process.cwd()}/absolute/path`;
  const result = storeDir({ CW_CODEGRAPH_STORE: abs });
  assert.strictEqual(result, abs);
});

test('resolves an empty string from the environment to the default store path', () => {
  const result = storeDir({ CW_CODEGRAPH_STORE: '' });
  assert.ok(result.startsWith(process.cwd()));
  assert.ok(result.endsWith('reports/codegraph'));
});
