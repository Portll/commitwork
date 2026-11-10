// retryControls computes feature flags and numeric limits from environment variables (bin/semgrep-retry.mjs retryControls)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryControls } from '../semgrep-retry.mjs';

test('enabled is false when CW_SEMGREP_RETRY is 0', () => {
  const input = { CW_SEMGREP_RETRY: '0' };
  const result = retryControls(input);
  assert.equal(result.enabled, false);
});

test('enabled is false when CW_SEMGREP_RETRY is off', () => {
  const input = { CW_SEMGREP_RETRY: 'off' };
  const result = retryControls(input);
  assert.equal(result.enabled, false);
});

test('enabled is false when CW_SEMGREP_RETRY is false', () => {
  const input = { CW_SEMGREP_RETRY: 'false' };
  const result = retryControls(input);
  assert.equal(result.enabled, false);
});

test('enabled is false when CW_SEMGREP_RETRY is no', () => {
  const input = { CW_SEMGREP_RETRY: 'no' };
  const result = retryControls(input);
  assert.equal(result.enabled, false);
});

test('enabled is true when CW_SEMGREP_RETRY is unset', () => {
  const input = {};
  const result = retryControls(input);
  assert.equal(result.enabled, true);
});

test('enabled is true when CW_SEMGREP_RETRY is true', () => {
  const input = { CW_SEMGREP_RETRY: 'true' };
  const result = retryControls(input);
  assert.equal(result.enabled, true);
});

test('timeoutSec is at least 1 when timeout is 0', () => {
  const input = { CW_SEMGREP_RETRY_TIMEOUT: '0' };
  const result = retryControls(input);
  assert.equal(result.timeoutSec, 60);
});

test('timeoutSec uses provided value when positive', () => {
  const input = { CW_SEMGREP_RETRY_TIMEOUT: '120' };
  const result = retryControls(input);
  assert.equal(result.timeoutSec, 120);
});

test('maxFiles floors to default when given non-numeric string', () => {
  const input = { CW_SEMGREP_RETRY_MAX_FILES: 'abc' };
  const result = retryControls(input);
  assert.equal(result.maxFiles, 50);
});

test('budgetSec uses default when not set', () => {
  const input = {};
  const result = retryControls(input);
  assert.equal(result.budgetSec, 600);
});
