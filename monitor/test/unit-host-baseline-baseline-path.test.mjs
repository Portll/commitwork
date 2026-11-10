// Host baseline file path, from the env override or the repo default (monitor/host-baseline.mjs baselinePath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselinePath } from '../host-baseline.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(TEST_DIR, '..', '..');
const DEFAULT_PATH = join(REPO, '.claude', 'host-baseline.json');

function withBaseline(value, run) {
  const saved = process.env.CW_HOST_BASELINE;
  if (value === undefined) delete process.env.CW_HOST_BASELINE;
  else process.env.CW_HOST_BASELINE = value;
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env.CW_HOST_BASELINE;
    else process.env.CW_HOST_BASELINE = saved;
  }
}

test('returns the env var path when CW_HOST_BASELINE is an absolute path', () => {
  const result = withBaseline('/tmp/custom-baseline.json', () => baselinePath());
  assert.equal(result, '/tmp/custom-baseline.json');
});

test('returns the default repo path when CW_HOST_BASELINE is unset', () => {
  const result = withBaseline(undefined, () => baselinePath());
  assert.equal(result, DEFAULT_PATH);
});

test('returns a relative env var path without resolving it', () => {
  const result = withBaseline('relative/path.json', () => baselinePath());
  assert.equal(result, 'relative/path.json');
});

test('returns the default repo path when CW_HOST_BASELINE is an empty string', () => {
  const result = withBaseline('', () => baselinePath());
  assert.equal(result, DEFAULT_PATH);
});

test('returns a single space env var value unchanged', () => {
  const result = withBaseline(' ', () => baselinePath());
  assert.equal(result, ' ');
});

test('returns the string zero because a non-empty env var value is truthy', () => {
  const result = withBaseline('0', () => baselinePath());
  assert.equal(result, '0');
});

test('returns the string false because a non-empty env var value is truthy', () => {
  const result = withBaseline('false', () => baselinePath());
  assert.equal(result, 'false');
});

test('returns a long env var value unchanged', () => {
  const value = 'x'.repeat(100);
  const result = withBaseline(value, () => baselinePath());
  assert.equal(result, value);
});
