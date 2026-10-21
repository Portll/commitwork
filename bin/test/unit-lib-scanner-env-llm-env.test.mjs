// Filters environment to scanner vars plus ANTHROPIC_API_KEY and sets CW_GUARD_UNATTENDED (bin/lib/scanner-env.mjs llmEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmEnv } from '../lib/scanner-env.mjs';

test('returns empty object with CW_GUARD_UNATTENDED when env is empty', () => {
  const result = llmEnv({});
  assert.deepEqual(result, { CW_GUARD_UNATTENDED: '1' });
});

test('includes ANTHROPIC_API_KEY when present in env', () => {
  const result = llmEnv({ ANTHROPIC_API_KEY: 'sk-123' });
  assert.deepEqual(result, { ANTHROPIC_API_KEY: 'sk-123', CW_GUARD_UNATTENDED: '1' });
});

test('excludes ANTHROPIC_API_KEY when it is an empty string', () => {
  const result = llmEnv({ ANTHROPIC_API_KEY: '' });
  assert.deepEqual(result, { CW_GUARD_UNATTENDED: '1' });
});

test('excludes ANTHROPIC_API_KEY when it is undefined', () => {
  const result = llmEnv({ ANTHROPIC_API_KEY: undefined });
  assert.deepEqual(result, { CW_GUARD_UNATTENDED: '1' });
});

test('excludes ANTHROPIC_API_KEY when it is null', () => {
  const result = llmEnv({ ANTHROPIC_API_KEY: null });
  assert.deepEqual(result, { CW_GUARD_UNATTENDED: '1' });
});

test('excludes ANTHROPIC_API_KEY when it is zero', () => {
  const result = llmEnv({ ANTHROPIC_API_KEY: 0 });
  assert.deepEqual(result, { CW_GUARD_UNATTENDED: '1' });
});

test('excludes ANTHROPIC_API_KEY when it is false', () => {
  const result = llmEnv({ ANTHROPIC_API_KEY: false });
  assert.deepEqual(result, { CW_GUARD_UNATTENDED: '1' });
});

test('preserves non-harness environment variables', () => {
  const result = llmEnv({ PATH: '/usr/bin', HOME: '/home/user' });
  assert.deepEqual(result, { PATH: '/usr/bin', HOME: '/home/user', CW_GUARD_UNATTENDED: '1' });
});

test('excludes harness environment variables matching CLAUDE_ prefix', () => {
  const result = llmEnv({ CLAUDE_API_KEY: 'secret', PATH: '/usr/bin' });
  assert.deepEqual(result, { PATH: '/usr/bin', CW_GUARD_UNATTENDED: '1' });
});

test('excludes harness environment variables matching ANTHROPIC_ prefix except ANTHROPIC_API_KEY', () => {
  const result = llmEnv({ ANTHROPIC_MODEL: 'claude-3', ANTHROPIC_API_KEY: 'sk-123' });
  assert.deepEqual(result, { ANTHROPIC_API_KEY: 'sk-123', CW_GUARD_UNATTENDED: '1' });
});
