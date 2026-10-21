// Strips harness credential keys from an environment object (bin/lib/scanner-env.mjs scannerEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerEnv } from '../lib/scanner-env.mjs';

test('returns an empty object when the input is empty', () => {
  const result = scannerEnv({});
  assert.deepEqual(result, {});
});

test('keeps keys that do not match any harness prefix', () => {
  const result = scannerEnv({ PATH: '/usr/bin', HOME: '/home/user' });
  assert.deepEqual(result, { PATH: '/usr/bin', HOME: '/home/user' });
});

test('removes keys starting with CLAUDE_', () => {
  const result = scannerEnv({ CLAUDE_API_KEY: 'secret', PATH: '/usr/bin' });
  assert.deepEqual(result, { PATH: '/usr/bin' });
});

test('removes keys starting with ANTHROPIC_', () => {
  const result = scannerEnv({ ANTHROPIC_TOKEN: 'tok', HOME: '/home' });
  assert.deepEqual(result, { HOME: '/home' });
});

test('removes keys starting with VELD_', () => {
  const result = scannerEnv({ VELD_SECRET: 'v', PATH: '/bin' });
  assert.deepEqual(result, { PATH: '/bin' });
});

test('removes keys starting with SUBSTRATE_', () => {
  const result = scannerEnv({ SUBSTRATE_KEY: 's', HOME: '/h' });
  assert.deepEqual(result, { HOME: '/h' });
});

test('removes keys starting with SPINE_', () => {
  const result = scannerEnv({ SPINE_ID: 'sp', PATH: '/p' });
  assert.deepEqual(result, { PATH: '/p' });
});

test('removes keys starting with MCP_', () => {
  const result = scannerEnv({ MCP_URL: 'http://x', HOME: '/h' });
  assert.deepEqual(result, { HOME: '/h' });
});

test('keeps keys that contain harness prefixes but do not start with them', () => {
  const result = scannerEnv({ MY_CLAUDE_VAR: 'val', MY_ANTHROPIC_VAR: 'val2' });
  assert.deepEqual(result, { MY_CLAUDE_VAR: 'val', MY_ANTHROPIC_VAR: 'val2' });
});

test('removes all keys when every key matches a harness prefix', () => {
  const result = scannerEnv({ CLAUDE_A: '1', ANTHROPIC_B: '2', VELD_C: '3' });
  assert.deepEqual(result, {});
});
