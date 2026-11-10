// Parses job limit env vars into a config object (mcp/jobs.mjs jobLimits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobLimits } from '../jobs.mjs';

test('returns defaults when env is empty', () => {
  const r = jobLimits({});
  assert.deepEqual(r, { concurrency: 1, maxQueued: 8, maxRetained: 50, retainMs: 3600000 });
});

test('returns defaults when env vars are empty strings', () => {
  const r = jobLimits({ CW_MCP_JOB_CONCURRENCY: '', CW_MCP_JOB_QUEUE: '', CW_MCP_JOB_RETAIN: '', CW_MCP_JOB_RETAIN_MS: '' });
  assert.deepEqual(r, { concurrency: 1, maxQueued: 8, maxRetained: 50, retainMs: 3600000 });
});

test('parses valid integer env vars', () => {
  const r = jobLimits({ CW_MCP_JOB_CONCURRENCY: '5', CW_MCP_JOB_QUEUE: '10', CW_MCP_JOB_RETAIN: '100', CW_MCP_JOB_RETAIN_MS: '1000' });
  assert.deepEqual(r, { concurrency: 5, maxQueued: 10, maxRetained: 100, retainMs: 1000 });
});

test('throws when value is below minimum', () => {
  assert.throws(() => jobLimits({ CW_MCP_JOB_CONCURRENCY: '0' }), { name: "Error", message: "CW_MCP_JOB_CONCURRENCY=\"0\" is not an integer >= 1" });
});

test('throws when value is not an integer', () => {
  assert.throws(() => jobLimits({ CW_MCP_JOB_CONCURRENCY: 'abc' }), { name: "Error", message: "CW_MCP_JOB_CONCURRENCY=\"abc\" is not an integer >= 1" });
});

test('accepts value equal to minimum', () => {
  const r = jobLimits({ CW_MCP_JOB_CONCURRENCY: '1' });
  assert.deepEqual(r, { concurrency: 1, maxQueued: 8, maxRetained: 50, retainMs: 3600000 });
});

test('throws when value is one less than minimum', () => {
  assert.deepStrictEqual(jobLimits({ CW_MCP_JOB_QUEUE: '7' }), { concurrency: 1, maxQueued: 7, maxRetained: 50, retainMs: 3600000 });
});

test('accepts value one more than minimum', () => {
  const r = jobLimits({ CW_MCP_JOB_QUEUE: '9' });
  assert.deepEqual(r, { concurrency: 1, maxQueued: 9, maxRetained: 50, retainMs: 3600000 });
});
