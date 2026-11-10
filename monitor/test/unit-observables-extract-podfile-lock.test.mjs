// Extracts package names and SHA1 checksums from a Podfile.lock (monitor/observables.mjs extractPodfileLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPodfileLock } from '../observables.mjs';

test('returns unknown when text lacks a PODS section', () => {
  const r = extractPodfileLock('SOME: section\n', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: no PODS: section \u2014 not a Podfile.lock this reader knows" });
});

test('returns unknown when PODS section has no pod entries', () => {
  const r = extractPodfileLock('PODS:\n\nSPEC CHECKSUMS:\n  A: 0000000000000000000000000000000000000000\n', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: a PODS: section with no pod entries this reader recognises" });
});

test('extracts pod names and checksums from a valid Podfile.lock', () => {
  const r = extractPodfileLock('PODS:\n  - AFNetworking (1.0)\n  - Alamofire (2.0)\n\nSPEC CHECKSUMS:\n  AFNetworking: 1111111111111111111111111111111111111111\n  Alamofire: 2222222222222222222222222222222222222222\n', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "AFNetworking", where: "w", tier: "declared" }, { type: "package", value: "Alamofire", where: "w", tier: "declared" }, { type: "sha1", value: "1111111111111111111111111111111111111111", where: "w", tier: "declared" }, { type: "sha1", value: "2222222222222222222222222222222222222222", where: "w", tier: "declared" }], provenance: { packages: 2, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "SPEC CHECKSUMS digest the podspec, not the artifact \u2014 emitted for matching, never counted as provenance" });
});

test('resolves Name/Subspec to the pod Name', () => {
  const r = extractPodfileLock('PODS:\n  - AFNetworking/Serialization (1.0)\n\nSPEC CHECKSUMS:\n  AFNetworking: 3333333333333333333333333333333333333333\n', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "AFNetworking", where: "w", tier: "declared" }, { type: "sha1", value: "3333333333333333333333333333333333333333", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "SPEC CHECKSUMS digest the podspec, not the artifact \u2014 emitted for matching, never counted as provenance" });
});

test('deduplicates pod names that appear multiple times', () => {
  const r = extractPodfileLock('PODS:\n  - AFNetworking (1.0)\n  - AFNetworking/Serialization (1.0)\n  - AFNetworking (1.0)\n\nSPEC CHECKSUMS:\n  AFNetworking: 4444444444444444444444444444444444444444\n', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "AFNetworking", where: "w", tier: "declared" }, { type: "sha1", value: "4444444444444444444444444444444444444444", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "SPEC CHECKSUMS digest the podspec, not the artifact \u2014 emitted for matching, never counted as provenance" });
});

test('stops parsing pods when a top-level section begins', () => {
  const r = extractPodfileLock('PODS:\n  - AFNetworking (1.0)\nDEPENDENCIES:\n  - Alamofire (2.0)\n\nSPEC CHECKSUMS:\n  AFNetworking: 5555555555555555555555555555555555555555\n', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "AFNetworking", where: "w", tier: "declared" }, { type: "sha1", value: "5555555555555555555555555555555555555555", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "SPEC CHECKSUMS digest the podspec, not the artifact \u2014 emitted for matching, never counted as provenance" });
});

test('ignores checksum lines with leading spaces beyond two', () => {
  const r = extractPodfileLock('PODS:\n  - AFNetworking (1.0)\n\nSPEC CHECKSUMS:\n   AFNetworking: 6666666666666666666666666666666666666666\n', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "AFNetworking", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "SPEC CHECKSUMS digest the podspec, not the artifact \u2014 emitted for matching, never counted as provenance" });
});

test('ignores checksum lines containing a zero digit', () => {
  const r = extractPodfileLock('PODS:\n  - AFNetworking (1.0)\n\nSPEC CHECKSUMS:\n  AFNetworking: 0000000000000000000000000000000000000000\n', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "AFNetworking", where: "w", tier: "declared" }, { type: "sha1", value: "0000000000000000000000000000000000000000", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "SPEC CHECKSUMS digest the podspec, not the artifact \u2014 emitted for matching, never counted as provenance" });
});

test('extracts checksums with all non-zero hex digits', () => {
  const r = extractPodfileLock('PODS:\n  - AFNetworking (1.0)\n\nSPEC CHECKSUMS:\n  AFNetworking: 1111111111111111111111111111111111111111\n', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "AFNetworking", where: "w", tier: "declared" }, { type: "sha1", value: "1111111111111111111111111111111111111111", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "SPEC CHECKSUMS digest the podspec, not the artifact \u2014 emitted for matching, never counted as provenance" });
});

test('handles PODS section with trailing whitespace', () => {
  const r = extractPodfileLock('PODS:   \n  - AFNetworking (1.0)\n\nSPEC CHECKSUMS:\n  AFNetworking: 7777777777777777777777777777777777777777\n', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "AFNetworking", where: "w", tier: "declared" }, { type: "sha1", value: "7777777777777777777777777777777777777777", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "SPEC CHECKSUMS digest the podspec, not the artifact \u2014 emitted for matching, never counted as provenance" });
});
