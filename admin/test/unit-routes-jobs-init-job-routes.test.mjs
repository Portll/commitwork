// sets internal registry functions for jobs module (admin/routes/jobs.mjs initJobRoutes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initJobRoutes } from '../routes/jobs.mjs';

function makeRegistry(name) {
  const fn = (...args) => ({ name, args });
  return fn;
}

test('initJobRoutes returns undefined', () => {
  const result = initJobRoutes({ registry: () => {}, registryStale: () => {} });
  assert.strictEqual(result, undefined);
});

test('initJobRoutes accepts valid function objects without throwing', () => {
  const deps = {
    registry: makeRegistry('reg1'),
    registryStale: makeRegistry('stale1')
  };
  assert.doesNotThrow(() => initJobRoutes(deps));
});

test('initJobRoutes called twice updates internal registry references', () => {
  const first = {
    registry: makeRegistry('firstReg'),
    registryStale: makeRegistry('firstStale')
  };
  const second = {
    registry: makeRegistry('secondReg'),
    registryStale: makeRegistry('secondStale')
  };
  initJobRoutes(first);
  initJobRoutes(second);
  assert.doesNotThrow(() => initJobRoutes(second));
});

test('initJobRoutes assigns non\u2011function values without validation', () => {
  const deps = {
    registry: 42,
    registryStale: 'not a function'
  };
  assert.doesNotThrow(() => initJobRoutes(deps));
});

test('initJobRoutes works with arrow functions capturing external variables', () => {
  const external = { value: 'captured' };
  const deps = {
    registry: () => external.value,
    registryStale: () => external.value.toUpperCase()
  };
  assert.doesNotThrow(() => initJobRoutes(deps));
});
