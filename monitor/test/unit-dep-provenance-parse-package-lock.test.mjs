// Maps package-lock entries to their resolution class and target URL (monitor/dep-provenance.mjs parsePackageLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackageLock } from '../dep-provenance.mjs';

test('returns empty object when doc is null', () => {
  const r = parsePackageLock(null);
  assert.deepEqual(r, {});
});

test('returns empty object when doc is undefined', () => {
  const r = parsePackageLock(undefined);
  assert.deepEqual(r, {});
});

test('returns empty object when doc has no packages or dependencies', () => {
  const r = parsePackageLock({});
  assert.deepEqual(r, {});
});

test('skips root project entry with empty path', () => {
  const r = parsePackageLock({ packages: { '': { name: 'root', version: '1.0.0' } } });
  assert.deepEqual(r, {});
});

test('skips entry with empty path and null value', () => {
  const r = parsePackageLock({ packages: { '': null } });
  assert.deepEqual(r, {});
});

test('extracts name from path when entry has no name property', () => {
  const r = parsePackageLock({ packages: { 'node_modules/foo': { version: '1.0.0' } } });
  assert.deepEqual(r, { foo: { resolution: "unknown", target: "" } });
});

test('classifies registry URL from packages entry', () => {
  const r = parsePackageLock({ packages: { 'node_modules/foo': { name: 'foo', resolved: 'https://registry.npmjs.org/foo/-/foo-1.0.0.tgz' } } });
  assert.deepEqual(r, { foo: { resolution: "registry", target: "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz" } });
});

test('classifies git URL from packages entry', () => {
  const r = parsePackageLock({ packages: { 'node_modules/foo': { name: 'foo', resolved: 'git+https://github.com/user/repo.git' } } });
  assert.deepEqual(r, { foo: { resolution: "git", target: "git+https://github.com/user/repo.git" } });
});

test('classifies file link when resolved is absent but link is true', () => {
  const r = parsePackageLock({ packages: { 'node_modules/foo': { name: 'foo', link: true } } });
  assert.deepEqual(r, { foo: { resolution: "file", target: "" } });
});

test('walks dependencies and does not overwrite existing packages entry', () => {
  const r = parsePackageLock({
    packages: { 'node_modules/foo': { name: 'foo', resolved: 'https://registry.npmjs.org/foo/-/foo-1.0.0.tgz' } },
    dependencies: { foo: { resolved: 'git+https://github.com/user/repo.git' } }
  });
  assert.deepEqual(r, { foo: { resolution: "registry", target: "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz" } });
});
