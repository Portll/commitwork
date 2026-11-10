// Resolves the gh token for a sandboxed lane that declares the gh store and runs no repo code. (bin/lib/scanner-env.mjs laneCredentialEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneCredentialEnv } from '../lib/scanner-env.mjs';

test('returns empty object when sandboxExtraReads is undefined', () => {
  const r = laneCredentialEnv({}, {}, () => 'tok');
  assert.deepEqual(r, {});
});

test('returns empty object when sandboxExtraReads does not include the gh store', () => {
  const r = laneCredentialEnv({ sandboxExtraReads: ['/other'] }, {}, () => 'tok');
  assert.deepEqual(r, {});
});

test('returns empty object when the lane executes repository code', () => {
  const r = laneCredentialEnv({ sandboxExtraReads: ['~/.config/gh'], executesRepoCode: true }, {}, () => 'tok');
  assert.deepEqual(r, {});
});

test('returns empty object when CI is set in the environment', () => {
  const r = laneCredentialEnv({ sandboxExtraReads: ['~/.config/gh'] }, { CI: 'true' }, () => 'tok');
  assert.deepEqual(r, {});
});

test('returns empty object when GH_TOKEN is already set in the environment', () => {
  const r = laneCredentialEnv({ sandboxExtraReads: ['~/.config/gh'] }, { GH_TOKEN: 'existing' }, () => 'tok');
  assert.deepEqual(r, {});
});

test('returns empty object when GITHUB_TOKEN is already set in the environment', () => {
  const r = laneCredentialEnv({ sandboxExtraReads: ['~/.config/gh'] }, { GITHUB_TOKEN: 'existing' }, () => 'tok');
  assert.deepEqual(r, {});
});

test('returns the resolved token when the lane is eligible and a token is found', () => {
  const r = laneCredentialEnv({ sandboxExtraReads: ['~/.config/gh'] }, {}, () => 'resolved-token');
  assert.deepEqual(r, { GH_TOKEN: "resolved-token" });
});

test('returns empty object when the lane is eligible but no token is found', () => {
  const r = laneCredentialEnv({ sandboxExtraReads: ['~/.config/gh'] }, {}, () => null);
  assert.deepEqual(r, {});
});
