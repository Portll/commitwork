// Computes the provider:model engine identifier for a side (monitor/divergence-kappa.mjs engineOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineOf } from '../divergence-kappa.mjs';

test('returns null when side is null', () => {
  assert.equal(engineOf(null), null);
});

test('returns null when side is undefined', () => {
  assert.equal(engineOf(undefined), null);
});

test('returns null when side is an empty object', () => {
  assert.equal(engineOf({}), null);
});

test('returns provider:model when answeredBy has both provider and model', () => {
  const side = { answeredBy: { provider: 'openai', model: 'gpt-4' } };
  assert.equal(engineOf(side), "openai:gpt-4");
});

test('returns provider:model when engine has provider and model', () => {
  const side = { engine: { provider: 'anthropic', model: 'claude-3' } };
  assert.equal(engineOf(side), "anthropic:claude-3");
});

test('returns provider:model when engine has engine and model but no provider', () => {
  const side = { engine: { engine: 'mistral', model: 'mixtral' } };
  assert.equal(engineOf(side), "mistral:mixtral");
});

test('returns null when answeredBy has provider but no model', () => {
  const side = { answeredBy: { provider: 'openai' } };
  assert.equal(engineOf(side), null);
});

test('returns null when engine has provider but no model', () => {
  const side = { engine: { provider: 'anthropic' } };
  assert.equal(engineOf(side), null);
});

test('returns null when answeredBy has model but no provider', () => {
  const side = { answeredBy: { model: 'gpt-4' } };
  assert.equal(engineOf(side), null);
});

test('returns null when engine has model but no provider or engine', () => {
  const side = { engine: { model: 'claude-3' } };
  assert.equal(engineOf(side), null);
});
