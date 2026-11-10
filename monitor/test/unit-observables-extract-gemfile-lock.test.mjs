// Extracts package names and remote URLs from a Gemfile.lock (monitor/observables.mjs extractGemfileLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGemfileLock } from '../observables.mjs';

test('parses a gem with a remote into package and origin observables', () => {
  const text = "GEM\n  remote: https://rubygems.org/\n  specs:\n    rake (13.0.6)\n";
  const r = extractGemfileLock(text, 'Gemfile.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "rake", where: "Gemfile.lock", tier: "declared" }, { type: "url", value: "https://rubygems.org/", where: "Gemfile.lock", tier: "declared" }, { type: "domain", value: "rubygems.org", where: "Gemfile.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: false }, note: "no checksums in this format; a CHECKSUMS section, if present, is unread" });
});

test('parses a gem without a remote into package observable only', () => {
  const text = "PATH\n  remote: .\n  specs:\n    mygem (1.0.0)\n";
  const r = extractGemfileLock(text, 'Gemfile.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "mygem", where: "Gemfile.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: false }, note: "no checksums in this format; a CHECKSUMS section, if present, is unread" });
});

test('ignores gem lines outside a specs section', () => {
  const text = "GEM\n  remote: https://rubygems.org/\n    rake (13.0.6)\n";
  const r = extractGemfileLock(text, 'Gemfile.lock');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: false }, note: "no checksums in this format; a CHECKSUMS section, if present, is unread" });
});

test('resets state on blank lines and section headers', () => {
  const text = "GEM\n  remote: https://rubygems.org/\n  specs:\n    rake (13.0.6)\n\nPLATFORMS\n  ruby\n";
  const r = extractGemfileLock(text, 'Gemfile.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "rake", where: "Gemfile.lock", tier: "declared" }, { type: "url", value: "https://rubygems.org/", where: "Gemfile.lock", tier: "declared" }, { type: "domain", value: "rubygems.org", where: "Gemfile.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: false }, note: "no checksums in this format; a CHECKSUMS section, if present, is unread" });
});

test('handles multiple gems in one specs section', () => {
  const text = "GEM\n  remote: https://rubygems.org/\n  specs:\n    rake (13.0.6)\n    rspec (3.12.0)\n";
  const r = extractGemfileLock(text, 'Gemfile.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "rake", where: "Gemfile.lock", tier: "declared" }, { type: "url", value: "https://rubygems.org/", where: "Gemfile.lock", tier: "declared" }, { type: "domain", value: "rubygems.org", where: "Gemfile.lock", tier: "declared" }, { type: "package", value: "rspec", where: "Gemfile.lock", tier: "declared" }, { type: "url", value: "https://rubygems.org/", where: "Gemfile.lock", tier: "declared" }, { type: "domain", value: "rubygems.org", where: "Gemfile.lock", tier: "declared" }], provenance: { packages: 2, withOrigin: 2, withDigest: 0, canOrigin: true, canDigest: false }, note: "no checksums in this format; a CHECKSUMS section, if present, is unread" });
});

test('returns empty observables for empty input', () => {
  const r = extractGemfileLock('', 'Gemfile.lock');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: false }, note: "no checksums in this format; a CHECKSUMS section, if present, is unread" });
});

test('ignores lines with wrong indentation for remote', () => {
  const text = "GEM\n   remote: https://rubygems.org/\n  specs:\n    rake (13.0.6)\n";
  const r = extractGemfileLock(text, 'Gemfile.lock');
  assert.deepEqual(r, { observables: [{ type: "package", value: "rake", where: "Gemfile.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: false }, note: "no checksums in this format; a CHECKSUMS section, if present, is unread" });
});

test('ignores lines with wrong indentation for specs', () => {
  const text = "GEM\n  remote: https://rubygems.org/\n   specs:\n    rake (13.0.6)\n";
  const r = extractGemfileLock(text, 'Gemfile.lock');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: false }, note: "no checksums in this format; a CHECKSUMS section, if present, is unread" });
});
