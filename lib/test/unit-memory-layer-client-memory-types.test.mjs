// what memoryTypes computes, in a few words (lib/memory-layer-client.mjs memoryTypes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryTypes } from '../memory-layer-client.mjs';

test('no override returns all MEMORY_TYPES_MEASURED', () => {
  const result = memoryTypes({});
  assert.deepEqual(result, [
    'Observation', 'Decision', 'Learning', 'Error', 'Discovery', 'Pattern', 'Context',
    'Task', 'CodeEdit', 'FileAccess', 'Search', 'Command', 'Conversation', 'Intention',
  ]);
});

test('empty string override returns all MEMORY_TYPES_MEASURED', () => {
  const result = memoryTypes({ env: { CW_VELD_MEMORY_TYPES: '' } });
  assert.deepEqual(result, [
    'Observation', 'Decision', 'Learning', 'Error', 'Discovery', 'Pattern', 'Context',
    'Task', 'CodeEdit', 'FileAccess', 'Search', 'Command', 'Conversation', 'Intention',
  ]);
});

test('whitespace-only override returns all MEMORY_TYPES_MEASURED', () => {
  const result = memoryTypes({ env: { CW_VELD_MEMORY_TYPES: '   ' } });
  assert.deepEqual(result, [
    'Observation', 'Decision', 'Learning', 'Error', 'Discovery', 'Pattern', 'Context',
    'Task', 'CodeEdit', 'FileAccess', 'Search', 'Command', 'Conversation', 'Intention',
  ]);
});

test('single valid type overrides to one element', () => {
  const result = memoryTypes({ env: { CW_VELD_MEMORY_TYPES: 'Observation' } });
  assert.deepEqual(result, ['Observation']);
});

test('multiple valid types override to parsed list', () => {
  const result = memoryTypes({ env: { CW_VELD_MEMORY_TYPES: 'Observation,Decision' } });
  assert.deepEqual(result, ['Observation', 'Decision']);
});

test('override that parses to empty list returns all MEMORY_TYPES_MEASURED', () => {
  const result = memoryTypes({ env: { CW_VELD_MEMORY_TYPES: ',,,' } });
  assert.deepEqual(result, [
    'Observation', 'Decision', 'Learning', 'Error', 'Discovery', 'Pattern', 'Context',
    'Task', 'CodeEdit', 'FileAccess', 'Search', 'Command', 'Conversation', 'Intention',
  ]);
});

test('env without CW_VELD_MEMORY_TYPES falls back to MEMORY_TYPES_MEASURED', () => {
  const result = memoryTypes({ env: {} });
  assert.deepEqual(result, [
    'Observation', 'Decision', 'Learning', 'Error', 'Discovery', 'Pattern', 'Context',
    'Task', 'CodeEdit', 'FileAccess', 'Search', 'Command', 'Conversation', 'Intention',
  ]);
});
