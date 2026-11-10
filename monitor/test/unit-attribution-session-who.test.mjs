// Computes the display identity string for a session (monitor/attribution.mjs sessionWho).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionWho } from '../attribution.mjs';

test('returns empty string when session is null', () => {
  const r = sessionWho(null);
  assert.equal(r, "");
});

test('returns empty string when session is undefined', () => {
  const r = sessionWho(undefined);
  assert.equal(r, "");
});

test('returns empty string when user is not a string', () => {
  const r = sessionWho({ user: 123 });
  assert.equal(r, "");
});

test('returns trimmed email when user is a string with no provider', () => {
  const r = sessionWho({ user: '  alice@example.com  ' });
  assert.equal(r, "alice@example.com");
});

test('returns email with provider suffix when provider is present', () => {
  const r = sessionWho({ user: 'bob@example.com', provider: 'sso' });
  assert.equal(r, "bob@example.com (sso)");
});

test('returns empty string when user is an empty string', () => {
  const r = sessionWho({ user: '' });
  assert.equal(r, "");
});

test('returns empty string when user is whitespace only', () => {
  const r = sessionWho({ user: '   ' });
  assert.equal(r, "");
});

test('returns email with provider when provider is empty string', () => {
  const r = sessionWho({ user: 'carol@example.com', provider: '' });
  assert.equal(r, "carol@example.com");
});
