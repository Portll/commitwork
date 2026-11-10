// Computes whether a set of package nodes is exposed as prod, dev, or unknown (bin/lib/npm-versions.mjs exposureOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposureOf } from '../lib/npm-versions.mjs';

test('returns unknown when nodes is null', () => {
  const r = exposureOf(null, { packages: {} });
  assert.equal(r, "unknown");
});

test('returns unknown when nodes is empty array', () => {
  const r = exposureOf([], { packages: {} });
  assert.equal(r, "unknown");
});

test('returns unknown when a node has no entry in lock', () => {
  const r = exposureOf(['a', 'b'], { packages: { a: { dev: false } } });
  assert.equal(r, "unknown");
});

test('returns prod when any entry is not dev', () => {
  const r = exposureOf(['a', 'b'], { packages: { a: { dev: false }, b: { dev: true } } });
  assert.equal(r, "prod");
});

test('returns dev when all entries are dev', () => {
  const r = exposureOf(['a', 'b'], { packages: { a: { dev: true }, b: { dev: true } } });
  assert.equal(r, "dev");
});

test('returns unknown when lock is undefined', () => {
  const r = exposureOf(['a'], undefined);
  assert.equal(r, "unknown");
});

test('returns unknown when nodes is undefined', () => {
  const r = exposureOf(undefined, { packages: { a: { dev: false } } });
  assert.equal(r, "unknown");
});

test('returns prod for single non-dev entry', () => {
  const r = exposureOf(['x'], { packages: { x: { dev: false } } });
  assert.equal(r, "prod");
});
