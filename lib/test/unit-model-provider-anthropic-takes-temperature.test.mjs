// Whether a Claude model accepts a temperature parameter (lib/model-provider.mjs anthropicTakesTemperature).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicTakesTemperature } from '../model-provider.mjs';

test('Fable models do not take temperature', () => {
  const r = anthropicTakesTemperature('claude-fable-1');
  assert.equal(r, false);
});

test('Mythos models do not take temperature', () => {
  const r = anthropicTakesTemperature('claude-mythos-2');
  assert.equal(r, false);
});

test('Opus 4.7 does not take temperature', () => {
  const r = anthropicTakesTemperature('claude-opus-4-7');
  assert.equal(r, false);
});

test('Opus 4.8 does not take temperature', () => {
  const r = anthropicTakesTemperature('claude-opus-4-8');
  assert.equal(r, false);
});

test('Opus 4.6 takes temperature', () => {
  const r = anthropicTakesTemperature('claude-opus-4-6');
  assert.equal(r, true);
});

test('Sonnet 5.5 does not take temperature', () => {
  const r = anthropicTakesTemperature('claude-sonnet-5-5');
  assert.equal(r, false);
});

test('Sonnet 5.4 takes temperature', () => {
  const r = anthropicTakesTemperature('claude-sonnet-5-4');
  assert.equal(r, false);
});

test('Sonnet 5.0 takes temperature', () => {
  const r = anthropicTakesTemperature('claude-sonnet-5-0');
  assert.equal(r, false);
});

test('Haiku 4.5 takes temperature', () => {
  const r = anthropicTakesTemperature('claude-haiku-4-5');
  assert.equal(r, true);
});

test('Haiku 4.4 takes temperature', () => {
  const r = anthropicTakesTemperature('claude-haiku-4-4');
  assert.equal(r, true);
});
