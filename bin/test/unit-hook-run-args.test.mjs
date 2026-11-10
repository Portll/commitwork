// Builds the CLI argument array for the commit hook (bin/hook.mjs runArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runArgs } from '../hook.mjs';

test('builds lanes and unrun with both flags enabled', () => {
  const r = runArgs({ lanes: ['a', 'b'], unrun: 'x', failOnContext: true, blockExisting: true });
  assert.deepEqual(r, ["--lanes", "a,b", "--unrun", "x", "--fail-on-context", "--block-existing"]);
});

test('builds lanes and unrun with both flags disabled', () => {
  const r = runArgs({ lanes: ['a', 'b'], unrun: 'x', failOnContext: false, blockExisting: false });
  assert.deepEqual(r, ["--lanes", "a,b", "--unrun", "x"]);
});

test('builds lanes and unrun with only failOnContext enabled', () => {
  const r = runArgs({ lanes: ['a', 'b'], unrun: 'x', failOnContext: true, blockExisting: false });
  assert.deepEqual(r, ["--lanes", "a,b", "--unrun", "x", "--fail-on-context"]);
});

test('builds lanes and unrun with only blockExisting enabled', () => {
  const r = runArgs({ lanes: ['a', 'b'], unrun: 'x', failOnContext: false, blockExisting: true });
  assert.deepEqual(r, ["--lanes", "a,b", "--unrun", "x", "--block-existing"]);
});

test('builds lanes and unrun with single lane and both flags enabled', () => {
  const r = runArgs({ lanes: ['solo'], unrun: 'y', failOnContext: true, blockExisting: true });
  assert.deepEqual(r, ["--lanes", "solo", "--unrun", "y", "--fail-on-context", "--block-existing"]);
});

test('builds lanes and unrun with empty lanes and both flags disabled', () => {
  const r = runArgs({ lanes: [], unrun: 'z', failOnContext: false, blockExisting: false });
  assert.deepEqual(r, ["--lanes", "", "--unrun", "z"]);
});

test('builds lanes and unrun with three lanes and both flags enabled', () => {
  const r = runArgs({ lanes: ['a', 'b', 'c'], unrun: 'w', failOnContext: true, blockExisting: true });
  assert.deepEqual(r, ["--lanes", "a,b,c", "--unrun", "w", "--fail-on-context", "--block-existing"]);
});

test('builds lanes and unrun with empty unrun and both flags disabled', () => {
  const r = runArgs({ lanes: ['a'], unrun: '', failOnContext: false, blockExisting: false });
  assert.deepEqual(r, ["--lanes", "a", "--unrun", ""]);
});
