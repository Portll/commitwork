// Computes a canonical deduplication key for a warning object (monitor/disregarded-warnings.mjs warningKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warningKey } from '../disregarded-warnings.mjs';

test('returns null when input is not an object', () => {
  assert.equal(warningKey(null), null);
  assert.equal(warningKey(undefined), null);
  assert.equal(warningKey('string'), null);
  assert.equal(warningKey(123), null);
});

test('returns null when source is missing or invalid', () => {
  assert.equal(warningKey({ source: '', code: 'C1', subject: 'file.mjs' }), null);
  assert.equal(warningKey({ source: 'bad source', code: 'C1', subject: 'file.mjs' }), null);
  assert.equal(warningKey({ code: 'C1', subject: 'file.mjs' }), null);
});

test('returns null when code is missing or invalid', () => {
  assert.equal(warningKey({ source: 'S1', code: '', subject: 'file.mjs' }), null);
  assert.equal(warningKey({ source: 'S1', code: 'bad code', subject: 'file.mjs' }), null);
  assert.equal(warningKey({ source: 'S1', subject: 'file.mjs' }), null);
});

test('returns null when subject is missing or invalid', () => {
  assert.equal(warningKey({ source: 'S1', code: 'C1', subject: '' }), null);
  assert.equal(warningKey({ source: 'S1', code: 'C1' }), null);
  assert.equal(warningKey({ source: 'S1', code: 'C1', subject: 123 }), null);
});

test('returns formatted key for valid warning with simple subject', () => {
  const result = warningKey({ source: 'eslint', code: 'no-unused-vars', subject: 'src/file.mjs' });
  assert.equal(result, 'eslint:no-unused-vars|src/file.mjs');
});

test('strips line number from subject with letter-led extension', () => {
  const result = warningKey({ source: 'eslint', code: 'C1', subject: 'file.mjs:123' });
  assert.equal(result, 'eslint:C1|file.mjs');
});

test('strips line and column from subject with letter-led extension', () => {
  const result = warningKey({ source: 'eslint', code: 'C1', subject: 'file.mjs:123:7' });
  assert.equal(result, 'eslint:C1|file.mjs');
});

test('preserves port in IP address subject', () => {
  const result = warningKey({ source: 'S1', code: 'C1', subject: '127.0.0.1:7878' });
  assert.equal(result, 'S1:C1|127.0.0.1:7878');
});

test('normalizes backslashes and leading dot-slash in subject', () => {
  const result = warningKey({ source: 'S1', code: 'C1', subject: '.\\src\\file.mjs' });
  assert.equal(result, 'S1:C1|src/file.mjs');
});

test('handles subject with trailing whitespace', () => {
  const result = warningKey({ source: 'S1', code: 'C1', subject: '  file.mjs  ' });
  assert.equal(result, 'S1:C1|file.mjs');
});
