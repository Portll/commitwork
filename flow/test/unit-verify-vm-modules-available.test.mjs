// Checks whether the vm module exposes SourceTextModule (flow/verify.mjs vmModulesAvailable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vmModulesAvailable } from '../verify.mjs';

test('returns true when vm has SourceTextModule as a function', () => {
  const fakeVm = { SourceTextModule: function SourceTextModule() {} };
  const r = vmModulesAvailable(fakeVm);
  assert.equal(r, true);
});

test('returns false when vm has SourceTextModule as a non-function value', () => {
  const fakeVm = { SourceTextModule: 42 };
  const r = vmModulesAvailable(fakeVm);
  assert.equal(r, false);
});

test('returns false when vm has SourceTextModule as a string', () => {
  const fakeVm = { SourceTextModule: 'not-a-function' };
  const r = vmModulesAvailable(fakeVm);
  assert.equal(r, false);
});

test('returns false when vm has SourceTextModule as an object', () => {
  const fakeVm = { SourceTextModule: { name: 'SourceTextModule' } };
  const r = vmModulesAvailable(fakeVm);
  assert.equal(r, false);
});

test('returns false when vm has SourceTextModule as null', () => {
  const fakeVm = { SourceTextModule: null };
  const r = vmModulesAvailable(fakeVm);
  assert.equal(r, false);
});

test('returns false when vm is null', () => {
  const r = vmModulesAvailable(null);
  assert.equal(r, false);
});

test('returns false when vm is undefined', () => {
  const r = vmModulesAvailable(undefined);
  assert.equal(r, false);
});

test('returns false when vm is an empty object without SourceTextModule', () => {
  const r = vmModulesAvailable({});
  assert.equal(r, false);
});
