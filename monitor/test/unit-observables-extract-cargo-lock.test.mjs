// Extracts package names, checksums, and origins from a Cargo.lock file (monitor/observables.mjs extractCargoLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCargoLock } from '../observables.mjs';

test('extracts a package with name, checksum, and registry source', () => {
  const text = '[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "abc123"';
  const r = extractCargoLock(text, 'Cargo.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "serde", where: "Cargo.lock", tier: "declared" }, { type: "sha256", value: "abc123", where: "Cargo.lock", tier: "declared" }, { type: "url", value: "https://github.com/rust-lang/crates.io-index", where: "Cargo.lock", tier: "declared" }, { type: "domain", value: "github.com", where: "Cargo.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 1, canOrigin: true, canDigest: true } });
});

test('extracts a package with git source and no checksum', () => {
  const text = '[[package]]\nname = "my-crate"\nversion = "0.1.0"\nsource = "git+https://github.com/user/repo" { rev = "deadbeef" }';
  const r = extractCargoLock(text, 'Cargo.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "my-crate", where: "Cargo.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('extracts a path-only package with no source or checksum', () => {
  const text = '[[package]]\nname = "local-crate"\nversion = "0.1.0"';
  const r = extractCargoLock(text, 'Cargo.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "local-crate", where: "Cargo.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('extracts multiple packages and resets state between sections', () => {
  const text = '[[package]]\nname = "alpha"\nversion = "1.0.0"\nsource = "registry+https://crates.io"\nchecksum = "aaa"\n\n[[package]]\nname = "beta"\nversion = "2.0.0"\nsource = "registry+https://crates.io"\nchecksum = "bbb"';
  const r = extractCargoLock(text, 'Cargo.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "alpha", where: "Cargo.lock", tier: "declared" }, { type: "sha256", value: "aaa", where: "Cargo.lock", tier: "declared" }, { type: "url", value: "https://crates.io", where: "Cargo.lock", tier: "declared" }, { type: "domain", value: "crates.io", where: "Cargo.lock", tier: "declared" }, { type: "package", value: "beta", where: "Cargo.lock", tier: "declared" }, { type: "sha256", value: "bbb", where: "Cargo.lock", tier: "declared" }, { type: "url", value: "https://crates.io", where: "Cargo.lock", tier: "declared" }, { type: "domain", value: "crates.io", where: "Cargo.lock", tier: "declared" }], provenance: { packages: 2, withOrigin: 2, withDigest: 2, canOrigin: true, canDigest: true } });
});

test('flushes the last package when input ends without a new section', () => {
  const text = '[[package]]\nname = "last"\nversion = "3.0.0"\nchecksum = "ccc"';
  const r = extractCargoLock(text, 'Cargo.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "last", where: "Cargo.lock", tier: "declared" }, { type: "sha256", value: "ccc", where: "Cargo.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: true, canDigest: true } });
});

test('ignores lines before any package section', () => {
  const text = '# comment\nname = "orphan"\nchecksum = "zzz"\n\n[[package]]\nname = "real"\nversion = "1.0.0"';
  const r = extractCargoLock(text, 'Cargo.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "real", where: "Cargo.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('handles a package with only a name and no other fields', () => {
  const text = '[[package]]\nname = "bare"\nversion = "0.0.1"';
  const r = extractCargoLock(text, 'Cargo.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "bare", where: "Cargo.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('extracts a package with a file URL source', () => {
  const text = '[[package]]\nname = "local"\nversion = "1.0.0"\nsource = "file:///path/to/crate"';
  const r = extractCargoLock(text, 'Cargo.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "local", where: "Cargo.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: true } });
});
