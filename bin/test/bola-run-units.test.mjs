// bin/test/bola-run-units.test.mjs — case tests for assertTrusted, normBody, resolveObjects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrusted, normBody, resolveObjects } from '../bola-run.mjs';

test('returns undefined when source is "bundled"', () => {
  const result = assertTrusted('bundled', '/some/path.json', {});
  assert.equal(result, undefined);
});

test('returns undefined when opts.trustRepoManifest is true', () => {
  const result = assertTrusted('repo', '/some/path.json', { trustRepoManifest: true });
  assert.equal(result, undefined);
});

test('throws when source is not "bundled" and no trust opt-in', () => {
  assert.throws(
    () => assertTrusted('repo', '/some/path.json', {}),
    /refusing to run a repo BOLA manifest/
  );
});

test('throws with specific path in error message', () => {
  assert.throws(
    () => assertTrusted('external', '/my/manifest.json', {}),
    (err) => {
      assert.match(err.message, /refusing to run a external BOLA manifest \(\/my\/manifest\.json\)/);
      return true;
    }
  );
});

test('throws when source is "declared" and no trust opt-in', () => {
  assert.throws(
    () => assertTrusted('declared', '/path/to/manifest.json', {}),
    /refusing to run a declared BOLA manifest/
  );
});

test('returns undefined when opts.trustRepoManifest is true even for non-bundled source', () => {
  const result = assertTrusted('external', '/some/path.json', { trustRepoManifest: true });
  assert.equal(result, undefined);
});

test('returns null when res is null', () => {
  assert.equal(normBody(null), null);
});

test('returns null when res is undefined', () => {
  assert.equal(normBody(undefined), null);
});

test('returns null when res has no text property', () => {
  assert.equal(normBody({}), null);
});

test('returns null when text is not a string (number)', () => {
  assert.equal(normBody({ text: 123 }), null);
});

test('returns null when text is not a string (object)', () => {
  assert.equal(normBody({ text: { a: 1 } }), null);
});

test('normalizes whitespace and trims for a string text', () => {
  assert.equal(normBody({ text: '  hello   world  ' }), 'hello world');
});

test('collapses newlines and tabs into single spaces', () => {
  assert.equal(normBody({ text: 'a\nb\tc' }), 'a b c');
});

test('returns empty string for whitespace-only text', () => {
  assert.equal(normBody({ text: '   \n\t  ' }), '');
});

test('returns empty items and voids when objects is null', async () => {
  const result = await resolveObjects('http://localhost', null, new Map());
  assert.deepEqual(result, { items: [], voids: [] });
});

test('returns empty items and voids when objects is undefined', async () => {
  const result = await resolveObjects('http://localhost', undefined, new Map());
  assert.deepEqual(result, { items: [], voids: [] });
});

test('declared model with valid owner adds item with path placeholder replaced', async () => {
  const actors = new Map([['alice', { name: 'alice', void: null }]]);
  const objects = { model: 'declared', items: [{ path: '/api/users/{id}', owner: 'alice' }] };
  const result = await resolveObjects('http://localhost', objects, actors);
  assert.deepEqual(result.items, [{ type: 'declared', path: '/api/users/1', owner: 'alice' }]);
  assert.deepEqual(result.voids, []);
});

test('declared model with unknown owner adds void message', async () => {
  const actors = new Map([['alice', { name: 'alice', void: null }]]);
  const objects = { model: 'declared', items: [{ path: '/api/users/{id}', owner: 'bob' }] };
  const result = await resolveObjects('http://localhost', objects, actors);
  assert.deepEqual(result.items, []);
  assert.equal(result.voids.length, 1);
  assert.match(result.voids[0], /owner "bob" is not a declared actor/);
});

test('declared model with void owner adds void message', async () => {
  const actors = new Map([['alice', { name: 'alice', void: 'no token' }]]);
  const objects = { model: 'declared', items: [{ path: '/api/users/{id}', owner: 'alice' }] };
  const result = await resolveObjects('http://localhost', objects, actors);
  assert.deepEqual(result.items, []);
  assert.equal(result.voids.length, 1);
  assert.match(result.voids[0], /unmintable \(no token\)/);
});

test('declared model with empty items array returns empty items', async () => {
  const actors = new Map();
  const objects = { model: 'declared', items: [] };
  const result = await resolveObjects('http://localhost', objects, actors);
  assert.deepEqual(result, { items: [], voids: [] });
});

test('declared model with missing items property returns empty items', async () => {
  const actors = new Map();
  const objects = { model: 'declared' };
  const result = await resolveObjects('http://localhost', objects, actors);
  assert.deepEqual(result, { items: [], voids: [] });
});
