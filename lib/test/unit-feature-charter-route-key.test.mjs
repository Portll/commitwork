// Computes the route key for a path (lib/feature-charter.mjs routeKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeKey } from '../feature-charter.mjs';

test('returns the first segment for a non-api path', () => {
  const r = routeKey('users/list');
  assert.equal(r, "users");
});

test('returns the second segment for an api path', () => {
  const r = routeKey('api/users');
  assert.equal(r, "users");
});

test('returns root for an empty api path', () => {
  const r = routeKey('api');
  assert.equal(r, "(root)");
});

test('returns root for an empty string', () => {
  const r = routeKey('');
  assert.equal(r, "(root)");
});

test('returns root for undefined input', () => {
  const r = routeKey(undefined);
  assert.equal(r, "(root)");
});

test('ignores query strings in the path', () => {
  const r = routeKey('api/users?id=1');
  assert.equal(r, "users");
});

test('returns the first segment for a single non-api segment', () => {
  const r = routeKey('users');
  assert.equal(r, "users");
});

test('returns the second segment for a deep api path', () => {
  const r = routeKey('api/users/123');
  assert.equal(r, "users");
});
