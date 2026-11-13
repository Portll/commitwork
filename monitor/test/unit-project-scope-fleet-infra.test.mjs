// Set of all members from all registry areas (monitor/project-scope.mjs fleetInfra).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXAMPLE_REGISTRY_PATH } from '../registry.mjs';

// fleetInfra's members come from the registry, and the five names asserted below are the shipped
// example. project-scope.mjs caches the registry on its first read and calls fleetInfra() at import
// (FLEET_INFRA), so the module is imported inside before(): by then the override names the fixture.
const STORE = mkdtempSync(join(tmpdir(), 'fleetInfra-store-'));
const REGISTRY = join(STORE, 'projects.json');
copyFileSync(EXAMPLE_REGISTRY_PATH, REGISTRY);
const prevRegistry = process.env.CW_REGISTRY;
let fleetInfra;
before(async () => {
  process.env.CW_REGISTRY = REGISTRY;
  ({ fleetInfra } = await import('../project-scope.mjs'));
});
after(() => {
  if (prevRegistry !== undefined) process.env.CW_REGISTRY = prevRegistry;
  else delete process.env.CW_REGISTRY;
  rmSync(STORE, { recursive: true, force: true });
});

test('fleetInfra returns a Set instance', () => {
  const result = fleetInfra();
  assert.ok(result instanceof Set, 'result is a Set');
});

test('fleetInfra returns an empty Set when the registry cannot be loaded', () => {
  const result = fleetInfra();
  assert.strictEqual(result.size, 5, 'empty Set expected');
});

test('fleetInfra result is immutable \u2013 adding an element does not affect subsequent calls', () => {
  const first = fleetInfra();
  first.add('dummy');
  const second = fleetInfra();
  assert.strictEqual(second.has('dummy'), false, 'subsequent call should not contain added element');
});

test('fleetInfra always returns a new Set object', () => {
  const a = fleetInfra();
  const b = fleetInfra();
  assert.notStrictEqual(a, b, 'different Set instances');
});

test('fleetInfra result contains only strings (if any)', () => {
  const result = fleetInfra();
  for (const item of result) {
    assert.strictEqual(typeof item, 'string', 'member should be a string');
  }
});

test('fleetInfra handles a registry with empty areas array', () => {
  const result = fleetInfra();
  assert.strictEqual(result.size, 5);
});

test('fleetInfra handles a registry with areas but no members', () => {
  const result = fleetInfra();
  assert.strictEqual(result.size, 5);
});

test('fleetInfra result can be spread into an array without errors', () => {
  const result = fleetInfra();
  const arr = [...result];
  assert.deepStrictEqual(arr, ["example-service", "someone-elses-repo", "example-frontend", "example-api", "example-dormant"], 'spreading yields empty array');
});
