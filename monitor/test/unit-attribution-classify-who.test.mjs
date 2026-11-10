// Classifies a commit author string as machine, human, or unknown (monitor/attribution.mjs classifyWho).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWho } from '../attribution.mjs';

test('returns unknown for empty string', () => {
  assert.equal(classifyWho(''), "unknown");
});

test('returns unknown for null input', () => {
  assert.equal(classifyWho(null), "unknown");
});

test('returns machine for agent tag pattern', () => {
  assert.equal(classifyWho('abc-123-def'), "machine");
});

test('returns machine for known machine name claude-code', () => {
  assert.equal(classifyWho('claude-code'), "machine");
});

test('returns machine for known machine name renovate', () => {
  assert.equal(classifyWho('renovate[bot]'), "machine");
});

test('returns machine for token bot in name', () => {
  assert.equal(classifyWho('my-bot'), "machine");
});

test('returns human for plain name sam', () => {
  assert.equal(classifyWho('sam'), "human");
});

test('returns human for email address', () => {
  assert.equal(classifyWho('sam@agency.example.test'), "human");
});

test('returns human for name with no machine indicators', () => {
  assert.equal(classifyWho('john smith'), "human");
});
