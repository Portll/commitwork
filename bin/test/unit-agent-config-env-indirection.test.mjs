// envIndirection computes the set of environment-variable names that can influence a service's URL host, command, args, npx package, or hostish env keys (bin/agent-config.mjs envIndirection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envIndirection } from '../agent-config.mjs';

test('returns empty array when no variables are present', () => {
  const srv = { url: 'https://example.com', command: 'node', args: ['index.js'], env: { PATH: '/usr/bin' } };
  assert.deepEqual(envIndirection(srv), []);
});

test('detects variable in URL host', () => {
  const srv = { url: 'https://${API_HOST}/api', command: 'node', args: [], env: {} };
  assert.deepEqual(envIndirection(srv), ['url host from API_HOST']);
});

test('detects variable in command', () => {
  const srv = { url: 'https://example.com', command: '$MY_CMD', args: [], env: {} };
  assert.deepEqual(envIndirection(srv), ['command from MY_CMD']);
});

test('ignores local path variables in command', () => {
  const srv = { url: 'https://example.com', command: '$HOME/bin/node', args: [], env: {} };
  assert.deepEqual(envIndirection(srv), []);
});

test('detects variable in args URL host', () => {
  const srv = { url: 'https://example.com', command: 'node', args: ['http://${SVC_URL}/v1'], env: {} };
  assert.deepEqual(envIndirection(srv), ['args URL host from SVC_URL']);
});

test('detects variable in npx package', () => {
  const srv = { url: 'https://example.com', command: 'npx', args: ['-p', '${PKG_NAME}', 'run'], env: {} };
  assert.deepEqual(envIndirection(srv), ['npx package from PKG_NAME']);
});

test('detects variable in hostish env key', () => {
  const srv = { url: 'https://example.com', command: 'node', args: [], env: { API_HOST: '${REAL_HOST}' } };
  assert.deepEqual(envIndirection(srv), ['env API_HOST from REAL_HOST']);
});

test('ignores non-hostish env keys', () => {
  const srv = { url: 'https://example.com', command: 'node', args: [], env: { FOO: '${BAR}' } };
  assert.deepEqual(envIndirection(srv), []);
});

test('handles missing optional fields gracefully', () => {
  const srv = { url: 'https://example.com' };
  assert.deepEqual(envIndirection(srv), []);
});

test('sorts multiple findings alphabetically', () => {
  const srv = { url: 'https://${B_HOST}/x', command: '$A_CMD', args: [], env: { Z_HOST: '${C_VAR}' } };
  assert.deepEqual(envIndirection(srv), ['command from A_CMD', 'env Z_HOST from C_VAR', 'url host from B_HOST']);
});
