// Determines if an SBOM document is produced by Syft (monitor/sbom-provenance.mjs isSyftNative).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSyftNative } from '../sbom-provenance.mjs';

test('returns false when doc is null', () => {
  const r = isSyftNative(null);
  assert.equal(r, false);
});

test('returns false when doc is a string', () => {
  const r = isSyftNative('not-an-object');
  assert.equal(r, false);
});

test('returns false when artifacts is missing', () => {
  const r = isSyftNative({ descriptor: { name: 'syft' } });
  assert.equal(r, false);
});

test('returns false when artifacts is not an array', () => {
  const r = isSyftNative({ artifacts: 'nope', descriptor: { name: 'syft' } });
  assert.equal(r, false);
});

test('returns true when descriptor name is syft', () => {
  const r = isSyftNative({ artifacts: [], descriptor: { name: 'syft' } });
  assert.equal(r, true);
});

test('returns true when schema version is present', () => {
  const r = isSyftNative({ artifacts: [], schema: { version: '1.0.0' } });
  assert.equal(r, true);
});

test('returns false when descriptor name is not syft and no schema', () => {
  const r = isSyftNative({ artifacts: [], descriptor: { name: 'other' } });
  assert.equal(r, false);
});

test('returns false when descriptor is present but name is undefined', () => {
  const r = isSyftNative({ artifacts: [], descriptor: {} });
  assert.equal(r, false);
});

test('returns false when schema is present but version is undefined', () => {
  const r = isSyftNative({ artifacts: [], schema: {} });
  assert.equal(r, false);
});

test('returns false when both descriptor and schema are absent', () => {
  const r = isSyftNative({ artifacts: [] });
  assert.equal(r, false);
});
