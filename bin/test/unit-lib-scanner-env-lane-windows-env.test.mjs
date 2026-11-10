// Windows lane environment overrides (bin/lib/scanner-env.mjs laneWindowsEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneWindowsEnv } from '../lib/scanner-env.mjs';

test('returns empty object when platform is not win32', () => {
  const check = { requires: { tools: ['semgrep'] } };
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'linux', container: false });
  assert.deepEqual(result, {});
});

test('returns empty object when platform is win32 with no cpython tools and no container', () => {
  const check = { requires: { tools: ['ruff'] } };
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, {});
});

test('sets PYTHONUTF8 when cpython tool is required and PYTHONUTF8 is not in env', () => {
  const check = { requires: { tools: ['semgrep'] } };
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, { PYTHONUTF8: "1" });
});

test('does not set PYTHONUTF8 when cpython tool is required but PYTHONUTF8 is already in env', () => {
  const check = { requires: { tools: ['bandit'] } };
  const env = { PYTHONUTF8: '1' };
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, {});
});

test('does not set PYTHONUTF8 when no cpython tools are required even if PYTHONUTF8 is missing', () => {
  const check = { requires: { tools: ['zizmor'] } };
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, {});
});

test('does not set PYTHONUTF8 when check is null', () => {
  const check = null;
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, {});
});

test('does not set PYTHONUTF8 when requires is undefined', () => {
  const check = {};
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, {});
});

test('does not set PYTHONUTF8 when tools is undefined', () => {
  const check = { requires: {} };
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, {});
});

test('sets PYTHONUTF8 when multiple tools include a cpython tool and PYTHONUTF8 is missing', () => {
  const check = { requires: { tools: ['ruff', 'flawfinder', 'zizmor'] } };
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, { PYTHONUTF8: "1" });
});

test('does not set PYTHONUTF8 when multiple tools include no cpython tools', () => {
  const check = { requires: { tools: ['ruff', 'zizmor'] } };
  const env = {};
  const result = laneWindowsEnv(check, env, { platform: 'win32', container: false });
  assert.deepEqual(result, {});
});
