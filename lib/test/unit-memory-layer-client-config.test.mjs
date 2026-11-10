// Resolves VELD environment variables into a normalized client config object (lib/memory-layer-client.mjs config).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../memory-layer-client.mjs';

test('uses default values when no environment variables are provided', () => {
  const r = config({ env: {} });
  assert.deepEqual(r, { url: "http://127.0.0.1:3030", userId: "portll", project: "commitwork", projectSource: "default", timeoutMs: 5000, verify: true, maxRetries: 2 });
});

test('strips trailing slash from provided API URL', () => {
  const r = config({ env: { VELD_API_URL: 'http://example.com/' } });
  assert.equal(r.url, "http://example.com");
});

test('uses provided API URL without trailing slash', () => {
  const r = config({ env: { VELD_API_URL: 'http://example.com' } });
  assert.equal(r.url, "http://example.com");
});

test('uses provided user ID', () => {
  const r = config({ env: { VELD_USER_ID: 'custom-user' } });
  assert.equal(r.userId, "custom-user");
});

test('lowercases provided project name', () => {
  const r = config({ env: { CW_VELD_PROJECT: 'MyProject' } });
  assert.equal(r.project, "myproject");
});

test('sets projectSource to env when project is provided', () => {
  const r = config({ env: { CW_VELD_PROJECT: 'test' } });
  assert.equal(r.projectSource, "env");
});

test('sets projectSource to default when project is not provided', () => {
  const r = config({ env: {} });
  assert.equal(r.projectSource, "default");
});

test('parses provided timeout as number', () => {
  const r = config({ env: { VELD_TIMEOUT_MS: '1000' } });
  assert.equal(r.timeoutMs, 1000);
});

test('sets verify to false when CW_VELD_VERIFY is 0', () => {
  const r = config({ env: { CW_VELD_VERIFY: '0' } });
  assert.equal(r.verify, false);
});

test('sets verify to true when CW_VELD_VERIFY is 1', () => {
  const r = config({ env: { CW_VELD_VERIFY: '1' } });
  assert.equal(r.verify, true);
});

test('parses provided max retries as number', () => {
  const r = config({ env: { VELD_MAX_RETRIES: '5' } });
  assert.equal(r.maxRetries, 5);
});
