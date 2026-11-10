// Extracts package names from Conan lockfile JSON (monitor/observables.mjs extractConanLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractConanLock } from '../observables.mjs';

test('returns unknown for unparseable JSON', () => {
  const r = extractConanLock('not json', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "w: Unexpected token 'o', \"not json\" is not valid JSON" });
});

test('returns unknown for empty object without requires or graph_lock', () => {
  const r = extractConanLock('{}', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: neither requires[] (v2) nor graph_lock.nodes (v1) \u2014 not a conan.lock this reader knows" });
});

test('extracts package from requires array', () => {
  const r = extractConanLock('{"requires":["zlib/1.2.1"]}', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "zlib", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "recipe revisions are Conan-internal recipe hashes, not artifact digests, and are not counted as provenance" });
});

test('extracts package from build_requires array', () => {
  const r = extractConanLock('{"build_requires":["cmake/3.20"]}', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "cmake", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "recipe revisions are Conan-internal recipe hashes, not artifact digests, and are not counted as provenance" });
});

test('extracts package from graph_lock nodes with string ref', () => {
  const r = extractConanLock('{"graph_lock":{"nodes":{"a":{"ref":"zlib/1.2.1"}}}}', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "zlib", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "recipe revisions are Conan-internal recipe hashes, not artifact digests, and are not counted as provenance" });
});

test('skips graph_lock nodes with non-string ref', () => {
  const r = extractConanLock('{"graph_lock":{"nodes":{"a":{"ref":123}}}}', 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "recipe revisions are Conan-internal recipe hashes, not artifact digests, and are not counted as provenance" });
});

test('deduplicates same package name from multiple refs', () => {
  const r = extractConanLock('{"requires":["zlib/1.2.1","zlib/1.3.0"]}', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "zlib", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "recipe revisions are Conan-internal recipe hashes, not artifact digests, and are not counted as provenance" });
});

test('skips non-string refs in requires array', () => {
  const r = extractConanLock('{"requires":[123,"zlib/1.2.1"]}', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "zlib", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "recipe revisions are Conan-internal recipe hashes, not artifact digests, and are not counted as provenance" });
});

test('returns unknown when graph_lock exists but nodes is null', () => {
  const r = extractConanLock('{"graph_lock":{"nodes":null}}', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: neither requires[] (v2) nor graph_lock.nodes (v1) \u2014 not a conan.lock this reader knows" });
});

test('handles graph_lock with empty nodes object', () => {
  const r = extractConanLock('{"graph_lock":{"nodes":{}}}', 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "recipe revisions are Conan-internal recipe hashes, not artifact digests, and are not counted as provenance" });
});
