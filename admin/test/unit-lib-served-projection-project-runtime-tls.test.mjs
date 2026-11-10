// Projects a raw runtime TLS object to the minimal served shape (admin/lib/served-projection.mjs projectRuntimeTls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRuntimeTls } from '../lib/served-projection.mjs';

test('returns null when input is null', () => {
  assert.equal(projectRuntimeTls(null), null);
});

test('returns null when input is not an object', () => {
  assert.equal(projectRuntimeTls('string'), null);
  assert.equal(projectRuntimeTls(42), null);
  assert.equal(projectRuntimeTls(true), null);
});

test('returns null when input is an empty object', () => {
  const result = projectRuntimeTls({});
  assert.deepEqual(result, { status: null, headers: null });
});

test('projects status and headers with all fields present', () => {
  const input = {
    status: 'ok',
    headers: {
      ran: true,
      grade: 'A',
      missing: ['x', 'y']
    }
  };
  const result = projectRuntimeTls(input);
  assert.equal(result.status, 'ok');
  assert.equal(result.headers.ran, true);
  assert.equal(result.headers.grade, 'A');
  assert.deepEqual(result.headers.missing, ['x', 'y']);
});

test('truncates status to 80 characters', () => {
  const status = 'a'.repeat(100);
  const result = projectRuntimeTls({ status });
  assert.equal(result.status, 'a'.repeat(80));
});

test('truncates grade to 12 characters', () => {
  const grade = 'b'.repeat(20);
  const result = projectRuntimeTls({ headers: { grade } });
  assert.equal(result.headers.grade, 'b'.repeat(12));
});

test('truncates missing array items to 60 characters and filters nulls', () => {
  const missing = ['c'.repeat(100), 'd'.repeat(50), null, undefined];
  const result = projectRuntimeTls({ headers: { missing } });
  assert.equal(result.headers.missing.length, 2);
  assert.equal(result.headers.missing[0], 'c'.repeat(60));
  assert.equal(result.headers.missing[1], 'd'.repeat(50));
});

test('sets ran to false when headers.ran is falsy', () => {
  const result = projectRuntimeTls({ headers: { ran: false } });
  assert.equal(result.headers.ran, false);
});

test('sets headers to null when headers is not an object', () => {
  const result = projectRuntimeTls({ headers: 'not-an-object' });
  assert.equal(result.headers, null);
});

test('handles non-string status and grade values', () => {
  const result = projectRuntimeTls({ status: 123, headers: { grade: 456 } });
  assert.equal(result.status, null);
  assert.equal(result.headers.grade, null);
});
