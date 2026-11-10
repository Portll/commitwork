// extracts the first non-flag argument or the value after -p/--package (bin/agent-config.mjs npxPackage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npxPackage } from '../agent-config.mjs';

test('returns empty string for empty args array', () => {
  assert.equal(npxPackage([]), '');
});

test('returns empty string for undefined args', () => {
  assert.equal(npxPackage(undefined), '');
});

test('returns first non-flag argument', () => {
  assert.equal(npxPackage(['-v', 'my-package']), 'my-package');
});

test('returns value after -p flag', () => {
  assert.equal(npxPackage(['-p', 'pkg-name']), 'pkg-name');
});

test('returns value after --package flag', () => {
  assert.equal(npxPackage(['--package', 'other-pkg']), 'other-pkg');
});

test('returns empty string when -p is last argument', () => {
  assert.equal(npxPackage(['-p']), '');
});

test('returns empty string when --package is last argument', () => {
  assert.equal(npxPackage(['--package']), '');
});

test('returns first non-flag when flags precede it', () => {
  assert.equal(npxPackage(['-a', '-b', 'target']), 'target');
});

test('returns empty string when all args are flags', () => {
  assert.equal(npxPackage(['-x', '-y', '-z']), '');
});

test('returns first argument when no flags present', () => {
  assert.equal(npxPackage(['direct-pkg', 'extra']), 'direct-pkg');
});
