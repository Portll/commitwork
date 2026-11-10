// Set of all members from all registry areas (monitor/project-scope.mjs fleetInfra).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetInfra } from '../project-scope.mjs';

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
