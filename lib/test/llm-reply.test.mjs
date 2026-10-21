// Tests for LLM reply splitting and verdict parsing (positive and negative)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitThinking, parseVerdict } from '../llm-reply.mjs';

test('an explicit reasoning field wins over inline tags', () => {
  assert.deepEqual(splitThinking('<think>inline</think>VERDICT: x', ' separate '), { thinking: 'separate', answer: '<think>inline</think>VERDICT: x' });
});

test('inline <think> and <thinking> are split wherever they sit, any case', () => {
  assert.deepEqual(splitThinking('<think>a</think>\nVERDICT: y'), { thinking: 'a', answer: 'VERDICT: y' });
  assert.deepEqual(splitThinking('<THINKING>b</THINKING>ok'), { thinking: 'b', answer: 'ok' });
  assert.deepEqual(splitThinking('Preamble.\n<think>c</think>\nrest'), { thinking: 'c', answer: 'Preamble.\n\nrest' });
});

test('no thinking channel is null, never an empty block', () => {
  assert.deepEqual(splitThinking('  plain  '), { thinking: null, answer: 'plain' });
  assert.deepEqual(splitThinking(null), { thinking: null, answer: '' });
  assert.deepEqual(splitThinking('x', '   '), { thinking: null, answer: 'x' });
});

test('verdict fields are read after a preamble and absent fields are null', () => {
  const r = parseVerdict('Some reasoning.\n**VERDICT:** `false-positive`\nCONFIDENCE: High');
  assert.equal(r.verdict, 'false-positive');
  assert.equal(r.confidence, 'high');
  assert.equal(r.fix, null);
  assert.equal(r.preamble, 'Some reasoning.');
  assert.equal(parseVerdict('no fields here').verdict, null);
});
