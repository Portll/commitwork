// Computes the effective base URL, label, and scheme for a given kind (bin/lib/wp-source.mjs baseOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseOf } from '../lib/wp-source.mjs';

test('returns default base URL and label when env is unset', () => {
  const r = baseOf('core-checksums');
  assert.deepEqual(r, { url: "https://api.wordpress.org", label: "https://api.wordpress.org", scheme: "https" });
});

test('returns overridden base URL with env label when env is set', () => {
  process.env.CW_WP_API_URL = 'http://localhost:8080';
  const r = baseOf('core-checksums');
  assert.deepEqual(r, { url: "http://localhost:8080", label: "http://localhost:8080 (CW_WP_API_URL)", scheme: "http" });
  delete process.env.CW_WP_API_URL;
});

test('returns file scheme label when env points to file URL', () => {
  process.env.CW_WP_API_URL = 'file:///path/to/api';
  const r = baseOf('core-checksums');
  assert.deepEqual(r, { url: "file:///path/to/api", label: "file (CW_WP_API_URL)", scheme: "file" });
  delete process.env.CW_WP_API_URL;
});

test('returns default base URL for plugin-checksums when env is unset', () => {
  const r = baseOf('plugin-checksums');
  assert.deepEqual(r, { url: "https://downloads.wordpress.org", label: "https://downloads.wordpress.org", scheme: "https" });
});

test('returns overridden base URL for plugin-checksums when env is set', () => {
  process.env.CW_WP_DOWNLOADS_URL = 'https://custom.downloads.org';
  const r = baseOf('plugin-checksums');
  assert.deepEqual(r, { url: "https://custom.downloads.org", label: "https://custom.downloads.org (CW_WP_DOWNLOADS_URL)", scheme: "https" });
  delete process.env.CW_WP_DOWNLOADS_URL;
});

test('returns default base URL for advisories when env is unset', () => {
  const r = baseOf('advisories');
  assert.deepEqual(r, { url: "https://www.wpvulnerability.net", label: "https://www.wpvulnerability.net", scheme: "https" });
});

test('returns overridden base URL for advisories when env is set', () => {
  process.env.CW_WPVULN_URL = 'https://custom.vuln.net';
  const r = baseOf('advisories');
  assert.deepEqual(r, { url: "https://custom.vuln.net", label: "https://custom.vuln.net (CW_WPVULN_URL)", scheme: "https" });
  delete process.env.CW_WPVULN_URL;
});

test('returns default base URL for core-stable-check when env is unset', () => {
  const r = baseOf('core-stable-check');
  assert.deepEqual(r, { url: "https://api.wordpress.org", label: "https://api.wordpress.org", scheme: "https" });
});
