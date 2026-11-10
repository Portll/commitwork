// coverage reports root dir from env override or default (monitor/sandbox-coverage.mjs reportsRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportsRoot } from '../sandbox-coverage.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = 'CW_SANDBOX_COVERAGE_ROOT';
const FALLBACK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'reports');

function restore(saved) {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
}

test('returns the override path when CW_SANDBOX_COVERAGE_ROOT is set', () => {
  const saved = process.env[KEY];
  process.env[KEY] = '/tmp/cw-coverage';
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, '/tmp/cw-coverage');
});

test('falls back to the default reports directory when the override is an empty string', () => {
  const saved = process.env[KEY];
  process.env[KEY] = '';
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, FALLBACK);
});

test('returns a single space override unchanged because it is truthy', () => {
  const saved = process.env[KEY];
  process.env[KEY] = ' ';
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, ' ');
});

test('returns a long repeated override path unchanged', () => {
  const saved = process.env[KEY];
  const input = '/x'.repeat(50);
  process.env[KEY] = input;
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, input);
});

test('falls back to the default reports directory when the override is unset', () => {
  const saved = process.env[KEY];
  delete process.env[KEY];
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, FALLBACK);
});

test('returns the string null when the override is assigned null', () => {
  const saved = process.env[KEY];
  process.env[KEY] = null;
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, 'null');
});

test('returns the string undefined when the override is assigned undefined', () => {
  const saved = process.env[KEY];
  process.env[KEY] = undefined;
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, 'undefined');
});

test('returns the string zero override unchanged because it is truthy', () => {
  const saved = process.env[KEY];
  process.env[KEY] = '0';
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, '0');
});

test('returns a relative override path without resolving it', () => {
  const saved = process.env[KEY];
  process.env[KEY] = 'reports/sandbox';
  const result = reportsRoot();
  restore(saved);
  assert.equal(result, 'reports/sandbox');
});
