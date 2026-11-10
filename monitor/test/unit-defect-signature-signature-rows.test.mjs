// Filters defect signature rows from an artifact (monitor/defect-signature.mjs signatureRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signatureRows } from '../defect-signature.mjs';

test('returns an empty array when the artifact is null', () => {
  assert.deepEqual(signatureRows(null), []);
});

test('returns an empty array when the artifact is undefined', () => {
  assert.deepEqual(signatureRows(undefined), []);
});

test('keeps only truthy entries with signature true from a plain array', () => {
  const input = [
    { signature: true },
    null,
    { signature: false },
    { signature: true },
    { other: 1 },
  ];
  assert.deepEqual(signatureRows(input), [{ signature: true }, { signature: true }]);
});

test('keeps only truthy entries with signature true from the signatures property', () => {
  const input = {
    signatures: [
      { signature: true },
      null,
      { signature: false },
      { signature: true },
      { other: 1 },
    ],
  };
  assert.deepEqual(signatureRows(input), [{ signature: true }, { signature: true }]);
});

test('keeps only truthy entries with signature true from the detectors property', () => {
  const input = {
    detectors: [
      { signature: true },
      null,
      { signature: false },
      { signature: true },
      { other: 1 },
    ],
  };
  assert.deepEqual(signatureRows(input), [{ signature: true }, { signature: true }]);
});

test('returns an empty array when the artifact is a non-array object without known keys', () => {
  assert.deepEqual(signatureRows({ foo: 'bar' }), []);
});

test('returns an empty array when the artifact is a string', () => {
  assert.deepEqual(signatureRows('hello'), []);
});

test('returns an empty array when the artifact is a number', () => {
  assert.deepEqual(signatureRows(42), []);
});
