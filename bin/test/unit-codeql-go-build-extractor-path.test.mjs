// Computes the CodeQL Go extractor binary path from environment variables (bin/codeql-go-build.mjs extractorPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractorPath } from '../codeql-go-build.mjs';

test('returns null when CODEQL_EXTRACTOR_GO_ROOT is empty string', () => {
  const result = extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '', CODEQL_PLATFORM: 'linux64' });
  assert.equal(result, null);
});

test('returns null when CODEQL_PLATFORM is empty string', () => {
  const result = extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '/opt/codeql', CODEQL_PLATFORM: '' });
  assert.equal(result, null);
});

test('returns null when both CODEQL_EXTRACTOR_GO_ROOT and CODEQL_PLATFORM are empty strings', () => {
  const result = extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '', CODEQL_PLATFORM: '' });
  assert.equal(result, null);
});

test('returns null when CODEQL_EXTRACTOR_GO_ROOT is undefined', () => {
  const result = extractorPath({ CODEQL_PLATFORM: 'linux64' });
  assert.equal(result, null);
});

test('returns null when CODEQL_PLATFORM is undefined', () => {
  const result = extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '/opt/codeql' });
  assert.equal(result, null);
});

test('returns null when both CODEQL_EXTRACTOR_GO_ROOT and CODEQL_PLATFORM are undefined', () => {
  const result = extractorPath({});
  assert.equal(result, null);
});

test('returns joined path when both CODEQL_EXTRACTOR_GO_ROOT and CODEQL_PLATFORM are set', () => {
  const result = extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '/opt/codeql', CODEQL_PLATFORM: 'linux64' });
  assert.equal(result, '/opt/codeql/tools/linux64/go-extractor');
});

test('returns joined path with nested root directory', () => {
  const result = extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '/usr/local/codeql', CODEQL_PLATFORM: 'windows64' });
  assert.equal(result, '/usr/local/codeql/tools/windows64/go-extractor');
});
