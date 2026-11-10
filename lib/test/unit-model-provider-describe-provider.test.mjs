// Formats a provider engine, model, and host summary (lib/model-provider.mjs describeProvider).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProvider } from '../model-provider.mjs';

test('returns engine, model, and host for a valid URL with a model', () => {
  const p = { engine: 'openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' };
  const r = describeProvider(p);
  assert.equal(r, "openai:gpt-4 @ api.openai.com");
});

test('returns engine, unset model marker, and host for a valid URL without a model', () => {
  const p = { engine: 'anthropic', baseUrl: 'https://api.anthropic.com' };
  const r = describeProvider(p);
  assert.equal(r, "anthropic:(model unset) @ api.anthropic.com");
});

test('returns engine, model, and raw baseUrl when URL parsing fails', () => {
  const p = { engine: 'local', model: 'llama', baseUrl: 'not-a-url' };
  const r = describeProvider(p);
  assert.equal(r, "local:llama @ not-a-url");
});

test('returns engine, unset model marker, and raw baseUrl when URL parsing fails and no model', () => {
  const p = { engine: 'local', baseUrl: 'not-a-url' };
  const r = describeProvider(p);
  assert.equal(r, "local:(model unset) @ not-a-url");
});

test('returns engine, explicit model, and host when model is passed as second argument', () => {
  const p = { engine: 'openai', model: 'gpt-3.5', baseUrl: 'https://api.openai.com' };
  const r = describeProvider(p, 'gpt-4o');
  assert.equal(r, "openai:gpt-4o @ api.openai.com");
});

test('returns engine, unset model marker, and host when second argument is empty string', () => {
  const p = { engine: 'openai', model: 'gpt-3.5', baseUrl: 'https://api.openai.com' };
  const r = describeProvider(p, '');
  assert.equal(r, "openai:(model unset) @ api.openai.com");
});

test('returns engine, unset model marker, and host when model is null and no second argument', () => {
  const p = { engine: 'openai', model: null, baseUrl: 'https://api.openai.com' };
  const r = describeProvider(p);
  assert.equal(r, "openai:(model unset) @ api.openai.com");
});

test('returns engine, model, and host for a URL with a port', () => {
  const p = { engine: 'ollama', model: 'mistral', baseUrl: 'http://localhost:11434/api' };
  const r = describeProvider(p);
  assert.equal(r, "ollama:mistral @ localhost:11434");
});
