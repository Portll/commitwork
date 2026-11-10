// Builds an external identifier string prefixed with ext: (codegraph/schema.mjs externalId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalId } from '../schema.mjs';

test('returns ext: prefix plus the spec string for a simple spec', () => {
  const r = externalId('foo');
  assert.equal(r, "ext:foo");
});

test('returns ext: prefix plus the spec string for a spec with spaces', () => {
  const r = externalId('bar baz');
  assert.equal(r, "ext:bar baz");
});

test('returns ext: prefix plus the spec string for an empty spec', () => {
  const r = externalId('');
  assert.equal(r, "ext:");
});

test('returns ext: prefix plus the spec string for a numeric spec', () => {
  const r = externalId(42);
  assert.equal(r, "ext:42");
});

test('returns ext: prefix plus the spec string for a boolean spec', () => {
  const r = externalId(true);
  assert.equal(r, "ext:true");
});

test('returns ext: prefix plus the spec string for a long repeated spec', () => {
  const r = externalId('x'.repeat(100));
  assert.equal(r, "ext:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});

test('returns ext: prefix plus the spec string for a spec with special characters', () => {
  const r = externalId('a-b_c.d/e');
  assert.equal(r, "ext:a-b_c.d/e");
});

test('returns ext: prefix plus the spec string for a null spec', () => {
  const r = externalId(null);
  assert.equal(r, "ext:null");
});

test('returns ext: prefix plus the spec string for an undefined spec', () => {
  const r = externalId(undefined);
  assert.equal(r, "ext:undefined");
});

test('returns ext: prefix plus the spec string for an object spec', () => {
  const r = externalId({ key: 'value' });
  assert.equal(r, "ext:[object Object]");
});
