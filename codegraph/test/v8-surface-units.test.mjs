// codegraph/test/v8-surface-units.test.mjs — case tests for vmModulesAvailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vmModulesAvailable } from '../v8-surface.mjs';

test('returns true when vm.SourceTextModule is a function', () => {
  const fakeVm = { SourceTextModule: function SourceTextModule() {} };
  assert.equal(vmModulesAvailable(fakeVm), true);
});

test('returns false when vm.SourceTextModule is not a function', () => {
  const fakeVm = { SourceTextModule: 'not-a-function' };
  assert.equal(vmModulesAvailable(fakeVm), false);
});

test('returns false when vm.SourceTextModule is undefined', () => {
  const fakeVm = { SourceTextModule: undefined };
  assert.equal(vmModulesAvailable(fakeVm), false);
});

test('returns false when vm is null', () => {
  assert.equal(vmModulesAvailable(null), false);
});

test('returns false when vm is undefined', () => {
  assert.equal(vmModulesAvailable(undefined), false);
});

test('returns false when vm is a plain object without SourceTextModule', () => {
  const fakeVm = { otherProp: 42 };
  assert.equal(vmModulesAvailable(fakeVm), false);
});

test('returns true when SourceTextModule is an arrow function', () => {
  const fakeVm = { SourceTextModule: () => {} };
  assert.equal(vmModulesAvailable(fakeVm), true);
});
