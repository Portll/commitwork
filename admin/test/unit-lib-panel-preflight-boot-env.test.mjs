// Computes a sanitized environment object with scratch-based store paths and zeroed ports (admin/lib/panel-preflight.mjs bootEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootEnv } from '../lib/panel-preflight.mjs';

test('sets CW_PANEL_PREFLIGHT to 1 and CW_ADMIN_PORT to 0', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.CW_PANEL_PREFLIGHT, '1');
  assert.equal(env.CW_ADMIN_PORT, '0');
});

test('sets CW_ADMIN_LOCAL_PORT to 0', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.CW_ADMIN_LOCAL_PORT, '0');
});

test('sets HOME and USERPROFILE to the scratch directory', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.HOME, '/scratch');
  assert.equal(env.USERPROFILE, '/scratch');
});

test('sets TMPDIR, TMP, and TEMP to scratch/tmp', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.TMPDIR, '/scratch/tmp');
  assert.equal(env.TMP, '/scratch/tmp');
  assert.equal(env.TEMP, '/scratch/tmp');
});

test('sets CW_AUTH_STORE to scratch/users.json', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.CW_AUTH_STORE, '/scratch/users.json');
});

test('sets CW_SESSION_STORE to scratch/sessions.json', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.CW_SESSION_STORE, '/scratch/sessions.json');
});

test('sets CW_HEALTH_RUNS_STORE to scratch/health-runs.json', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.CW_HEALTH_RUNS_STORE, '/scratch/health-runs.json');
});

test('sets CW_PANEL_CODE_STAMP to scratch/code-stamp.json', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.CW_PANEL_CODE_STAMP, '/scratch/code-stamp.json');
});

test('sets DOCKER_CONFIG and CW_DOCKER_CONFIG to scratch/docker', () => {
  const env = bootEnv('/scratch');
  assert.equal(env.DOCKER_CONFIG, '/scratch/docker');
  assert.equal(env.CW_DOCKER_CONFIG, '/scratch/docker');
});

test('removes CW_PANEL_SUPERVISED from the environment', () => {
  const base = { CW_PANEL_SUPERVISED: '1', PATH: '/usr/bin' };
  const env = bootEnv('/scratch', base);
  assert.equal(env.CW_PANEL_SUPERVISED, undefined);
  assert.equal(env.PATH, '/usr/bin');
});
