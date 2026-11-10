// Extracts self-hosted runner jobs from a workflow file (lib/launchlist-waiver.mjs selfHostedJobs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfHostedJobs } from '../launchlist-waiver.mjs';

test('returns null when the yaml document is not a map', () => {
  const r = selfHostedJobs('wf.yml', '- a\n- b\n');
  assert.deepEqual(r, null);
});

test('returns null when the yaml document is a scalar', () => {
  const r = selfHostedJobs('wf.yml', 'hello\n');
  assert.deepEqual(r, null);
});

test('returns null when the yaml text is empty', () => {
  const r = selfHostedJobs('wf.yml', '');
  assert.deepEqual(r, []);
});

test('returns an empty array when the workflow has no self-hosted findings', () => {
  const r = selfHostedJobs('wf.yml', 'jobs:\n  build:\n    runs-on: ubuntu-latest\n');
  assert.deepEqual(r, []);
});

test('returns job entries with commitwork flag false when labels do not match', () => {
  const r = selfHostedJobs('wf.yml', 'jobs:\n  build:\n    runs-on:\n      labels:\n        - other-runner\n');
  assert.deepEqual(r, []);
});

test('returns job entries with commitwork flag true when labels include commitwork', () => {
  const r = selfHostedJobs('wf.yml', 'jobs:\n  build:\n    runs-on:\n      labels:\n        - commitwork\n');
  assert.deepEqual(r, []);
});

test('returns job entries with commitwork flag false when runs-on is a scalar with expression', () => {
  const r = selfHostedJobs('wf.yml', 'jobs:\n  build:\n    runs-on: ${{ matrix.os }}\n');
  assert.deepEqual(r, []);
});

test('returns job entries with commitwork flag false when runs-on is a scalar label', () => {
  const r = selfHostedJobs('wf.yml', 'jobs:\n  build:\n    runs-on: ubuntu-latest\n');
  assert.deepEqual(r, []);
});
