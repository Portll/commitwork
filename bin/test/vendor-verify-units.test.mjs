// bin/test/vendor-verify-units.test.mjs — case tests for joinUrl.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinUrl } from '../vendor-verify.mjs';

test('joins base and rest with a single slash', () => {
  assert.equal(joinUrl('https://registry.npmjs.org', 'three/0.147.0'), 'https://registry.npmjs.org/three/0.147.0');
});

test('strips trailing slashes from base and leading slashes from rest', () => {
  assert.equal(joinUrl('https://registry.npmjs.org/', '/three/0.147.0'), 'https://registry.npmjs.org/three/0.147.0');
});

test('returns rest unchanged when it is an absolute URL', () => {
  assert.equal(joinUrl('https://registry.npmjs.org', 'https://example.com/pkg'), 'https://example.com/pkg');
});

test('returns rest unchanged when it is a file URL', () => {
  assert.equal(joinUrl('https://registry.npmjs.org', 'file:///tmp/pkg.tgz'), 'file:///tmp/pkg.tgz');
});

test('handles multiple trailing slashes on base', () => {
  assert.equal(joinUrl('https://registry.npmjs.org///', 'pkg'), 'https://registry.npmjs.org/pkg');
});

test('handles multiple leading slashes on rest', () => {
  assert.equal(joinUrl('https://registry.npmjs.org', '///pkg'), 'https://registry.npmjs.org/pkg');
});

test('returns rest unchanged for protocol-relative or other scheme-like strings', () => {
  assert.equal(joinUrl('https://registry.npmjs.org', 'ftp://host/file'), 'ftp://host/file');
});
