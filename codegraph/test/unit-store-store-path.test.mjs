// Joins the codegraph store directory with a file name (codegraph/store.mjs storePath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storePath } from '../store.mjs';
import { join, resolve } from 'node:path';

test('uses the default store directory when the env var is absent', () => {
  const env = {};
  assert.equal(storePath('graph.json', env), join(resolve('reports/codegraph'), 'graph.json'));
});

test('uses the CW_CODEGRAPH_STORE value when it is set', () => {
  const env = { CW_CODEGRAPH_STORE: '/tmp/cw-store' };
  assert.equal(storePath('graph.json', env), join(resolve('/tmp/cw-store'), 'graph.json'));
});

test('resolves a relative CW_CODEGRAPH_STORE against the current working directory', () => {
  const env = { CW_CODEGRAPH_STORE: 'custom-store' };
  assert.equal(storePath('graph.json', env), join(resolve('custom-store'), 'graph.json'));
});

test('joins a name containing a slash with the store directory', () => {
  const env = {};
  assert.equal(storePath('sub/dir/file.json', env), join(resolve('reports/codegraph'), 'sub/dir/file.json'));
});

test('joins a name containing a dot segment with the store directory', () => {
  const env = {};
  assert.equal(storePath('./file.json', env), join(resolve('reports/codegraph'), './file.json'));
});

test('joins a name containing a parent segment with the store directory', () => {
  const env = {};
  assert.equal(storePath('../file.json', env), join(resolve('reports/codegraph'), '../file.json'));
});

test('joins a long repeated name with the store directory', () => {
  const env = {};
  const name = 'x'.repeat(1000);
  assert.equal(storePath(name, env), join(resolve('reports/codegraph'), name));
});

test('joins an empty name with the store directory', () => {
  const env = {};
  assert.equal(storePath('', env), join(resolve('reports/codegraph'), ''));
});
