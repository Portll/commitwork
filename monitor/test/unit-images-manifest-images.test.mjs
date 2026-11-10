// Collects unique image names from manifests and records per-name read errors (monitor/images.mjs manifestImages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestImages } from '../images.mjs';

test('returns empty images and no problems when no names are given', () => {
  const r = manifestImages(() => ({}), []);
  assert.deepEqual(r, { images: [], problems: [] });
});

test('records a problem and skips the name when readManifest throws an Error with a message', () => {
  const r = manifestImages((n) => { throw new Error('boom'); }, ['a']);
  assert.deepEqual(r, { images: [], problems: ["a: boom"] });
});

test('records the raw thrown value when readManifest throws a non-Error value', () => {
  const r = manifestImages((n) => { throw 'raw'; }, ['a']);
  assert.deepEqual(r, { images: [], problems: ["a: raw"] });
});

test('records the raw thrown value when readManifest throws a non-Error object without a message', () => {
  const r = manifestImages((n) => { throw { code: 1 }; }, ['a']);
  assert.deepEqual(r, { images: [], problems: ["a: [object Object]"] });
});

test('adds image names from a manifest that has an images array', () => {
  const r = manifestImages((n) => ({ images: ['x', 'y'] }), ['a']);
  assert.deepEqual(r, { images: ["x", "y"], problems: [] });
});

test('adds no images when the manifest is null', () => {
  const r = manifestImages((n) => null, ['a']);
  assert.deepEqual(r, { images: [], problems: [] });
});

test('adds no images when the manifest has no images property', () => {
  const r = manifestImages((n) => ({}), ['a']);
  assert.deepEqual(r, { images: [], problems: [] });
});

test('adds no images when the manifest images property is not an array', () => {
  const r = manifestImages((n) => ({ images: 'x' }), ['a']);
  assert.deepEqual(r, { images: [], problems: [] });
});

test('deduplicates repeated names and merges unique images across names', () => {
  const r = manifestImages((n) => ({ images: [n] }), ['a', 'a', 'b']);
  assert.deepEqual(r, { images: ["a", "b"], problems: [] });
});
