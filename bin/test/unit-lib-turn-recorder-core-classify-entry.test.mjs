// Classifies a turn entry as assistant, user-prompt, tool-result, or other (bin/lib/turn-recorder-core.mjs classifyEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEntry } from '../lib/turn-recorder-core.mjs';

test('returns other for null input', () => {
  assert.equal(classifyEntry(null), "other");
});

test('returns other for non-object input', () => {
  assert.equal(classifyEntry('string'), "other");
});

test('returns assistant for assistant type', () => {
  assert.equal(classifyEntry({ type: 'assistant' }), "assistant");
});

test('returns other for non-user non-assistant type', () => {
  assert.equal(classifyEntry({ type: 'system' }), "other");
});

test('returns other for user type with non-array content', () => {
  assert.equal(classifyEntry({ type: 'user', message: { content: 'text' } }), "user-prompt");
});

test('returns user-prompt for user type with empty content array', () => {
  assert.equal(classifyEntry({ type: 'user', message: { content: [] } }), "user-prompt");
});

test('returns tool-result for user type with tool_result in content', () => {
  assert.equal(classifyEntry({ type: 'user', message: { content: [{ type: 'tool_result' }] } }), "tool-result");
});

test('returns user-prompt for user type with non-tool_result content', () => {
  assert.equal(classifyEntry({ type: 'user', message: { content: [{ type: 'text' }] } }), "user-prompt");
});
