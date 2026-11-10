// Builds a node object with schema version, id, kind, path, and lastWriteAt (flow/graph.mjs makeNode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNode } from '../graph.mjs';

test('returns an object with v, id, kind, path, and lastWriteAt for a valid kind', () => {
  const r = makeNode('module', 'src/index.js');
  assert.deepEqual(r, { v: 1, id: "node:module:src/index.js", kind: "module", path: "src/index.js", lastWriteAt: null });
});

test('returns an object with v, id, kind, path, and lastWriteAt for an artifact kind', () => {
  const r = makeNode('artifact', 'dist/bundle.js');
  assert.deepEqual(r, { v: 1, id: "node:artifact:dist/bundle.js", kind: "artifact", path: "dist/bundle.js", lastWriteAt: null });
});

test('returns an object with v, id, kind, path, and lastWriteAt for a store kind', () => {
  const r = makeNode('store', 'data/cache.json');
  assert.deepEqual(r, { v: 1, id: "node:store:data/cache.json", kind: "store", path: "data/cache.json", lastWriteAt: null });
});

test('returns an object with v, id, kind, path, and lastWriteAt for an env kind', () => {
  const r = makeNode('env', 'prod');
  assert.deepEqual(r, { v: 1, id: "node:env:prod", kind: "env", path: "prod", lastWriteAt: null });
});

test('returns an object with v, id, kind, path, and lastWriteAt for a process kind', () => {
  const r = makeNode('process', 'build');
  assert.deepEqual(r, { v: 1, id: "node:process:build", kind: "process", path: "build", lastWriteAt: null });
});

test('throws an error with the exact message for an unknown kind', () => {
  assert.throws(() => makeNode('unknown', 'key'), { name: 'Error', message: 'unknown node kind unknown' });
});

test('merges extra properties into the returned object', () => {
  const r = makeNode('module', 'src/app.js', { size: 1024, owner: 'team-a' });
  assert.deepEqual(r, { v: 1, id: "node:module:src/app.js", kind: "module", path: "src/app.js", lastWriteAt: null, size: 1024, owner: "team-a" });
});

test('returns an object with v, id, kind, path, and lastWriteAt when extra is an empty object', () => {
  const r = makeNode('artifact', 'out/main.js', {});
  assert.deepEqual(r, { v: 1, id: "node:artifact:out/main.js", kind: "artifact", path: "out/main.js", lastWriteAt: null });
});

test('returns an object with v, id, kind, path, and lastWriteAt when extra is omitted', () => {
  const r = makeNode('env', 'dev');
  assert.deepEqual(r, { v: 1, id: "node:env:dev", kind: "env", path: "dev", lastWriteAt: null });
});

test('returns an object with v, id, kind, path, and lastWriteAt for a key with special characters', () => {
  const r = makeNode('module', 'src/a-b/c_d/e.js');
  assert.deepEqual(r, { v: 1, id: "node:module:src/a-b/c_d/e.js", kind: "module", path: "src/a-b/c_d/e.js", lastWriteAt: null });
});
