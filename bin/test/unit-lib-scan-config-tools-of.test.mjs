// Deduplicates the tools required by a check (bin/lib/scan-config.mjs toolsOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolsOf } from '../lib/scan-config.mjs';

test('returns empty array when check is null', () => {
  const r = toolsOf(null);
  assert.deepEqual(r, []);
});

test('returns empty array when check is undefined', () => {
  const r = toolsOf(undefined);
  assert.deepEqual(r, []);
});

test('returns empty array when requires is missing', () => {
  const r = toolsOf({});
  assert.deepEqual(r, []);
});

test('returns empty array when requires is null', () => {
  const r = toolsOf({ requires: null });
  assert.deepEqual(r, []);
});

test('returns empty array when tools is missing', () => {
  const r = toolsOf({ requires: {} });
  assert.deepEqual(r, []);
});

test('returns empty array when tools is null', () => {
  const r = toolsOf({ requires: { tools: null } });
  assert.deepEqual(r, []);
});

test('returns empty array when tools is undefined', () => {
  const r = toolsOf({ requires: { tools: undefined } });
  assert.deepEqual(r, []);
});

test('returns deduplicated tools when tools is a non-empty array', () => {
  const r = toolsOf({ requires: { tools: ['git', 'npm', 'git'] } });
  assert.deepEqual(r, ["git", "npm"]);
});

test('returns single tool when tools has one element', () => {
  const r = toolsOf({ requires: { tools: ['eslint'] } });
  assert.deepEqual(r, ["eslint"]);
});

test('returns empty array when tools is an empty array', () => {
  const r = toolsOf({ requires: { tools: [] } });
  assert.deepEqual(r, []);
});
