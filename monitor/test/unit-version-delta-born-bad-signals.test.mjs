// Computes which bad-signal classes are present in a first-seen observation (monitor/version-delta.mjs bornBadSignals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bornBadSignals } from '../version-delta.mjs';

test('includes all classes when every signal is present', () => {
  const input = {
    scripts: ['install'],
    capabilities: ['cap1'],
    minified: 5,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://gitlab.com/other/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["install-script", "capability", "minified-blob", "registry-identity"]);
});

test('does not include INSTALL_SCRIPT when scripts is not an array', () => {
  const input = {
    scripts: null,
    capabilities: ['cap1'],
    minified: 5,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://github.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["capability", "minified-blob"]);
});

test('does not include INSTALL_SCRIPT when scripts array lacks lifecycle entries', () => {
  const input = {
    scripts: ['test', 'build'],
    capabilities: ['cap1'],
    minified: 5,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://github.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["capability", "minified-blob"]);
});

test('does not include CAPABILITY when capabilities array is empty', () => {
  const input = {
    scripts: ['install'],
    capabilities: [],
    minified: 5,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://github.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["install-script", "minified-blob"]);
});

test('does not include CAPABILITY when capabilities is not an array', () => {
  const input = {
    scripts: ['install'],
    capabilities: null,
    minified: 5,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://github.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["install-script", "minified-blob"]);
});

test('does not include MINIFIED when minified is zero', () => {
  const input = {
    scripts: ['install'],
    capabilities: ['cap1'],
    minified: 0,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://github.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["install-script", "capability"]);
});

test('does not include MINIFIED when minified is negative', () => {
  const input = {
    scripts: ['install'],
    capabilities: ['cap1'],
    minified: -3,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://github.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["install-script", "capability"]);
});

test('does not include MINIFIED when minified is not a number', () => {
  const input = {
    scripts: ['install'],
    capabilities: ['cap1'],
    minified: 'yes',
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://github.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["install-script", "capability"]);
});

test('includes IDENTITY when declaredRepo and registryIdentity diverge', () => {
  const input = {
    scripts: ['install'],
    capabilities: ['cap1'],
    minified: 5,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://gitlab.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["install-script", "capability", "minified-blob"]);
});

test('does not include IDENTITY when declaredRepo and registryIdentity are the same', () => {
  const input = {
    scripts: ['install'],
    capabilities: ['cap1'],
    minified: 5,
    declaredRepo: 'https://github.com/user/repo',
    registryIdentity: 'https://github.com/user/repo',
  };
  const result = bornBadSignals(input);
  assert.deepEqual(result, ["install-script", "capability", "minified-blob"]);
});
