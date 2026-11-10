// Returns the first identity field name for a lane schema, or null (monitor/defect-signature.mjs detectorField).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectorField } from '../defect-signature.mjs';

test('returns the first identity string when the lane schema has a non-empty identity array', () => {
  const schemas = { alpha: { identity: ['name', 'email'] } };
  const r = detectorField('alpha', schemas);
  assert.equal(r, "name");
});

test('returns null when the lane schema identity array is empty', () => {
  const schemas = { beta: { identity: [] } };
  const r = detectorField('beta', schemas);
  assert.equal(r, null);
});

test('returns null when the lane schema identity is not an array', () => {
  const schemas = { gamma: { identity: 'name' } };
  const r = detectorField('gamma', schemas);
  assert.equal(r, null);
});

test('returns null when the lane schema has no identity property', () => {
  const schemas = { delta: { other: ['x'] } };
  const r = detectorField('delta', schemas);
  assert.equal(r, null);
});

test('returns null when the lane is not present in the schemas object', () => {
  const schemas = { alpha: { identity: ['name'] } };
  const r = detectorField('missing', schemas);
  assert.equal(r, null);
});

test('returns null when the first identity element is an empty string', () => {
  const schemas = { eps: { identity: ['', 'name'] } };
  const r = detectorField('eps', schemas);
  assert.equal(r, null);
});

test('returns null when the first identity element is a number', () => {
  const schemas = { zeta: { identity: [42, 'name'] } };
  const r = detectorField('zeta', schemas);
  assert.equal(r, null);
});

test('returns null when the first identity element is null', () => {
  const schemas = { eta: { identity: [null, 'name'] } };
  const r = detectorField('eta', schemas);
  assert.equal(r, null);
});

test('returns null when the first identity element is false', () => {
  const schemas = { theta: { identity: [false, 'name'] } };
  const r = detectorField('theta', schemas);
  assert.equal(r, null);
});

test('returns null when the first identity element is zero', () => {
  const schemas = { iota: { identity: [0, 'name'] } };
  const r = detectorField('iota', schemas);
  assert.equal(r, null);
});
