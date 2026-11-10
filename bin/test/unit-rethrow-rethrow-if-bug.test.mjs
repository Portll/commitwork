// rethrowIfBug rethrows ReferenceError, TypeError, and SyntaxError (when not json) else returns the error (bin/rethrow.mjs rethrowIfBug).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rethrowIfBug } from '../rethrow.mjs';

test('rethrows a ReferenceError regardless of json flag', () => {
  const e = new ReferenceError('x is not defined');
  assert.throws(() => rethrowIfBug(e, { json: false }), { name: 'ReferenceError', message: 'x is not defined' });
});

test('rethrows a TypeError regardless of json flag', () => {
  const e = new TypeError('Cannot read properties of undefined');
  assert.throws(() => rethrowIfBug(e, { json: true }), { name: 'TypeError', message: 'Cannot read properties of undefined' });
});

test('rethrows a SyntaxError when json is false', () => {
  const e = new SyntaxError('Unexpected token');
  assert.throws(() => rethrowIfBug(e, { json: false }), { name: 'SyntaxError', message: 'Unexpected token' });
});

test('returns a SyntaxError when json is true', () => {
  const e = new SyntaxError('Unexpected token');
  const r = rethrowIfBug(e, { json: true });
  assert.equal(r, e);
});

test('returns a generic Error when json is false', () => {
  const e = new Error('something went wrong');
  const r = rethrowIfBug(e, { json: false });
  assert.equal(r, e);
});

test('returns a generic Error when json is true', () => {
  const e = new Error('something went wrong');
  const r = rethrowIfBug(e, { json: true });
  assert.equal(r, e);
});

test('returns a SyntaxError when json is true and error is SyntaxError', () => {
  const e = new SyntaxError('Bad syntax');
  const r = rethrowIfBug(e, { json: true });
  assert.equal(r, e);
});

test('rethrows a SyntaxError when json is false and error is SyntaxError', () => {
  const e = new SyntaxError('Bad syntax');
  assert.throws(() => rethrowIfBug(e, { json: false }), { name: 'SyntaxError', message: 'Bad syntax' });
});
