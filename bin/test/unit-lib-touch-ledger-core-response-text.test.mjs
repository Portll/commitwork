// Extracts a plain-text representation from a tool response envelope (bin/lib/touch-ledger-core.mjs responseText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseText } from '../lib/touch-ledger-core.mjs';

test('returns the string tool_response unchanged', () => {
  const r = responseText({ tool_response: 'hello' });
  assert.equal(r, "hello");
});

test('returns empty string when tool_response is undefined', () => {
  const r = responseText({});
  assert.equal(r, "");
});

test('returns empty string when tool_response is null', () => {
  const r = responseText({ tool_response: null });
  assert.equal(r, "");
});

test('joins array of strings with newlines', () => {
  const r = responseText({ tool_response: ['a', 'b'] });
  assert.equal(r, "a\nb");
});

test('maps array objects to their text property and joins with newlines', () => {
  const r = responseText({ tool_response: [{ text: 'x' }, { text: 'y' }] });
  assert.equal(r, "x\ny");
});

test('maps array objects without text to empty strings and joins with newlines', () => {
  const r = responseText({ tool_response: [{}, { foo: 1 }] });
  assert.equal(r, "\n");
});

test('joins non-empty object fields stdout stderr output text with newlines', () => {
  const r = responseText({ tool_response: { stdout: 'out', stderr: 'err', output: 'o', text: 't' } });
  assert.equal(r, "out\nerr\no\nt");
});

test('filters out falsy object fields before joining', () => {
  const r = responseText({ tool_response: { stdout: 'out', stderr: '', output: null, text: 't' } });
  assert.equal(r, "out\nt");
});

test('returns empty string when object has no recognized fields', () => {
  const r = responseText({ tool_response: { foo: 'bar' } });
  assert.equal(r, "");
});

test('returns empty string when tool_response is a number', () => {
  const r = responseText({ tool_response: 42 });
  assert.equal(r, "");
});
