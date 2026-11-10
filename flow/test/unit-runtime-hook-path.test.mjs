// Absolute path of trace-hook.cjs next to runtime.mjs (flow/runtime.mjs hookPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookPath } from '../runtime.mjs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const flowDir = resolve(testDir, '..');

test('returns trace-hook.cjs inside the directory that holds runtime.mjs', () => {
  assert.equal(hookPath(), join(flowDir, 'trace-hook.cjs'));
});

test('matches the file URL of trace-hook.cjs resolved from the test directory', () => {
  assert.equal(hookPath(), fileURLToPath(new URL('../trace-hook.cjs', import.meta.url)));
});

test('has the file name trace-hook.cjs', () => {
  assert.equal(basename(hookPath()), 'trace-hook.cjs');
});

test('has the extension .cjs', () => {
  assert.equal(extname(hookPath()), '.cjs');
});

test('sits in the same directory as runtime.mjs', () => {
  assert.equal(dirname(hookPath()), dirname(fileURLToPath(new URL('../runtime.mjs', import.meta.url))));
});

test('sits in a directory named flow', () => {
  assert.equal(basename(dirname(hookPath())), 'flow');
});

test('is an absolute path', () => {
  assert.equal(isAbsolute(hookPath()), true);
});

test('is already normalized so resolving it again gives the same path', () => {
  const r = hookPath();
  assert.equal(resolve(r), r);
});
