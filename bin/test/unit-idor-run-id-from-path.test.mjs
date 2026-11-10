// Extracts the numeric id from a path using a template (bin/idor-run.mjs idFromPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idFromPath } from '../idor-run.mjs';

test('returns null when the template has no id placeholder', () => {
  const r = idFromPath('/users', '/users/1');
  assert.equal(r, null);
});

test('returns the id when the template starts with the placeholder', () => {
  const r = idFromPath('{id}/details', '/42/details');
  assert.equal(r, null);
});

test('returns the id when the placeholder is in the middle of the template', () => {
  const r = idFromPath('/api/v1/users/{id}/profile', '/api/v1/users/99/profile');
  assert.equal(r, "99");
});

test('returns the id when the template ends with the placeholder', () => {
  const r = idFromPath('/items/{id}', '/items/7');
  assert.equal(r, "7");
});

test('returns null when the item path does not match the template prefix', () => {
  const r = idFromPath('/api/v1/users/{id}/profile', '/api/v2/users/99/profile');
  assert.equal(r, null);
});

test('returns null when the item path does not match the template suffix', () => {
  const r = idFromPath('/api/v1/users/{id}/profile', '/api/v1/users/99/settings');
  assert.equal(r, null);
});

test('returns null when the extracted segment is not a plain integer', () => {
  const r = idFromPath('/items/{id}', '/items/abc');
  assert.equal(r, null);
});

test('returns null when the extracted segment is empty', () => {
  const r = idFromPath('/items/{id}', '/items/');
  assert.equal(r, null);
});
