// Normalises raw npm package metadata into a canonical shape (bin/lib/npm-versions.mjs normaliseMeta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMeta } from '../lib/npm-versions.mjs';

test('returns null when raw is null', () => {
  assert.equal(normaliseMeta(null), null);
});

test('returns null when raw is an array', () => {
  assert.equal(normaliseMeta([]), null);
});

test('returns null when raw.versions is missing', () => {
  assert.equal(normaliseMeta({}), null);
});

test('returns null when raw.versions is a number', () => {
  assert.equal(normaliseMeta({ versions: 1 }), null);
});

test('wraps string versions in array and defaults time and latest', () => {
  assert.deepEqual(normaliseMeta({ versions: '1.0.0' }), { versions: ["1.0.0"], time: {}, latest: null, lockedDeprecated: null, lockedUnpublished: false });
});

test('keeps array versions and empty time when time is missing', () => {
  assert.deepEqual(normaliseMeta({ versions: ['1.0.0', '2.0.0'] }), { versions: ["1.0.0", "2.0.0"], time: {}, latest: null, lockedDeprecated: null, lockedUnpublished: false });
});

test('keeps object time and latest from dist-tags', () => {
  assert.deepEqual(normaliseMeta({ versions: ['1.0.0'], time: { created: 't' }, 'dist-tags': { latest: '1.0.0' } }), { versions: ["1.0.0"], time: { created: "t" }, latest: "1.0.0", lockedDeprecated: null, lockedUnpublished: false });
});

test('sets lockedDeprecated from non-empty string when lockedUnpublished is false', () => {
  assert.deepEqual(normaliseMeta({ versions: ['1.0.0'], deprecated: 'old' }), { versions: ["1.0.0"], time: {}, latest: null, lockedDeprecated: "old", lockedUnpublished: false });
});

test('sets lockedDeprecated to null when lockedUnpublished is true', () => {
  assert.deepEqual(normaliseMeta({ versions: ['1.0.0'], deprecated: 'old' }, { lockedUnpublished: true }), { versions: ["1.0.0"], time: {}, latest: null, lockedDeprecated: null, lockedUnpublished: true });
});

test('sets lockedDeprecated to null when deprecated is empty string', () => {
  assert.deepEqual(normaliseMeta({ versions: ['1.0.0'], deprecated: '' }), { versions: ["1.0.0"], time: {}, latest: null, lockedDeprecated: null, lockedUnpublished: false });
});
