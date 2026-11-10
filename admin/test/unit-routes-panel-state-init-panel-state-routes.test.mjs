// Binds registry, configState, and SERVICES from deps (admin/routes/panel-state.mjs initPanelStateRoutes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initPanelStateRoutes } from '../routes/panel-state.mjs';

test('assigns registry, configState, and SERVICES from deps object', () => {
  const registry = () => 'registry-value';
  const configState = () => 'config-value';
  const SERVICES = { svc: 'service-value' };
  const deps = { registry, configState, SERVICES };
  initPanelStateRoutes(deps);
  assert.strictEqual(registry(), 'registry-value');
  assert.strictEqual(configState(), 'config-value');
  assert.strictEqual(SERVICES.svc, 'service-value');
});

test('replaces previous bindings when called again with new deps', () => {
  const registry1 = () => 'first';
  const registry2 = () => 'second';
  const configState1 = () => 'first-config';
  const configState2 = () => 'second-config';
  const SERVICES1 = { a: 1 };
  const SERVICES2 = { b: 2 };
  initPanelStateRoutes({ registry: registry1, configState: configState1, SERVICES: SERVICES1 });
  initPanelStateRoutes({ registry: registry2, configState: configState2, SERVICES: SERVICES2 });
  assert.strictEqual(registry2(), 'second');
  assert.strictEqual(configState2(), 'second-config');
  assert.strictEqual(SERVICES2.b, 2);
});

test('accepts empty SERVICES object', () => {
  const registry = () => 'r';
  const configState = () => 'c';
  const SERVICES = {};
  initPanelStateRoutes({ registry, configState, SERVICES });
  assert.strictEqual(registry(), 'r');
  assert.strictEqual(configState(), 'c');
  assert.deepStrictEqual(SERVICES, {});
});

test('accepts null registry function', () => {
  const registry = null;
  const configState = () => 'c';
  const SERVICES = { x: 1 };
  initPanelStateRoutes({ registry, configState, SERVICES });
  assert.strictEqual(registry, null);
  assert.strictEqual(configState(), 'c');
  assert.strictEqual(SERVICES.x, 1);
});

test('accepts null configState function', () => {
  const registry = () => 'r';
  const configState = null;
  const SERVICES = { y: 2 };
  initPanelStateRoutes({ registry, configState, SERVICES });
  assert.strictEqual(registry(), 'r');
  assert.strictEqual(configState, null);
  assert.strictEqual(SERVICES.y, 2);
});

test('accepts null SERVICES object', () => {
  const registry = () => 'r';
  const configState = () => 'c';
  const SERVICES = null;
  initPanelStateRoutes({ registry, configState, SERVICES });
  assert.strictEqual(registry(), 'r');
  assert.strictEqual(configState(), 'c');
  assert.strictEqual(SERVICES, null);
});

test('accepts undefined values in deps', () => {
  const registry = undefined;
  const configState = undefined;
  const SERVICES = undefined;
  initPanelStateRoutes({ registry, configState, SERVICES });
  assert.strictEqual(registry, undefined);
  assert.strictEqual(configState, undefined);
  assert.strictEqual(SERVICES, undefined);
});

test('accepts function values that return complex objects', () => {
  const registry = () => ({ key: 'val', nested: { a: 1 } });
  const configState = () => [1, 2, 3];
  const SERVICES = { handler: () => 'ok' };
  initPanelStateRoutes({ registry, configState, SERVICES });
  assert.deepStrictEqual(registry(), { key: 'val', nested: { a: 1 } });
  assert.deepStrictEqual(configState(), [1, 2, 3]);
  assert.strictEqual(SERVICES.handler(), 'ok');
});
