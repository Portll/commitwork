// Extracts Go module dependencies and provenance from go.mod text (monitor/observables.mjs extractGoMod).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGoMod } from '../observables.mjs';

test('extracts a single require line with a domain host', () => {
  const text = 'require github.com/foo/bar v1.0.0';
  const r = extractGoMod(text, 'go.mod');
  assert.deepEqual(r, { observables: [{ type: "package", value: "github.com/foo/bar", where: "go.mod", tier: "declared" }, { type: "domain", value: "github.com", where: "go.mod", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: false }, note: "digests live in go.sum, which this extractor does not read" });
});

test('extracts a require block with multiple dependencies', () => {
  const text = 'require (\n\tgithub.com/a/b v1.0.0\n\tgolang.org/x/text v0.1.0\n)';
  const r = extractGoMod(text, 'go.mod');
  assert.deepEqual(r, { observables: [{ type: "package", value: "github.com/a/b", where: "go.mod", tier: "declared" }, { type: "domain", value: "github.com", where: "go.mod", tier: "declared" }, { type: "package", value: "golang.org/x/text", where: "go.mod", tier: "declared" }, { type: "domain", value: "golang.org", where: "go.mod", tier: "declared" }], provenance: { packages: 2, withOrigin: 2, withDigest: 0, canOrigin: true, canDigest: false }, note: "digests live in go.sum, which this extractor does not read" });
});

test('ignores local module paths without a dot in the host', () => {
  const text = 'require example.com v1.0.0';
  const r = extractGoMod(text, 'go.mod');
  assert.deepEqual(r, { observables: [{ type: "package", value: "example.com", where: "go.mod", tier: "declared" }, { type: "domain", value: "example.com", where: "go.mod", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: false }, note: "digests live in go.sum, which this extractor does not read" });
});

test('strips trailing comments from lines', () => {
  const text = 'require github.com/foo/bar v1.0.0 // indirect';
  const r = extractGoMod(text, 'go.mod');
  assert.deepEqual(r, { observables: [{ type: "package", value: "github.com/foo/bar", where: "go.mod", tier: "declared" }, { type: "domain", value: "github.com", where: "go.mod", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: false }, note: "digests live in go.sum, which this extractor does not read" });
});

test('handles empty input text', () => {
  const r = extractGoMod('', 'go.mod');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: false }, note: "digests live in go.sum, which this extractor does not read" });
});

test('handles a require block with no dependencies', () => {
  const text = 'require (\n)';
  const r = extractGoMod(text, 'go.mod');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: false }, note: "digests live in go.sum, which this extractor does not read" });
});

test('extracts multiple single-line requires', () => {
  const text = 'require github.com/a/b v1.0.0\nrequire golang.org/x/text v0.1.0';
  const r = extractGoMod(text, 'go.mod');
  assert.deepEqual(r, { observables: [{ type: "package", value: "github.com/a/b", where: "go.mod", tier: "declared" }, { type: "domain", value: "github.com", where: "go.mod", tier: "declared" }, { type: "package", value: "golang.org/x/text", where: "go.mod", tier: "declared" }, { type: "domain", value: "golang.org", where: "go.mod", tier: "declared" }], provenance: { packages: 2, withOrigin: 2, withDigest: 0, canOrigin: true, canDigest: false }, note: "digests live in go.sum, which this extractor does not read" });
});

test('handles a module path with multiple slashes', () => {
  const text = 'require github.com/org/repo/sub v2.0.0';
  const r = extractGoMod(text, 'go.mod');
  assert.deepEqual(r, { observables: [{ type: "package", value: "github.com/org/repo/sub", where: "go.mod", tier: "declared" }, { type: "domain", value: "github.com", where: "go.mod", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: false }, note: "digests live in go.sum, which this extractor does not read" });
});
