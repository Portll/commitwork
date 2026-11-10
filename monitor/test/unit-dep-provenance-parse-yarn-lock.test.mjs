// Parses yarn.lock text into a map of package names to resolution metadata (monitor/dep-provenance.mjs parseYarnLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYarnLock } from '../dep-provenance.mjs';

test('returns empty object for empty string input', () => {
  assert.deepEqual(parseYarnLock(''), {});
});

test('returns empty object for null input', () => {
  assert.deepEqual(parseYarnLock(null), {});
});

test('returns empty object for undefined input', () => {
  assert.deepEqual(parseYarnLock(undefined), {});
});

test('parses a simple registry resolution', () => {
  const input = 'lodash@^4.17.21:\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"';
  assert.deepEqual(parseYarnLock(input), { lodash: { resolution: "registry", target: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz" } });
});

test('parses a git resolution', () => {
  const input = 'mylib@1.0.0:\n  resolved "git+https://github.com/user/repo.git#abc123"';
  assert.deepEqual(parseYarnLock(input), { mylib: { resolution: "git", target: "git+https://github.com/user/repo.git#abc123" } });
});

test('parses a file resolution', () => {
  const input = 'local-pkg@1.0.0:\n  resolved "file:../local-pkg"';
  assert.deepEqual(parseYarnLock(input), { "local-pkg": { resolution: "file", target: "file:../local-pkg" } });
});

test('parses a berry-style npm: resolution', () => {
  const input = 'pkg@npm:1.2.3:\n  resolved "pkg@npm:1.2.3"';
  assert.deepEqual(parseYarnLock(input), { pkg: { resolution: "registry", target: "pkg@npm:1.2.3" } });
});

test('parses a berry-style https resolution', () => {
  const input = 'pkg@https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz:\n  resolved "pkg@https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz"';
  assert.deepEqual(parseYarnLock(input), { pkg: { resolution: "registry", target: "pkg@https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz" } });
});

test('parses a scoped package registry resolution', () => {
  const input = '@babel/code-frame@^7.26.2:\n  resolved "https://registry.npmjs.org/@babel/code-frame/-/code-frame-7.26.2.tgz"';
  assert.deepEqual(parseYarnLock(input), { "@babel/code-frame": { resolution: "registry", target: "https://registry.npmjs.org/@babel/code-frame/-/code-frame-7.26.2.tgz" } });
});

test('parses multiple comma-separated specifiers', () => {
  const input = 'lodash@^4.17.21, lodash@~4.17.0:\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"';
  assert.deepEqual(parseYarnLock(input), { lodash: { resolution: "registry", target: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz" } });
});
