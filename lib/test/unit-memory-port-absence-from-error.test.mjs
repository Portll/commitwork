// Checks whether an error is an ENOENT absence (lib/memory-port.mjs absenceFromError).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absenceFromError } from '../memory-port.mjs';

test('returns true for an error whose code is ENOENT', () => {
  const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
  assert.equal(absenceFromError(err), true);
});

test('returns false for an error whose code is EACCES', () => {
  const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  assert.equal(absenceFromError(err), false);
});

test('returns false for a truthy value that is not an error object', () => {
  assert.equal(absenceFromError('ENOENT'), false);
});

test('returns false for null input', () => {
  assert.equal(absenceFromError(null), false);
});

test('returns false for undefined input', () => {
  assert.equal(absenceFromError(undefined), false);
});

test('returns false for an object without a code property', () => {
  assert.equal(absenceFromError({}), false);
});

test('returns false for an error whose code is EEXIST', () => {
  const err = Object.assign(new Error('file exists'), { code: 'EEXIST' });
  assert.equal(absenceFromError(err), false);
});

test('returns false for a falsy zero input', () => {
  assert.equal(absenceFromError(0), false);
});
