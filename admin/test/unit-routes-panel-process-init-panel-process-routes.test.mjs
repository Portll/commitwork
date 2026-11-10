// initializes module-level variables for panel-process routes (admin/routes/panel-process.mjs initPanelProcessRoutes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initPanelProcessRoutes } from '../routes/panel-process.mjs';
import { join } from 'node:path';
import { ADMIN } from '../lib/core.mjs';

test('initPanelProcessRoutes runs without autoUpdate and returns undefined', () => {
  const result = initPanelProcessRoutes({ BOOT_AT: 'now', BUILD: null, codeHealth: () => ({}), restartPanel: () => {} });
  assert.strictEqual(result, undefined);
});

test('initPanelProcessRoutes accepts an autoUpdate function without error', () => {
  const autoFn = () => ({ state: 'on' });
  const result = initPanelProcessRoutes({
    BOOT_AT: 'later',
    BUILD: { version: '1.0.0' },
    codeHealth: () => ({ ok: true }),
    restartPanel: () => {},
    autoUpdate: autoFn,
  });
  assert.strictEqual(result, undefined);
});

test('initPanelProcessRoutes works when BUILD is a non\u2011null object', () => {
  const buildInfo = { commit: 'abc123', date: '2024-01-01' };
  const result = initPanelProcessRoutes({
    BOOT_AT: 'epoch',
    BUILD: buildInfo,
    codeHealth: () => ({ healthy: true }),
    restartPanel: () => {},
  });
  assert.strictEqual(result, undefined);
});

test('initPanelProcessRoutes uses provided successorEntry path', () => {
  const customPath = join(ADMIN, 'custom-serve.mjs');
  const result = initPanelProcessRoutes({
    BOOT_AT: '',
    BUILD: null,
    codeHealth: () => ({}),
    restartPanel: () => {},
    successorEntry: customPath,
  });
  assert.strictEqual(result, undefined);
});

test('initPanelProcessRoutes falls back to default successorEntry when none supplied', () => {
  const defaultPath = join(ADMIN, 'serve.mjs');
  const result = initPanelProcessRoutes({
    BOOT_AT: '',
    BUILD: null,
    codeHealth: () => ({}),
    restartPanel: () => {},
  });
  assert.strictEqual(result, undefined);
});
