// Resolves a host id to its base URL, preferring env overrides (monitor/llm-hosts.mjs baseUrlFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseUrlFor } from '../llm-hosts.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'baseUrlFor-'));
const manifest = join(dir, 'llm-hosts.json');
const schema = join(dir, 'llm-hosts.schema.json');
writeFileSync(manifest, JSON.stringify({
  hosts: [
    { id: 'a', baseUrl: 'http://a:1', portIsShared: false },
    { id: 'b', baseUrl: 'http://b:2', portIsShared: false },
    { id: 'lmstudio', baseUrl: 'http://lm:3', portIsShared: false }
  ],
  default: 'a',
  probeOrder: ['a', 'b']
}));
writeFileSync(schema, JSON.stringify({ type: 'object', properties: { hosts: { type: 'array' }, default: { type: 'string' }, probeOrder: { type: 'array' } } }));
process.env.CW_LLM_HOSTS = manifest;
process.env.CW_LLM_HOSTS_SCHEMA = schema;

test('returns the declared baseUrl when no env override is set', () => {
  try {
    delete process.env.CW_LLM_URL_A;
    delete process.env.CW_LMSTUDIO_URL;
    assert.equal(baseUrlFor('a'), "http://a:1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers the CW_LLM_URL_<ID> env var over the declared baseUrl', () => {
  try {
    process.env.CW_LLM_URL_A = 'http://override:9';
    assert.equal(baseUrlFor('a'), "http://override:9");
  } finally {
    delete process.env.CW_LLM_URL_A;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to the legacy CW_LMSTUDIO_URL env var when the modern var is unset', () => {
  try {
    delete process.env.CW_LLM_URL_LMSTUDIO;
    process.env.CW_LMSTUDIO_URL = 'http://legacy:7';
    assert.equal(baseUrlFor('lmstudio'), "http://legacy:7");
  } finally {
    delete process.env.CW_LMSTUDIO_URL;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers the modern env var over the legacy env var when both are set', () => {
  try {
    process.env.CW_LLM_URL_LMSTUDIO = 'http://modern:8';
    process.env.CW_LMSTUDIO_URL = 'http://legacy:7';
    assert.equal(baseUrlFor('lmstudio'), "http://modern:8");
  } finally {
    delete process.env.CW_LLM_URL_LMSTUDIO;
    delete process.env.CW_LMSTUDIO_URL;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the id is not a declared host', () => {
  try {
    assert.throws(() => baseUrlFor('nope'), { name: "Error", message: "llm-hosts: no declared host \"nope\"" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the declared baseUrl for a second host with no env override', () => {
  try {
    delete process.env.CW_LLM_URL_B;
    assert.equal(baseUrlFor('b'), "http://b:2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
