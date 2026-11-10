// Maps LLM host declarations and the agent-ledger endpoint into probe-ready endpoint records (monitor/engine-identity.mjs endpointsFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointsFor } from '../engine-identity.mjs';

test('returns endpoints with default env', () => {
  const result = endpointsFor(undefined, {});
  assert.deepEqual(result, [{ id: "lmstudio", baseUrl: "http://127.0.0.1:1234", ownerMatch: "LM Studio", portIsShared: false }, { id: "llama.cpp", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llama.cpp", portIsShared: true }, { id: "llamafile", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llamafile", portIsShared: true }, { id: "mlx-lm", baseUrl: "http://127.0.0.1:8080", ownerMatch: "mlx-lm", portIsShared: true }, { id: "localai", baseUrl: "http://127.0.0.1:8080", ownerMatch: "localai", portIsShared: true }, { id: "vllm", baseUrl: "http://127.0.0.1:8000", ownerMatch: "vllm", portIsShared: false }, { id: "sglang", baseUrl: "http://127.0.0.1:30000", ownerMatch: "sglang", portIsShared: false }, { id: "agent-ledger", baseUrl: "http://127.0.0.1:7980", ownerMatch: null, portIsShared: false }]);
});

test('returns endpoints with custom agent ledger URL', () => {
  const env = { CW_AGENT_LEDGER_URL: 'http://10.0.0.1:7980' };
  const result = endpointsFor(undefined, env);
  assert.deepEqual(result, [{ id: "lmstudio", baseUrl: "http://127.0.0.1:1234", ownerMatch: "LM Studio", portIsShared: false }, { id: "llama.cpp", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llama.cpp", portIsShared: true }, { id: "llamafile", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llamafile", portIsShared: true }, { id: "mlx-lm", baseUrl: "http://127.0.0.1:8080", ownerMatch: "mlx-lm", portIsShared: true }, { id: "localai", baseUrl: "http://127.0.0.1:8080", ownerMatch: "localai", portIsShared: true }, { id: "vllm", baseUrl: "http://127.0.0.1:8000", ownerMatch: "vllm", portIsShared: false }, { id: "sglang", baseUrl: "http://127.0.0.1:30000", ownerMatch: "sglang", portIsShared: false }, { id: "agent-ledger", baseUrl: "http://10.0.0.1:7980", ownerMatch: null, portIsShared: false }]);
});

test('returns endpoints with custom agent ledger owner', () => {
  const env = { CW_AGENT_LEDGER_OWNER: 'ledgerd' };
  const result = endpointsFor(undefined, env);
  assert.deepEqual(result, [{ id: "lmstudio", baseUrl: "http://127.0.0.1:1234", ownerMatch: "LM Studio", portIsShared: false }, { id: "llama.cpp", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llama.cpp", portIsShared: true }, { id: "llamafile", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llamafile", portIsShared: true }, { id: "mlx-lm", baseUrl: "http://127.0.0.1:8080", ownerMatch: "mlx-lm", portIsShared: true }, { id: "localai", baseUrl: "http://127.0.0.1:8080", ownerMatch: "localai", portIsShared: true }, { id: "vllm", baseUrl: "http://127.0.0.1:8000", ownerMatch: "vllm", portIsShared: false }, { id: "sglang", baseUrl: "http://127.0.0.1:30000", ownerMatch: "sglang", portIsShared: false }, { id: "agent-ledger", baseUrl: "http://127.0.0.1:7980", ownerMatch: "ledgerd", portIsShared: false }]);
});

test('returns endpoints with both custom URL and owner', () => {
  const env = { CW_AGENT_LEDGER_URL: 'http://10.0.0.1:7980', CW_AGENT_LEDGER_OWNER: 'ledgerd' };
  const result = endpointsFor(undefined, env);
  assert.deepEqual(result, [{ id: "lmstudio", baseUrl: "http://127.0.0.1:1234", ownerMatch: "LM Studio", portIsShared: false }, { id: "llama.cpp", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llama.cpp", portIsShared: true }, { id: "llamafile", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llamafile", portIsShared: true }, { id: "mlx-lm", baseUrl: "http://127.0.0.1:8080", ownerMatch: "mlx-lm", portIsShared: true }, { id: "localai", baseUrl: "http://127.0.0.1:8080", ownerMatch: "localai", portIsShared: true }, { id: "vllm", baseUrl: "http://127.0.0.1:8000", ownerMatch: "vllm", portIsShared: false }, { id: "sglang", baseUrl: "http://127.0.0.1:30000", ownerMatch: "sglang", portIsShared: false }, { id: "agent-ledger", baseUrl: "http://10.0.0.1:7980", ownerMatch: "ledgerd", portIsShared: false }]);
});

test('returns endpoints with empty string URL falls back to default', () => {
  const env = { CW_AGENT_LEDGER_URL: '', CW_AGENT_LEDGER_OWNER: 'ledgerd' };
  const result = endpointsFor(undefined, env);
  assert.deepEqual(result, [{ id: "lmstudio", baseUrl: "http://127.0.0.1:1234", ownerMatch: "LM Studio", portIsShared: false }, { id: "llama.cpp", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llama.cpp", portIsShared: true }, { id: "llamafile", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llamafile", portIsShared: true }, { id: "mlx-lm", baseUrl: "http://127.0.0.1:8080", ownerMatch: "mlx-lm", portIsShared: true }, { id: "localai", baseUrl: "http://127.0.0.1:8080", ownerMatch: "localai", portIsShared: true }, { id: "vllm", baseUrl: "http://127.0.0.1:8000", ownerMatch: "vllm", portIsShared: false }, { id: "sglang", baseUrl: "http://127.0.0.1:30000", ownerMatch: "sglang", portIsShared: false }, { id: "agent-ledger", baseUrl: "http://127.0.0.1:7980", ownerMatch: "ledgerd", portIsShared: false }]);
});

test('returns endpoints with empty string owner falls back to null', () => {
  const env = { CW_AGENT_LEDGER_URL: 'http://10.0.0.1:7980', CW_AGENT_LEDGER_OWNER: '' };
  const result = endpointsFor(undefined, env);
  assert.deepEqual(result, [{ id: "lmstudio", baseUrl: "http://127.0.0.1:1234", ownerMatch: "LM Studio", portIsShared: false }, { id: "llama.cpp", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llama.cpp", portIsShared: true }, { id: "llamafile", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llamafile", portIsShared: true }, { id: "mlx-lm", baseUrl: "http://127.0.0.1:8080", ownerMatch: "mlx-lm", portIsShared: true }, { id: "localai", baseUrl: "http://127.0.0.1:8080", ownerMatch: "localai", portIsShared: true }, { id: "vllm", baseUrl: "http://127.0.0.1:8000", ownerMatch: "vllm", portIsShared: false }, { id: "sglang", baseUrl: "http://127.0.0.1:30000", ownerMatch: "sglang", portIsShared: false }, { id: "agent-ledger", baseUrl: "http://10.0.0.1:7980", ownerMatch: null, portIsShared: false }]);
});

test('returns endpoints with URL absent and owner empty string', () => {
  const env = { CW_AGENT_LEDGER_OWNER: '' };
  const result = endpointsFor(undefined, env);
  assert.deepEqual(result, [{ id: "lmstudio", baseUrl: "http://127.0.0.1:1234", ownerMatch: "LM Studio", portIsShared: false }, { id: "llama.cpp", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llama.cpp", portIsShared: true }, { id: "llamafile", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llamafile", portIsShared: true }, { id: "mlx-lm", baseUrl: "http://127.0.0.1:8080", ownerMatch: "mlx-lm", portIsShared: true }, { id: "localai", baseUrl: "http://127.0.0.1:8080", ownerMatch: "localai", portIsShared: true }, { id: "vllm", baseUrl: "http://127.0.0.1:8000", ownerMatch: "vllm", portIsShared: false }, { id: "sglang", baseUrl: "http://127.0.0.1:30000", ownerMatch: "sglang", portIsShared: false }, { id: "agent-ledger", baseUrl: "http://127.0.0.1:7980", ownerMatch: null, portIsShared: false }]);
});

test('returns endpoints with URL empty string and owner absent', () => {
  const env = { CW_AGENT_LEDGER_URL: '' };
  const result = endpointsFor(undefined, env);
  assert.deepEqual(result, [{ id: "lmstudio", baseUrl: "http://127.0.0.1:1234", ownerMatch: "LM Studio", portIsShared: false }, { id: "llama.cpp", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llama.cpp", portIsShared: true }, { id: "llamafile", baseUrl: "http://127.0.0.1:8080", ownerMatch: "llamafile", portIsShared: true }, { id: "mlx-lm", baseUrl: "http://127.0.0.1:8080", ownerMatch: "mlx-lm", portIsShared: true }, { id: "localai", baseUrl: "http://127.0.0.1:8080", ownerMatch: "localai", portIsShared: true }, { id: "vllm", baseUrl: "http://127.0.0.1:8000", ownerMatch: "vllm", portIsShared: false }, { id: "sglang", baseUrl: "http://127.0.0.1:30000", ownerMatch: "sglang", portIsShared: false }, { id: "agent-ledger", baseUrl: "http://127.0.0.1:7980", ownerMatch: null, portIsShared: false }]);
});
