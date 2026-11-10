// Classifies a GitHub Actions ref as unpinnable (monitor/workflow-harden.mjs unpinnable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpinnable } from '../workflow-harden.mjs';

test('returns local-action for a relative path starting with dot slash', () => {
  const r = unpinnable('./actions/setup', 'v1');
  assert.equal(r, "local-action");
});

test('returns local-action for a relative path starting with dot dot slash', () => {
  const r = unpinnable('../shared/action', 'v2');
  assert.equal(r, "local-action");
});

test('returns docker-image for a docker image reference', () => {
  const r = unpinnable('docker://alpine', 'latest');
  assert.equal(r, "docker-image");
});

test('returns already-pinned when the ref is a full commit sha', () => {
  const sha = 'a'.repeat(40);
  const r = unpinnable('actions/checkout', sha);
  assert.equal(r, "already-pinned");
});

test('returns unrecognised when the action name is invalid', () => {
  const r = unpinnable('bad action', 'v1');
  assert.equal(r, "unrecognised");
});

test('returns unrecognised when the ref is invalid', () => {
  const r = unpinnable('actions/checkout', 'bad ref');
  assert.equal(r, "unrecognised");
});

test('returns null for a valid action and ref', () => {
  const r = unpinnable('actions/checkout', 'v4');
  assert.equal(r, null);
});

test('returns unrecognised when both action and ref are invalid', () => {
  const r = unpinnable('bad action', 'bad ref');
  assert.equal(r, "unrecognised");
});
