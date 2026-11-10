// Extracts loopback target ports from CW_TARGET_URL, CW_TLS_URL, CW_OPENAPI (bin/lib/sandbox.mjs targetLoopbackPorts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetLoopbackPorts } from '../lib/sandbox.mjs';

test('returns empty array when no env vars are set', () => {
  assert.deepEqual(targetLoopbackPorts({}), []);
});

test('returns empty array when URL is invalid', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'not a url' }), []);
});

test('returns empty array when protocol is not http or https', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'ftp://localhost:8080' }), []);
});

test('returns empty array when hostname is not loopback', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'http://example.com:8080' }), []);
});

test('returns port 8080 for http localhost with explicit port', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'http://localhost:8080' }), [8080]);
});

test('returns port 443 for https localhost without explicit port', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'https://localhost' }), [443]);
});

test('returns port 80 for http 127.0.0.1 without explicit port', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'http://127.0.0.1' }), [80]);
});

test('returns sorted ports from multiple env vars', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'http://localhost:9000', CW_TLS_URL: 'https://127.0.0.1:8443' }), [8443, 9000]);
});

test('returns empty array when CW_TARGET_URL is empty string', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: '' }), []);
});

test('returns port 8080 for http 0.0.0.0 with explicit port', () => {
  assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'http://0.0.0.0:8080' }), [8080]);
});
