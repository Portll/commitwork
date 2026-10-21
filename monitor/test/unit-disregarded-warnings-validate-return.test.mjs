// Validates that a return object carries a consistent warning identity and required timestamps (monitor/disregarded-warnings.mjs validateReturn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReturn } from '../disregarded-warnings.mjs';

test('returns an error when the input is null', () => {
  assert.deepEqual(validateReturn(null), ['return is not an object']);
});

test('returns an error when the input is an array', () => {
  assert.deepEqual(validateReturn([]), ['return is not an object']);
});

test('returns an error when the input is a string', () => {
  assert.deepEqual(validateReturn('not an object'), ['return is not an object']);
});

test('returns an error when the input is a number', () => {
  assert.deepEqual(validateReturn(123), ['return is not an object']);
});

test('returns an error when the input is a boolean', () => {
  assert.deepEqual(validateReturn(true), ['return is not an object']);
});

test('returns an error when the input is undefined', () => {
  assert.deepEqual(validateReturn(undefined), ['return is not an object']);
});

test('returns an error when source is missing', () => {
  const e = { code: 'ERR', subject: 'file.mjs', key: 'x:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), ['source, code and subject must form a warning identity']);
});

test('returns an error when code is missing', () => {
  const e = { source: 'src', subject: 'file.mjs', key: 'src:x|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), ['source, code and subject must form a warning identity']);
});

test('returns an error when subject is missing', () => {
  const e = { source: 'src', code: 'ERR', key: 'src:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), ['source, code and subject must form a warning identity']);
});

test('returns an error when key does not match the computed warning key', () => {
  const e = { source: 'src', code: 'ERR', subject: 'file.mjs', key: 'wrong-key', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), ['key must be src:ERR|file.mjs']);
});

test('returns an error when setAsideAt is not a valid ISO timestamp', () => {
  const e = { source: 'src', code: 'ERR', subject: 'file.mjs', key: 'src:ERR|file.mjs', setAsideAt: 'not-a-date', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), ['setAsideAt must be an ISO timestamp']);
});

test('returns an error when seenAt is not a valid ISO timestamp', () => {
  const e = { source: 'src', code: 'ERR', subject: 'file.mjs', key: 'src:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: 12345, recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), ['seenAt must be an ISO timestamp']);
});

test('returns an error when recordedAt is not a valid ISO timestamp', () => {
  const e = { source: 'src', code: 'ERR', subject: 'file.mjs', key: 'src:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: null, via: 'reader' };
  assert.deepEqual(validateReturn(e), ['recordedAt must be an ISO timestamp']);
});

test('returns an error when via is not a valid token', () => {
  const e = { source: 'src', code: 'ERR', subject: 'file.mjs', key: 'src:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader with space' };
  assert.deepEqual(validateReturn(e), ['via must be a token naming the reader that saw the return']);
});

test('returns an error when via is missing', () => {
  const e = { source: 'src', code: 'ERR', subject: 'file.mjs', key: 'src:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z' };
  assert.deepEqual(validateReturn(e), ['via must be a token naming the reader that saw the return']);
});

test('returns an empty array for a valid return object', () => {
  const e = { source: 'src', code: 'ERR', subject: 'file.mjs', key: 'src:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), []);
});

test('returns an empty array when subject has a line number suffix that is normalised', () => {
  const e = { source: 'src', code: 'ERR', subject: 'file.mjs:123', key: 'src:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), []);
});

test('returns an error when source contains invalid characters', () => {
  const e = { source: 'src with space', code: 'ERR', subject: 'file.mjs', key: 'src with space:ERR|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), ['source, code and subject must form a warning identity']);
});

test('returns an error when code contains invalid characters', () => {
  const e = { source: 'src', code: 'ERR CODE', subject: 'file.mjs', key: 'src:ERR CODE|file.mjs', setAsideAt: '2024-01-01T00:00:00Z', seenAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z', via: 'reader' };
  assert.deepEqual(validateReturn(e), ['source, code and subject must form a warning identity']);
});
