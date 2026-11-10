// Detects transport aborts in tool result content (bin/lib/turn-recorder-core.mjs isTransportAbort).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransportAbort } from '../lib/turn-recorder-core.mjs';

test('returns false when message content is not an array', () => {
  const entry = { message: { content: 'plain string' } };
  assert.equal(isTransportAbort(entry), false);
});

test('returns false when message content is an array with no tool_result blocks', () => {
  const entry = { message: { content: [{ type: 'text', text: 'hello' }] } };
  assert.equal(isTransportAbort(entry), false);
});

test('returns true when tool_result content contains abort error text', () => {
  const entry = { message: { content: [{ type: 'tool_result', content: 'AbortError: stream closed' }] } };
  assert.equal(isTransportAbort(entry), true);
});

test('returns false when tool_result content does not match transport abort pattern', () => {
  const entry = { message: { content: [{ type: 'tool_result', content: 'all good, no errors' }] } };
  assert.equal(isTransportAbort(entry), false);
});

test('returns true when tool_result content is an object that stringifies to match pattern', () => {
  const entry = { message: { content: [{ type: 'tool_result', content: { error: 'ECONNRESET' } }] } };
  assert.equal(isTransportAbort(entry), true);
});

test('returns false when entry is null', () => {
  assert.equal(isTransportAbort(null), false);
});

test('returns false when entry has no message property', () => {
  assert.equal(isTransportAbort({}), false);
});

test('returns true when tool_result content is a string matching socket hang up', () => {
  const entry = { message: { content: [{ type: 'tool_result', content: 'socket hang up detected' }] } };
  assert.equal(isTransportAbort(entry), true);
});
