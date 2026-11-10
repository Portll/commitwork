// Builds a namespaced node identifier string (flow/graph.mjs nodeId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeId } from '../graph.mjs';

test('returns prefixed id for valid module kind', () => {
  const r = nodeId('module', 'src/app');
  assert.equal(r, "node:module:src/app");
});

test('returns prefixed id for valid artifact kind', () => {
  const r = nodeId('artifact', 'build/out');
  assert.equal(r, "node:artifact:build/out");
});

test('returns prefixed id for valid store kind', () => {
  const r = nodeId('store', 'cache');
  assert.equal(r, "node:store:cache");
});

test('returns prefixed id for valid env kind', () => {
  const r = nodeId('env', 'prod');
  assert.equal(r, "node:env:prod");
});

test('returns prefixed id for valid process kind', () => {
  const r = nodeId('process', 'worker');
  assert.equal(r, "node:process:worker");
});

test('throws for unknown node kind', () => {
  assert.throws(() => nodeId('bogus', 'key'), {
    name: 'Error',
    message: 'unknown node kind bogus'
  });
});

test('returns prefixed id when key is empty string', () => {
  const r = nodeId('module', '');
  assert.equal(r, "node:module:");
});

test('returns prefixed id when key is a long repeated string', () => {
  const r = nodeId('artifact', 'x'.repeat(100));
  assert.equal(r, "node:artifact:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});
