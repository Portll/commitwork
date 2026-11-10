// Whether a response body unambiguously hands over a non-empty object (bin/bola-run.mjs disclosesObject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disclosesObject } from '../bola-run.mjs';

test('returns false for a non-2xx status even with a non-empty body', () => {
  assert.equal(disclosesObject({ status: 404, text: '{"a":1}' }), false);
});

test('returns false for an empty body on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: '' }), false);
});

test('returns false for a null JSON body on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: 'null' }), false);
});

test('returns false for an empty JSON array on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: '[]' }), false);
});

test('returns true for a single-element JSON array on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: '[1]' }), true);
});

test('returns false for an empty JSON object on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: '{}' }), false);
});

test('returns true for a one-key JSON object on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: '{"a":1}' }), true);
});

test('returns false for a whitespace-only JSON string on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: '"  "' }), false);
});

test('returns true for a non-empty JSON string on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: '"x"' }), true);
});

test('returns true for a bare number JSON body on a 2xx status', () => {
  assert.equal(disclosesObject({ status: 200, text: '42' }), true);
});
