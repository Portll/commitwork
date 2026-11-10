// Maps native SBOM artifacts to resolved URLs by purl and name@version (monitor/sbom-provenance.mjs indexNative).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexNative } from '../sbom-provenance.mjs';

test('returns empty maps when nativeDoc is null', () => {
  const r = indexNative(null);
  assert.deepEqual(r, { byPurl: new Map([]), byNameVersion: new Map([]) });
});

test('returns empty maps when nativeDoc has no artifacts property', () => {
  const r = indexNative({});
  assert.deepEqual(r, { byPurl: new Map([]), byNameVersion: new Map([]) });
});

test('returns empty maps when artifacts is an empty array', () => {
  const r = indexNative({ artifacts: [] });
  assert.deepEqual(r, { byPurl: new Map([]), byNameVersion: new Map([]) });
});

test('indexes a single artifact with purl, name, version, and resolved metadata', () => {
  const r = indexNative({ artifacts: [{ purl: 'pkg:npm/foo@1.0.0', name: 'foo', version: '1.0.0', metadata: { resolved: 'https://example.com/foo-1.0.0.tgz' } }] });
  assert.deepEqual(r, { byPurl: new Map([["pkg:npm/foo@1.0.0", "https://example.com/foo-1.0.0.tgz"]]), byNameVersion: new Map([["foo@1.0.0", "https://example.com/foo-1.0.0.tgz"]]) });
});

test('skips artifacts whose resolved metadata is not a string', () => {
  const r = indexNative({ artifacts: [{ purl: 'pkg:npm/bar@2.0.0', name: 'bar', version: '2.0.0', metadata: { resolved: 123 } }] });
  assert.deepEqual(r, { byPurl: new Map([]), byNameVersion: new Map([]) });
});

test('keeps first occurrence when multiple artifacts share the same purl', () => {
  const r = indexNative({ artifacts: [
    { purl: 'pkg:npm/dup@1.0.0', name: 'dup', version: '1.0.0', metadata: { resolved: 'https://a.com/dup-1.0.0.tgz' } },
    { purl: 'pkg:npm/dup@1.0.0', name: 'dup', version: '1.0.0', metadata: { resolved: 'https://b.com/dup-1.0.0.tgz' } }
  ] });
  assert.deepEqual(r, { byPurl: new Map([["pkg:npm/dup@1.0.0", "https://a.com/dup-1.0.0.tgz"]]), byNameVersion: new Map([["dup@1.0.0", "https://a.com/dup-1.0.0.tgz"]]) });
});

test('keeps first occurrence when multiple artifacts share the same name and version', () => {
  const r = indexNative({ artifacts: [
    { purl: 'pkg:npm/same@1.0.0', name: 'same', version: '1.0.0', metadata: { resolved: 'https://a.com/same-1.0.0.tgz' } },
    { purl: 'pkg:npm/same@1.0.1', name: 'same', version: '1.0.0', metadata: { resolved: 'https://b.com/same-1.0.1.tgz' } }
  ] });
  assert.deepEqual(r, { byPurl: new Map([["pkg:npm/same@1.0.0", "https://a.com/same-1.0.0.tgz"], ["pkg:npm/same@1.0.1", "https://b.com/same-1.0.1.tgz"]]), byNameVersion: new Map([["same@1.0.0", "https://a.com/same-1.0.0.tgz"]]) });
});

test('skips artifacts with no purl but still indexes by name and version', () => {
  const r = indexNative({ artifacts: [{ name: 'noPurl', version: '3.0.0', metadata: { resolved: 'https://c.com/noPurl-3.0.0.tgz' } }] });
  assert.deepEqual(r, { byPurl: new Map([]), byNameVersion: new Map([["noPurl@3.0.0", "https://c.com/noPurl-3.0.0.tgz"]]) });
});
