// Validates a disregard record and returns a list of human-readable error strings (monitor/disregarded-warnings.mjs validateDisregard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDisregard } from '../disregarded-warnings.mjs';

test('returns a single error when the input is null', () => {
  const result = validateDisregard(null);
  assert.deepEqual(result, ['record is not an object']);
});

test('returns a single error when the input is an array', () => {
  const result = validateDisregard([]);
  assert.deepEqual(result, ['record is not an object']);
});

test('returns an empty array for a fully valid record', () => {
  const record = {
    source: 'eslint',
    code: 'no-unused-vars',
    subject: 'src/app.js',
    why: 'legacy code',
    who: 'alice',
    at: '2024-01-01T00:00:00Z'
  };
  const result = validateDisregard(record);
  assert.deepEqual(result, []);
});

test('reports an error when source contains invalid characters', () => {
  const record = {
    source: 'eslint tool',
    code: 'no-unused-vars',
    subject: 'src/app.js',
    why: 'legacy code',
    who: 'alice',
    at: '2024-01-01T00:00:00Z'
  };
  const result = validateDisregard(record);
  assert.deepEqual(result, ['source must be a token ([A-Za-z0-9._-]+) naming the tool that warned']);
});

test('reports an error when code is empty', () => {
  const record = {
    source: 'eslint',
    code: '',
    subject: 'src/app.js',
    why: 'legacy code',
    who: 'alice',
    at: '2024-01-01T00:00:00Z'
  };
  const result = validateDisregard(record);
  assert.deepEqual(result, ['code must be a token ([A-Za-z0-9._-]+) naming the kind of warning']);
});

test('reports an error when subject is missing', () => {
  const record = {
    source: 'eslint',
    code: 'no-unused-vars',
    why: 'legacy code',
    who: 'alice',
    at: '2024-01-01T00:00:00Z'
  };
  const result = validateDisregard(record);
  assert.deepEqual(result, ['subject is required (the place: a repo, area, file or check)']);
});

test('reports an error when why is whitespace only', () => {
  const record = {
    source: 'eslint',
    code: 'no-unused-vars',
    subject: 'src/app.js',
    why: '   ',
    who: 'alice',
    at: '2024-01-01T00:00:00Z'
  };
  const result = validateDisregard(record);
  assert.deepEqual(result, ['why is required \u2014 a set-aside with no reason cannot be re-judged when it returns']);
});

test('reports an error when who is missing', () => {
  const record = {
    source: 'eslint',
    code: 'no-unused-vars',
    subject: 'src/app.js',
    why: 'legacy code',
    at: '2024-01-01T00:00:00Z'
  };
  const result = validateDisregard(record);
  assert.deepEqual(result, ['who is required (free text)']);
});

test('reports an error when at is not a valid ISO timestamp', () => {
  const record = {
    source: 'eslint',
    code: 'no-unused-vars',
    subject: 'src/app.js',
    why: 'legacy code',
    who: 'alice',
    at: 'not-a-date'
  };
  const result = validateDisregard(record);
  assert.deepEqual(result, ['at must be an ISO timestamp']);
});

test('reports an error when line is present', () => {
  const record = {
    source: 'eslint',
    code: 'no-unused-vars',
    subject: 'src/app.js',
    why: 'legacy code',
    who: 'alice',
    at: '2024-01-01T00:00:00Z',
    line: 10
  };
  const result = validateDisregard(record);
  assert.deepEqual(result, ["line is not part of a warning's identity \u2014 put the place in subject"]);
});
