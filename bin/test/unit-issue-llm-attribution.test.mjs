// Maps an LLM answer to its engine, model, and host (bin/issue-llm.mjs attribution).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attribution } from '../issue-llm.mjs';

test('returns lmstudio engine and the requested model when answeredBy is null', () => {
  const result = attribution(null, 'gpt-4');
  assert.deepEqual(result, { engine: 'lmstudio', model: 'gpt-4' });
});

test('returns lmstudio engine and the requested model when answeredBy is undefined', () => {
  const result = attribution(undefined, 'claude-3');
  assert.deepEqual(result, { engine: 'lmstudio', model: 'claude-3' });
});

test('returns lmstudio engine and the requested model when answeredBy is an empty string', () => {
  const result = attribution('', 'llama-3');
  assert.deepEqual(result, { engine: 'lmstudio', model: 'llama-3' });
});

test('returns the engine, model, and host from answeredBy when all fields are present', () => {
  const answeredBy = { engine: 'openai', model: 'gpt-4o', host: 'api.openai.com' };
  const result = attribution(answeredBy, 'fallback-model');
  assert.deepEqual(result, { engine: 'openai', model: 'gpt-4o', host: 'api.openai.com' });
});

test('falls back to the requested model when answeredBy has no model field', () => {
  const answeredBy = { engine: 'anthropic', host: 'api.anthropic.com' };
  const result = attribution(answeredBy, 'claude-3-opus');
  assert.deepEqual(result, { engine: 'anthropic', model: 'claude-3-opus', host: 'api.anthropic.com' });
});

test('falls back to the requested model when answeredBy model is an empty string', () => {
  const answeredBy = { engine: 'ollama', model: '', host: 'localhost:11434' };
  const result = attribution(answeredBy, 'llama-3');
  assert.deepEqual(result, { engine: 'ollama', model: 'llama-3', host: 'localhost:11434' });
});

test('returns an undefined host when answeredBy has no host field', () => {
  const answeredBy = { engine: 'groq', model: 'llama-3-70b' };
  const result = attribution(answeredBy, 'fallback');
  assert.deepEqual(result, { engine: 'groq', model: 'llama-3-70b', host: undefined });
});
