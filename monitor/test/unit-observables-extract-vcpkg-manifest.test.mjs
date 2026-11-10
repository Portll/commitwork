// Extracts vcpkg package names from a manifest (monitor/observables.mjs extractVcpkgManifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVcpkgManifest } from '../observables.mjs';

test('returns unknown for unparseable JSON', () => {
  const r = extractVcpkgManifest('not json', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "w: Unexpected token 'o', \"not json\" is not valid JSON" });
});

test('returns unknown when dependencies is not an array', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: {} }), 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: no dependencies[] \u2014 not a vcpkg manifest this reader knows" });
});

test('returns empty observables when dependencies is an empty array', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: [] }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "names only \u2014 vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read" });
});

test('extracts string dependencies with deduplication', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: ['a', 'b', 'a'] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "a", where: "w", tier: "declared" }, { type: "package", value: "b", where: "w", tier: "declared" }], provenance: { packages: 2, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "names only \u2014 vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read" });
});

test('extracts object dependencies with name property', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: [{ name: 'x' }, { name: 'y' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "x", where: "w", tier: "declared" }, { type: "package", value: "y", where: "w", tier: "declared" }], provenance: { packages: 2, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "names only \u2014 vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read" });
});

test('skips null and non-string name entries', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: [null, { name: 42 }, { name: 'z' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "z", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "names only \u2014 vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read" });
});

test('handles dependencies with undefined name field', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: [{}, { name: 'ok' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "ok", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "names only \u2014 vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read" });
});

test('handles dependencies with null name field', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: [{ name: null }, { name: 'ok' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "ok", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "names only \u2014 vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read" });
});

test('handles dependencies with non-object entries', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: [42, true, { name: 'ok' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "ok", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "names only \u2014 vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read" });
});

test('handles dependencies with empty string name', () => {
  const r = extractVcpkgManifest(JSON.stringify({ dependencies: ['', { name: 'ok' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "ok", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "names only \u2014 vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read" });
});
