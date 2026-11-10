// Maps a job kind to a function that redacts its secrets and tokens from strings. (admin/lib/jobs.mjs redactorFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactorFor, jobs } from '../lib/jobs.mjs';

test('returns identity when the kind has no job entry', () => {
  const fn = redactorFor('missing', { operator: false });
  assert.equal(fn('hello'), 'hello');
  assert.equal(fn(42), 42);
});

test('returns identity when the job has no secrets or tokens', () => {
  jobs['k1'] = { secrets: [], tokens: [] };
  const fn = redactorFor('k1', { operator: false });
  assert.equal(fn('abc'), 'abc');
  assert.equal(fn(null), null);
  delete jobs['k1'];
});

test('redacts secrets for non-operator scope', () => {
  jobs['k2'] = { secrets: ['topsecret'], tokens: [] };
  const fn = redactorFor('k2', { operator: false });
  assert.equal(fn('x topsecret y'), 'x [redacted: shown on the operator port] y');
  delete jobs['k2'];
});

test('skips secrets for operator scope but still redacts tokens', () => {
  jobs['k3'] = { secrets: ['topsecret'], tokens: ['tok123'] };
  const fn = redactorFor('k3', { operator: true });
  assert.equal(fn('topsecret tok123'), 'topsecret [redacted: credential]');
  delete jobs['k3'];
});

test('redacts both secrets and tokens for non-operator scope', () => {
  jobs['k4'] = { secrets: ['abc'], tokens: ['xyz'] };
  const fn = redactorFor('k4', { operator: false });
  assert.equal(fn('abc xyz'), '[redacted: shown on the operator port] [redacted: credential]');
  delete jobs['k4'];
});

test('sorts secrets longest-first so overlapping values are handled', () => {
  jobs['k5'] = { secrets: ['ab', 'abc'], tokens: [] };
  const fn = redactorFor('k5', { operator: false });
  assert.equal(fn('abc'), '[redacted: shown on the operator port]');
  delete jobs['k5'];
});

test('returns non-string inputs unchanged', () => {
  jobs['k6'] = { secrets: ['s'], tokens: ['t'] };
  const fn = redactorFor('k6', { operator: false });
  assert.equal(fn(123), 123);
  assert.equal(fn(undefined), undefined);
  delete jobs['k6'];
});

test('handles multiple occurrences of a secret', () => {
  jobs['k7'] = { secrets: ['key'], tokens: [] };
  const fn = redactorFor('k7', { operator: false });
  assert.equal(fn('key key key'), '[redacted: shown on the operator port] [redacted: shown on the operator port] [redacted: shown on the operator port]');
  delete jobs['k7'];
});
