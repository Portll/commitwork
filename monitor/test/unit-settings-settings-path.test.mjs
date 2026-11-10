// The settings file path: CW_SETTINGS, else CW_SETTINGS_STORE, else ~/.commitwork/settings.json (monitor/settings.mjs settingsPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsPath } from '../settings.mjs';

function setEnv(vars) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return () => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

test('returns CW_SETTINGS when both CW_SETTINGS and CW_SETTINGS_STORE are set', (t) => {
  t.after(setEnv({ CW_SETTINGS: '/custom/settings.json', CW_SETTINGS_STORE: '/custom/store.json', HOME: '/home/tester' }));
  const result = settingsPath();
  assert.equal(result, '/custom/settings.json');
});

test('returns CW_SETTINGS when it is set and CW_SETTINGS_STORE is unset', (t) => {
  t.after(setEnv({ CW_SETTINGS: '/only/settings.json', CW_SETTINGS_STORE: undefined, HOME: '/home/tester' }));
  const result = settingsPath();
  assert.equal(result, '/only/settings.json');
});

test('returns CW_SETTINGS when it is set and CW_SETTINGS_STORE is an empty string', (t) => {
  t.after(setEnv({ CW_SETTINGS: '/primary/settings.json', CW_SETTINGS_STORE: '', HOME: '/home/tester' }));
  const result = settingsPath();
  assert.equal(result, '/primary/settings.json');
});

test('returns CW_SETTINGS_STORE when CW_SETTINGS is unset and CW_SETTINGS_STORE is set', (t) => {
  t.after(setEnv({ CW_SETTINGS: undefined, CW_SETTINGS_STORE: '/only/store.json', HOME: '/home/tester' }));
  const result = settingsPath();
  assert.equal(result, '/only/store.json');
});

test('returns CW_SETTINGS_STORE when CW_SETTINGS is an empty string and CW_SETTINGS_STORE is set', (t) => {
  t.after(setEnv({ CW_SETTINGS: '', CW_SETTINGS_STORE: '/fallback/store.json', HOME: '/home/tester' }));
  const result = settingsPath();
  assert.equal(result, '/fallback/store.json');
});

test('returns the home directory default when both environment variables are unset', (t) => {
  t.after(setEnv({ CW_SETTINGS: undefined, CW_SETTINGS_STORE: undefined, HOME: '/home/tester' }));
  const result = settingsPath();
  assert.equal(result, '/home/tester/.commitwork/settings.json');
});

test('returns the home directory default when both environment variables are empty strings', (t) => {
  t.after(setEnv({ CW_SETTINGS: '', CW_SETTINGS_STORE: '', HOME: '/users/another' }));
  const result = settingsPath();
  assert.equal(result, '/users/another/.commitwork/settings.json');
});
