// Builds a frozen local provider descriptor from a local config object (lib/model-provider.mjs localProvider).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localProvider } from '../model-provider.mjs';

test('throws TypeError when local is null', () => {
  assert.throws(() => localProvider(null), { name: 'TypeError', message: 'localProvider needs { baseUrl } or { apiBase }' });
});

test('throws TypeError when local is undefined', () => {
  assert.throws(() => localProvider(undefined), { name: 'TypeError', message: 'localProvider needs { baseUrl } or { apiBase }' });
});

test('throws TypeError when local is empty object', () => {
  assert.throws(() => localProvider({}), { name: 'TypeError', message: 'localProvider needs { baseUrl } or { apiBase }' });
});

test('throws TypeError when local is false', () => {
  assert.throws(() => localProvider(false), { name: 'TypeError', message: 'localProvider needs { baseUrl } or { apiBase }' });
});

test('returns provider with apiBase and trailing slashes trimmed', () => {
  const r = localProvider({ apiBase: 'http://localhost:8080/v1/' }, { model: 'gpt-4' });
  assert.deepEqual(r, { id: "local", engine: "local", wire: "openai", baseUrl: "http://localhost:8080/v1", model: "gpt-4", reach: "local" });
});

test('returns provider with baseUrl and /v1 appended', () => {
  const r = localProvider({ baseUrl: 'http://localhost:8080' }, { model: 'gpt-4' });
  assert.deepEqual(r, { id: "local", engine: "local", wire: "openai", baseUrl: "http://localhost:8080/v1", model: "gpt-4", reach: "local" });
});

test('returns provider with engine from local config', () => {
  const r = localProvider({ apiBase: 'http://localhost:8080', engine: 'ollama' }, { model: 'llama' });
  assert.deepEqual(r, { id: "local", engine: "ollama", wire: "openai", baseUrl: "http://localhost:8080", model: "llama", reach: "local" });
});

test('returns provider with tokenEnv when provided', () => {
  const r = localProvider({ apiBase: 'http://localhost:8080', tokenEnv: 'MY_TOKEN' }, { model: 'gpt-4' });
  assert.deepEqual(r, { id: "local", engine: "local", wire: "openai", baseUrl: "http://localhost:8080", model: "gpt-4", reach: "local", tokenEnv: "MY_TOKEN" });
});

test('returns provider without tokenEnv when not provided', () => {
  const r = localProvider({ apiBase: 'http://localhost:8080' }, { model: 'gpt-4' });
  assert.deepEqual(r, { id: "local", engine: "local", wire: "openai", baseUrl: "http://localhost:8080", model: "gpt-4", reach: "local" });
});

test('returns provider with default engine when not provided', () => {
  const r = localProvider({ apiBase: 'http://localhost:8080' }, { model: 'gpt-4' });
  assert.deepEqual(r, { id: "local", engine: "local", wire: "openai", baseUrl: "http://localhost:8080", model: "gpt-4", reach: "local" });
});
