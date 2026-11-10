// Extracts the first scanner's vdb metadata from a rollup (cra/neutral-report.mjs vdbOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vdbOf } from '../neutral-report.mjs';

test('returns null when rollup is null', () => {
  const r = vdbOf(null);
  assert.deepEqual(r, null);
});

test('returns null when rollup is undefined', () => {
  const r = vdbOf(undefined);
  assert.deepEqual(r, null);
});

test('returns null when rollup has no scanners property', () => {
  const r = vdbOf({});
  assert.deepEqual(r, null);
});

test('returns null when scanners is empty object', () => {
  const r = vdbOf({ scanners: {} });
  assert.deepEqual(r, null);
});

test('returns null when scanner value is null', () => {
  const r = vdbOf({ scanners: { a: null } });
  assert.deepEqual(r, null);
});

test('returns null when scanner has no vdb', () => {
  const r = vdbOf({ scanners: { a: { name: 'x' } } });
  assert.deepEqual(r, null);
});

test('returns null when vdb has neither builtAt nor image', () => {
  const r = vdbOf({ scanners: { a: { vdb: { pulledAt: 'p' } } } });
  assert.deepEqual(r, null);
});

test('returns vdb fields when builtAt is present and image is missing', () => {
  const r = vdbOf({ scanners: { a: { vdb: { builtAt: 'b1', pulledAt: 'p1', bound: 'bd1' } } } });
  assert.deepEqual(r, { image: null, builtAt: "b1", pulledAt: "p1", bound: "bd1" });
});

test('returns vdb fields when image is present and builtAt is missing', () => {
  const r = vdbOf({ scanners: { a: { vdb: { image: 'img1', pulledAt: 'p2', bound: 'bd2' } } } });
  assert.deepEqual(r, { image: "img1", builtAt: null, pulledAt: "p2", bound: "bd2" });
});

test('returns vdb fields when both builtAt and image are present', () => {
  const r = vdbOf({ scanners: { a: { vdb: { image: 'img3', builtAt: 'b3', pulledAt: 'p3', bound: 'bd3' } } } });
  assert.deepEqual(r, { image: "img3", builtAt: "b3", pulledAt: "p3", bound: "bd3" });
});
