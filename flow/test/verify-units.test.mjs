// flow/test/verify-units.test.mjs — case tests for vmModulesAvailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vmModulesAvailable } from '../verify.mjs';

test('returns true when vm.SourceTextModule is a function', () => {
  const vm = { SourceTextModule: function SourceTextModule() {} };
  assert.equal(vmModulesAvailable(vm), true);
});

test('returns false when vm.SourceTextModule is undefined', () => {
  const vm = { SourceTextModule: undefined };
  assert.equal(vmModulesAvailable(vm), false);
});

test('returns false when vm.SourceTextModule is a non-function value', () => {
  const vm = { SourceTextModule: 'not-a-function' };
  assert.equal(vmModulesAvailable(vm), false);
});

test('returns false when vm is null', () => {
  assert.equal(vmModulesAvailable(null), false);
});

test('returns false when vm is undefined', () => {
  assert.equal(vmModulesAvailable(undefined), false);
});

test('returns false when vm is an empty object', () => {
  assert.equal(vmModulesAvailable({}), false);
});
