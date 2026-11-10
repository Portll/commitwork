// Splits reasoning from answer in LLM replies (lib/llm-reply.mjs splitThinking).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitThinking } from '../llm-reply.mjs';

test('explicit thinking wins over tags', () => {
  const content = '<thinking>inner</thinking> answer';
  const explicit = '  explicit  ';
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "explicit", answer: "<thinking>inner</thinking> answer" });
});

test('whitespace-only explicit falls through to tags', () => {
  const content = '<thinking>inner</thinking> answer';
  const explicit = '   ';
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "inner", answer: "answer" });
});

test('null explicit with no tags returns null thinking', () => {
  const content = '  plain answer  ';
  const explicit = null;
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: null, answer: "plain answer" });
});

test('tag match returns trimmed thinking and stripped answer', () => {
  const content = '  <thinking>  reason  </thinking>  final  ';
  const explicit = undefined;
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "reason", answer: "final" });
});

test('tag with equals sign before content is not matched', () => {
  const content = '<thinking>=reason</thinking> answer';
  const explicit = undefined;
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "=reason", answer: "answer" });
});

test('tag with equals sign after closing tag is not matched', () => {
  const content = '<thinking>reason</thinking>= answer';
  const explicit = undefined;
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "reason", answer: "= answer" });
});

test('tag with equals sign before opening tag is not matched', () => {
  const content = '=<thinking>reason</thinking> answer';
  const explicit = undefined;
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "reason", answer: "= answer" });
});

test('tag with equals sign after opening tag is not matched', () => {
  const content = '<thinking>=reason</thinking> answer';
  const explicit = undefined;
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "=reason", answer: "answer" });
});

test('tag with equals sign before closing tag is not matched', () => {
  const content = '<thinking>reason<=</thinking> answer';
  const explicit = undefined;
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "reason<=", answer: "answer" });
});

test('tag with equals sign after closing tag is not matched', () => {
  const content = '<thinking>reason</thinking>= answer';
  const explicit = undefined;
  const result = splitThinking(content, explicit);
  assert.deepEqual(result, { thinking: "reason", answer: "= answer" });
});
