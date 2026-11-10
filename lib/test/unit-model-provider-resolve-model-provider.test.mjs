// Resolves the model provider from environment variables and local config (lib/model-provider.mjs resolveModelProvider).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelProvider } from '../model-provider.mjs';

test('rejects unknown provider names', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'bogus' } });
  assert.deepEqual(r, { ok: false, error: "CW_MODEL_PROVIDER=bogus is not a provider (local, openai-compatible, anthropic)" });
});

test('rejects empty provider names', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: '' } });
  assert.deepEqual(r, { ok: false, error: "no local model server is configured for this caller" });
});

test('rejects local provider when base URL is set', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'local', CW_MODEL_BASE_URL: 'https://example.com' } });
  assert.deepEqual(r, { ok: false, error: "CW_MODEL_BASE_URL is set but CW_MODEL_PROVIDER is not an API provider \u2014 set CW_MODEL_PROVIDER=openai-compatible|anthropic to use it, or point a local server with CW_LLM_URL_<HOST>" });
});

test('rejects local provider when no local config is provided', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'local' } });
  assert.deepEqual(r, { ok: false, error: "no local model server is configured for this caller" });
});

test('accepts local provider with baseUrl only', () => {
  const r = resolveModelProvider({ local: { baseUrl: 'http://localhost:8080' }, env: { CW_MODEL_PROVIDER: 'local' } });
  assert.deepEqual(r, { ok: true, provider: { id: "local", engine: "local", wire: "openai", baseUrl: "http://localhost:8080/v1", model: null, reach: "local" } });
});

test('rejects openai-compatible provider without base URL', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'openai-compatible' } });
  assert.deepEqual(r, { ok: false, error: "CW_MODEL_PROVIDER=openai-compatible needs CW_MODEL_BASE_URL (the API root that /chat/completions is under)" });
});

test('rejects openai-compatible provider without model name', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'openai-compatible', CW_MODEL_BASE_URL: 'https://api.example.com' } });
  assert.deepEqual(r, { ok: false, error: "CW_MODEL_PROVIDER=openai-compatible needs CW_MODEL_NAME" });
});

test('accepts openai-compatible provider with valid config', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'openai-compatible', CW_MODEL_BASE_URL: 'https://api.example.com', CW_MODEL_NAME: 'gpt-4' } });
  assert.deepEqual(r, { ok: true, provider: { id: "openai-compatible", engine: "openai-compatible", wire: "openai", baseUrl: "https://api.example.com", model: "gpt-4", reach: "hosted" } });
});

test('rejects anthropic provider without API key', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: 'https://api.anthropic.com' } });
  assert.deepEqual(r, { ok: false, error: "CW_MODEL_PROVIDER=anthropic needs ANTHROPIC_API_KEY or CW_MODEL_API_KEY" });
});

test('accepts anthropic provider with API key', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: 'https://api.anthropic.com', CW_MODEL_API_KEY: 'sk-ant-test' } });
  assert.deepEqual(r, { ok: true, provider: { id: "anthropic", engine: "anthropic", wire: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", reach: "hosted" } });
});
