// Collects the unique tools required by a list of checks, preserving first-seen order (bin/lib/scan-config.mjs toolRoster).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolRoster } from '../lib/scan-config.mjs';

test('returns an empty array when given an empty list of checks', () => {
  const r = toolRoster([]);
  assert.deepEqual(r, []);
});

test('returns an empty array when the only check has no requires property', () => {
  const r = toolRoster([{}]);
  assert.deepEqual(r, []);
});

test('returns an empty array when the only check has requires but no tools property', () => {
  const r = toolRoster([{ requires: {} }]);
  assert.deepEqual(r, []);
});

test('returns the single tool when the only check requires one tool', () => {
  const r = toolRoster([{ requires: { tools: ['grep'] } }]);
  assert.deepEqual(r, ["grep"]);
});

test('returns the tools in order when the only check requires multiple distinct tools', () => {
  const r = toolRoster([{ requires: { tools: ['grep', 'sed', 'awk'] } }]);
  assert.deepEqual(r, ["grep", "sed", "awk"]);
});

test('deduplicates tools that repeat within a single check', () => {
  const r = toolRoster([{ requires: { tools: ['grep', 'grep', 'sed'] } }]);
  assert.deepEqual(r, ["grep", "sed"]);
});

test('deduplicates tools that repeat across multiple checks', () => {
  const r = toolRoster([
    { requires: { tools: ['grep', 'sed'] } },
    { requires: { tools: ['sed', 'awk'] } },
  ]);
  assert.deepEqual(r, ["grep", "sed", "awk"]);
});

test('returns an empty array when every check requires an empty tools list', () => {
  const r = toolRoster([
    { requires: { tools: [] } },
    { requires: { tools: [] } },
  ]);
  assert.deepEqual(r, []);
});

test('preserves first-seen order across checks with overlapping tools', () => {
  const r = toolRoster([
    { requires: { tools: ['b', 'a'] } },
    { requires: { tools: ['a', 'c'] } },
  ]);
  assert.deepEqual(r, ["b", "a", "c"]);
});

test('handles a large number of checks with repeated tools', () => {
  const checks = Array.from({ length: 100 }, () => ({ requires: { tools: ['x', 'y'] } }));
  const r = toolRoster(checks);
  assert.deepEqual(r, ["x", "y"]);
});
