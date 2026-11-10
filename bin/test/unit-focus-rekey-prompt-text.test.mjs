// Extracts user prompt text from a JSON line (bin/focus-rekey.mjs promptText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptText } from '../focus-rekey.mjs';

test('returns empty string for empty user content', () => {
  const line = '{"role":"user","content":""}';
  const r = promptText(line);
  assert.equal(r, "");
});

test('returns text with newlines replaced by spaces', () => {
  const line = '{"role":"user","content":"hello\\nworld"}';
  const r = promptText(line);
  assert.equal(r, "hello world");
});

test('returns text for content exceeding 400 chars', () => {
  const content = 'a'.repeat(401);
  const line = '{"role":"user","content":"' + content + '"}';
  const r = promptText(line);
  assert.equal(r, null);
});

test('returns null when no user role is present', () => {
  const line = '{"role":"assistant","content":"hi"}';
  const r = promptText(line);
  assert.equal(r, null);
});

test('returns text from array content with type text', () => {
  const line = '{"role":"user","content":[{"type":"text","text":"array text"}]}';
  const r = promptText(line);
  assert.equal(r, "array text");
});

test('returns empty string for empty array text content', () => {
  const line = '{"role":"user","content":[{"type":"text","text":""}]}';
  const r = promptText(line);
  assert.equal(r, "");
});

test('returns null for non-matching line', () => {
  const line = 'not a json line at all';
  const r = promptText(line);
  assert.equal(r, null);
});

test('returns text with escaped quotes in content', () => {
  const line = '{"role":"user","content":"say \\"hi\\""}';
  const r = promptText(line);
  assert.equal(r, "say \\\"hi\\\"");
});
