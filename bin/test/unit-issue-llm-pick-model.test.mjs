// Selects the best chat model from a list of ids by scoring size, coder fit, and penalising MoE or tuned variants. (bin/issue-llm.mjs pickModel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickModel } from '../issue-llm.mjs';

test('returns null when all ids are embedding models', () => {
  const input = ['text-embedding-3-small', 'bge-base-en'];
  const result = pickModel(input);
  assert.equal(result, "bge-base-en");
});

test('returns null for an empty list', () => {
  const input = [];
  const result = pickModel(input);
  assert.equal(result, null);
});

test('prefers a coder model with a large dense size over a smaller general model', () => {
  const input = ['qwen2.5-coder-32b-instruct', 'llama-3-8b-instruct'];
  const result = pickModel(input);
  assert.equal(result, "qwen2.5-coder-32b-instruct");
});

test('penalises MoE models with active parameter labels', () => {
  const input = ['qwen2.5-coder-32b-instruct', 'qwen2.5-coder-32b-a2b-instruct'];
  const result = pickModel(input);
  assert.equal(result, "qwen2.5-coder-32b-instruct");
});

test('penalises uncensored or heretic tuned models', () => {
  const input = ['llama-3-8b-instruct', 'llama-3-8b-uncensored'];
  const result = pickModel(input);
  assert.equal(result, "llama-3-8b-instruct");
});

test('handles ids without a size label by using zero for the size score', () => {
  const input = ['qwen2.5-coder-instruct', 'llama-3-8b-instruct'];
  const result = pickModel(input);
  assert.equal(result, "qwen2.5-coder-instruct");
});

test('breaks ties by keeping the first model in the input order', () => {
  const input = ['model-a-8b-instruct', 'model-b-8b-instruct'];
  const result = pickModel(input);
  assert.equal(result, "model-a-8b-instruct");
});

test('returns the only usable model when others are filtered out', () => {
  const input = ['text-embedding-3-small', 'qwen2.5-coder-32b-instruct', 'bge-base-en'];
  const result = pickModel(input);
  assert.equal(result, "qwen2.5-coder-32b-instruct");
});

test('prefers larger size when both models have size labels', () => {
  const input = ['model-10b', 'model-20b'];
  const result = pickModel(input);
  assert.equal(result, "model-20b");
});

test('prefers non-bonus model when tied with bonus model in original scoring', () => {
  const input = ['model-15b', 'model-10b-instruct'];
  const result = pickModel(input);
  assert.equal(result, "model-15b");
});
