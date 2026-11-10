// Checks whether the vm module exposes SourceTextModule (codegraph/v8-surface.mjs vmModulesAvailable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vmModulesAvailable } from '../v8-surface.mjs';

test('returns false when vm is null', () => {
  const r = vmModulesAvailable(null);
  assert.equal(r, false);
});

test('returns false when vm is undefined', () => {
  const r = vmModulesAvailable(undefined);
  assert.equal(r, false);
});

test('returns false when vm is an empty object', () => {
  const r = vmModulesAvailable({});
  assert.equal(r, false);
});

test('returns false when SourceTextModule is a string', () => {
  const r = vmModulesAvailable({ SourceTextModule: 'not-a-function' });
  assert.equal(r, false);
});

test('returns false when SourceTextModule is a number', () => {
  const r = vmModulesAvailable({ SourceTextModule: 42 });
  assert.equal(r, false);
});

test('returns false when SourceTextModule is an object', () => {
  const r = vmModulesAvailable({ SourceTextModule: {} });
  assert.equal(r, false);
});

test('returns true when SourceTextModule is a function', () => {
  const r = vmModulesAvailable({ SourceTextModule: function () {} });
  assert.equal(r, true);
});

test('returns true when SourceTextModule is an arrow function', () => {
  const r = vmModulesAvailable({ SourceTextModule: () => {} });
  assert.equal(r, true);
});
