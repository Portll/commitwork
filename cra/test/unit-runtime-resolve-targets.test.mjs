// Maps registry projects and CLI URLs to deduplicated runtime targets (cra/runtime.mjs resolveTargets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargets } from '../runtime.mjs';

test('returns empty array when registry has no projects', () => {
  const reg = {};
  const result = resolveTargets(reg);
  assert.deepEqual(result, []);
});

test('includes project with URL from project.url', () => {
  const reg = { projects: [{ name: 'svc', path: 'svc', url: 'http://a' }] };
  const result = resolveTargets(reg);
  assert.deepEqual(result, [{ name: 'svc', path: 'svc', url: 'http://a', manifest: undefined }]);
});

test('excludes project without any URL', () => {
  const reg = { projects: [{ name: 'svc', path: 'svc' }] };
  const result = resolveTargets(reg);
  assert.deepEqual(result, []);
});

test('prefers CLI URL over project URL', () => {
  const reg = { projects: [{ name: 'svc', path: 'svc', url: 'http://a' }] };
  const result = resolveTargets(reg, { urls: { svc: 'http://b' } });
  assert.deepEqual(result, [{ name: 'svc', path: 'svc', url: 'http://b', manifest: undefined }]);
});

test('falls back to registry URL when project has no URL', () => {
  const reg = { projects: [{ name: 'svc', path: 'svc' }], urls: { svc: 'http://c' } };
  const result = resolveTargets(reg);
  assert.deepEqual(result, [{ name: 'svc', path: 'svc', url: 'http://c', manifest: undefined }]);
});

test('expands children using union of URL keys', () => {
  const reg = {
    projects: [{ name: 'app', path: 'app', expand: 'children', urls: { a: 'http://a' } }],
    urls: { b: 'http://b' }
  };
  const result = resolveTargets(reg);
  assert.deepEqual(result, [
    { name: 'a', path: 'app/a', url: 'http://a', manifest: undefined },
    { name: 'b', path: 'app/b', url: 'http://b', manifest: undefined }
  ]);
});

test('filters children by opts.only', () => {
  const reg = {
    projects: [{ name: 'app', path: 'app', expand: 'children', urls: { a: 'http://a', b: 'http://b' } }]
  };
  const result = resolveTargets(reg, { only: 'b' });
  assert.deepEqual(result, [{ name: 'b', path: 'app/b', url: 'http://b', manifest: undefined }]);
});

test('deduplicates targets by name', () => {
  const reg = {
    projects: [
      { name: 'svc', path: 'p1', url: 'http://1' },
      { name: 'svc', path: 'p2', url: 'http://2' }
    ]
  };
  const result = resolveTargets(reg);
  assert.deepEqual(result, [{ name: 'svc', path: 'p1', url: 'http://1', manifest: undefined }]);
});
