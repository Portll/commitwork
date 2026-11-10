// determines if a version satisfies optional min/max operator constraints (bin/wp-advisories.mjs applies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applies } from '../wp-advisories.mjs';

test('returns false when record is null (no operator)', () => {
  const r = applies(null, '1.0.0');
  assert.equal(r, false);
});

test('returns false when record.operator is not an object', () => {
  const r = applies({ operator: 'not-an-object' }, '1.0.0');
  assert.equal(r, false);
});

test('returns false when operator object lacks min and max operators', () => {
  const r = applies({ operator: {} }, '1.0.0');
  assert.equal(r, false);
});

test('returns true when only a valid min operator is satisfied', () => {
  const record = { operator: { min_operator: '>=', min_version: '1.0.0' } };
  const r = applies(record, '1.0.0');
  assert.equal(r, true);
});

test('returns false when min operator is satisfied but max operator is not', () => {
  const record = {
    operator: {
      min_operator: '>=',
      min_version: '1.0.0',
      max_operator: '<',
      max_version: '0.5.0'
    }
  };
  const r = applies(record, '1.0.0');
  assert.equal(r, false);
});

test('returns null when min operator is invalid causing versionSatisfies to return null', () => {
  const record = { operator: { min_operator: '??', min_version: '1.0.0' } };
  const r = applies(record, '1.0.0');
  assert.equal(r, null);
});

test('returns null when max operator is invalid causing versionSatisfies to return null', () => {
  const record = { operator: { max_operator: '??', max_version: '1.0.0' } };
  const r = applies(record, '1.0.0');
  assert.equal(r, null);
});

test('returns null when both min and max operators are invalid', () => {
  const record = {
    operator: {
      min_operator: '??',
      min_version: '1.0.0',
      max_operator: '!!',
      max_version: '2.0.0'
    }
  };
  const r = applies(record, '1.5.0');
  assert.equal(r, null);
});

test('returns false when min operator present but version does not satisfy it', () => {
  const record = { operator: { min_operator: '>=', min_version: '2.0.0' } };
  const r = applies(record, '1.0.0');
  assert.equal(r, false);
});

test('returns false when max operator present but version does not satisfy it', () => {
  const record = { operator: { max_operator: '<', max_version: '0.5.0' } };
  const r = applies(record, '1.0.0');
  assert.equal(r, false);
});
