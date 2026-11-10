// Extracts package observables from a CycloneDX SBOM (monitor/observables.mjs extractSyftSbom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSyftSbom } from '../observables.mjs';

test('returns unknown for unparseable JSON', () => {
  const r = extractSyftSbom('not json', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "w: Unexpected token 'o', \"not json\" is not valid JSON" });
});

test('returns unknown when no components array', () => {
  const r = extractSyftSbom(JSON.stringify({ foo: 1 }), 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: no components[] \u2014 not a CycloneDX document this reader knows" });
});

test('returns unknown when components is not an array', () => {
  const r = extractSyftSbom(JSON.stringify({ components: 'x' }), 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: no components[] \u2014 not a CycloneDX document this reader knows" });
});

test('counts unnamed when purl is missing', () => {
  const r = extractSyftSbom(JSON.stringify({ components: [{ name: 'a' }] }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, byEcosystem: {}, unnamed: 1, excluded: 0, note: "tier=derived \u2014 syft's resolution, not a committed claim; 1 component(s) carried no purl" });
});

test('counts excluded when ecosystem is not in SBOM_ECOSYSTEMS', () => {
  const r = extractSyftSbom(JSON.stringify({ components: [{ purl: 'pkg:foo/bar@1' }] }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, byEcosystem: {}, unnamed: 0, excluded: 1, note: "tier=derived \u2014 syft's resolution, not a committed claim" });
});

test('counts packages and byEcosystem for valid purl', () => {
  const r = extractSyftSbom(JSON.stringify({ components: [{ purl: 'pkg:npm/foo@1' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "w", tier: "derived" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, byEcosystem: { npm: 1 }, unnamed: 0, excluded: 0, note: "tier=derived \u2014 syft's resolution, not a committed claim" });
});

test('increments byEcosystem for repeated ecosystem', () => {
  const r = extractSyftSbom(JSON.stringify({ components: [{ purl: 'pkg:npm/a@1' }, { purl: 'pkg:npm/b@2' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "a", where: "w", tier: "derived" }, { type: "package", value: "b", where: "w", tier: "derived" }], provenance: { packages: 2, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, byEcosystem: { npm: 2 }, unnamed: 0, excluded: 0, note: "tier=derived \u2014 syft's resolution, not a committed claim" });
});

test('handles null component entry', () => {
  const r = extractSyftSbom(JSON.stringify({ components: [null] }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, byEcosystem: {}, unnamed: 1, excluded: 0, note: "tier=derived \u2014 syft's resolution, not a committed claim; 1 component(s) carried no purl" });
});

test('handles empty components array', () => {
  const r = extractSyftSbom(JSON.stringify({ components: [] }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, byEcosystem: {}, unnamed: 0, excluded: 0, note: "tier=derived \u2014 syft's resolution, not a committed claim" });
});

test('uses artifacts key when components is absent', () => {
  const r = extractSyftSbom(JSON.stringify({ artifacts: [{ purl: 'pkg:npm/x@1' }] }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "x", where: "w", tier: "derived" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, byEcosystem: { npm: 1 }, unnamed: 0, excluded: 0, note: "tier=derived \u2014 syft's resolution, not a committed claim" });
});
