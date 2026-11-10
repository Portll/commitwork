// Extracts package, URL, domain, and SHA256 observables from a pubspec.lock text (monitor/observables.mjs extractPubspecLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPubspecLock } from '../observables.mjs';

test('returns unknown when no top-level packages block is present', () => {
  const r = extractPubspecLock('name: foo\nversion: 1.0.0\n', 'pubspec.lock');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "pubspec.lock: no top-level `packages:` block \u2014 not a pubspec.lock this reader knows" });
});

test('returns unknown when packages block has no two-space package keys', () => {
  const r = extractPubspecLock('packages:\n  # comment\n', 'pubspec.lock');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "pubspec.lock: a packages: block with no two-space package keys \u2014 a dialect this reader refuses rather than approximates" });
});

test('extracts package, URL, domain, and SHA256 observables from a valid pubspec.lock', () => {
  const text = [
    'packages:',
    '  foo:',
    '    url: "https://example.com/foo"',
    '    sha256: "a'.padEnd(66, 'a').slice(0, 64) + '"',
    '  bar:',
    '    url: "file:///local/bar"',
    '    sha256: "b'.padEnd(66, 'b').slice(0, 64) + '"',
    'sdks:',
    '  dart: ">=3.0.0"',
  ].join('\n');
  const r = extractPubspecLock(text, 'pubspec.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "pubspec.lock", tier: "declared" }, { type: "url", value: "https://example.com/foo", where: "pubspec.lock", tier: "declared" }, { type: "domain", value: "example.com", where: "pubspec.lock", tier: "declared" }, { type: "package", value: "bar", where: "pubspec.lock", tier: "declared" }], provenance: { packages: 2, withOrigin: 2, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('counts each URL occurrence toward withOrigin when sawUrl is not reset', () => {
  const text = [
    'packages:',
    '  foo:',
    '    url: "https://example.com/foo"',
    '    url: "https://example.com/foo"',
    '    sha256: "c'.padEnd(66, 'c').slice(0, 64) + '"',
  ].join('\n');
  const r = extractPubspecLock(text, 'pubspec.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "pubspec.lock", tier: "declared" }, { type: "url", value: "https://example.com/foo", where: "pubspec.lock", tier: "declared" }, { type: "domain", value: "example.com", where: "pubspec.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('extracts SHA256 with leading zero in digest', () => {
  const text = [
    'packages:',
    '  foo:',
    '    sha256: "0'.padEnd(66, 'a').slice(0, 64) + '"',
  ].join('\n');
  const r = extractPubspecLock(text, 'pubspec.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "pubspec.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('extracts SHA256 with no leading zero in digest', () => {
  const text = [
    'packages:',
    '  foo:',
    '    sha256: "1'.padEnd(66, 'a').slice(0, 64) + '"',
  ].join('\n');
  const r = extractPubspecLock(text, 'pubspec.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "pubspec.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('stops at next top-level key and does not include subsequent packages', () => {
  const text = [
    'packages:',
    '  foo:',
    '    url: "https://example.com/foo"',
    'sdks:',
    '  dart: ">=3.0.0"',
    '  foo:',
    '    url: "https://example.com/foo"',
  ].join('\n');
  const r = extractPubspecLock(text, 'pubspec.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "pubspec.lock", tier: "declared" }, { type: "url", value: "https://example.com/foo", where: "pubspec.lock", tier: "declared" }, { type: "domain", value: "example.com", where: "pubspec.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('handles package with URL but no SHA256 digest', () => {
  const text = [
    'packages:',
    '  foo:',
    '    url: "https://example.com/foo"',
    '  bar:',
    '    url: "file:///local/bar"',
  ].join('\n');
  const r = extractPubspecLock(text, 'pubspec.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "pubspec.lock", tier: "declared" }, { type: "url", value: "https://example.com/foo", where: "pubspec.lock", tier: "declared" }, { type: "domain", value: "example.com", where: "pubspec.lock", tier: "declared" }, { type: "package", value: "bar", where: "pubspec.lock", tier: "declared" }], provenance: { packages: 2, withOrigin: 2, withDigest: 0, canOrigin: true, canDigest: true } });
});
