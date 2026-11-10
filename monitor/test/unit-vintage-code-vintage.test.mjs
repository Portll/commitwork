// Groups entries by toolchain sha and dirty hash to report code vintage (monitor/vintage.mjs codeVintage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeVintage } from '../vintage.mjs';

test('counts entries without toolchain or sha as unrecorded', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h1', sourceDirty: ['p1'] } },
    { name: 'b', toolchain: null },
    { name: 'c', toolchain: { sha: '' } },
    { name: 'd', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h1', sourceDirty: ['p1'] } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.unrecorded, 2);
});

test('treats falsy toolchain and missing sha as unrecorded', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890' } },
    { name: 'b', toolchain: { sha: '' } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.unrecorded, 1);
});

test('groups entries with same sha and dirty hash into one runner', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h1', sourceDirty: ['p1', 'p2'] } },
    { name: 'b', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h1', sourceDirty: ['p1', 'p2'] } },
    { name: 'c', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h1', sourceDirty: ['p1', 'p2'] } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.distinct, 1);
});

test('separates entries with same sha but different dirty hashes', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h1' } },
    { name: 'b', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h2' } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.distinct, 2);
});

test('reports clean tree when no dirty hash is present', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890' } },
    { name: 'b', toolchain: { sha: 'abcdef1234567890' } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.note, "one runner (abcdef1, clean tree) produced every recorded row");
});

test('reports dirty source paths when dirty hash is present', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h1', sourceDirty: ['p1', 'p2', 'p3'] } },
    { name: 'b', toolchain: { sha: 'abcdef1234567890', sourceDirtyHash: 'h1', sourceDirty: ['p1', 'p2', 'p3'] } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.note, "one runner (abcdef1+dirty, 3 dirty source path(s)) produced every recorded row");
});

test('reports mixed vintage when multiple runners are present', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890' } },
    { name: 'b', toolchain: { sha: '1234567890abcdef' } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.note, "MIXED CODE VINTAGE \u2014 2 different commitwork runners produced these rows (abcdef1\u00d71, 1234567\u00d71). Compare repos only within one runner.");
});

test('reports unrecorded repos in single runner note', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890' } },
    { name: 'b', toolchain: null }
  ];
  const r = codeVintage(entries);
  assert.equal(r.note, "one runner (abcdef1, clean tree) produced every recorded row; 1 repo(s) predate the receipt and are unrecorded");
});

test('reports no toolchain when all entries are unrecorded', () => {
  const entries = [
    { name: 'a', toolchain: null },
    { name: 'b', toolchain: { sha: '' } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.note, "no repo carries a toolchain.json \u2014 the runner vintage is unrecorded for this whole batch, which is not the same as one vintage");
});

test('sets mixed flag based on distinct count', () => {
  const entries = [
    { name: 'a', toolchain: { sha: 'abcdef1234567890' } },
    { name: 'b', toolchain: { sha: '1234567890abcdef' } }
  ];
  const r = codeVintage(entries);
  assert.equal(r.mixed, true);
});
