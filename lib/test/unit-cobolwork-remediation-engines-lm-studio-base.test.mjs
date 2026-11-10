// Resolves the LM Studio base URL from environment variables (lib/cobolwork-remediation-engines.mjs lmStudioBase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lmStudioBase } from '../cobolwork-remediation-engines.mjs';

test('returns LM_BASE with trailing slashes stripped when no other vars are set', () => {
  const env = { LM_BASE: 'http://localhost:1234/v1/' };
  const result = lmStudioBase(env);
  assert.equal(result, "http://localhost:1234/v1");
});

test('returns LM_BASE unchanged when it has no trailing slash', () => {
  const env = { LM_BASE: 'http://localhost:1234/v1' };
  const result = lmStudioBase(env);
  assert.equal(result, "http://localhost:1234/v1");
});

test('returns baseUrlFor result when CW_LMSTUDIO_URL is set', () => {
  const env = { CW_LMSTUDIO_URL: 'http://custom:9999/v1', LM_BASE: 'http://localhost:1234/v1' };
  const result = lmStudioBase(env);
  assert.equal(result, "http://127.0.0.1:1234");
});

test('returns baseUrlFor result when urlEnvVar lmstudio is set', () => {
  const env = { CW_LMSTUDIO_URL: 'http://custom:9999/v1', LM_BASE: 'http://localhost:1234/v1' };
  const result = lmStudioBase(env);
  assert.equal(result, "http://127.0.0.1:1234");
});

test('returns baseUrlFor result when all three vars are set', () => {
  const env = { CW_LMSTUDIO_URL: 'http://custom:9999/v1', LM_BASE: 'http://localhost:1234/v1' };
  const result = lmStudioBase(env);
  assert.equal(result, "http://127.0.0.1:1234");
});

test('returns baseUrlFor result when env is empty', () => {
  const env = {};
  const result = lmStudioBase(env);
  assert.equal(result, "http://127.0.0.1:1234");
});

test('returns baseUrlFor result when LM_BASE is empty string', () => {
  const env = { LM_BASE: '' };
  const result = lmStudioBase(env);
  assert.equal(result, "http://127.0.0.1:1234");
});

test('returns baseUrlFor result when LM_BASE is zero', () => {
  const env = { LM_BASE: 0 };
  const result = lmStudioBase(env);
  assert.equal(result, "http://127.0.0.1:1234");
});

test('returns baseUrlFor result when LM_BASE is null', () => {
  const env = { LM_BASE: null };
  const result = lmStudioBase(env);
  assert.equal(result, "http://127.0.0.1:1234");
});

test('returns baseUrlFor result when LM_BASE is undefined', () => {
  const env = {};
  const result = lmStudioBase(env);
  assert.equal(result, "http://127.0.0.1:1234");
});
