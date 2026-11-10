// Maps a vulnerability identifier to its advisory URL (monitor/draft-pr-body.mjs advisoryUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisoryUrl } from '../draft-pr-body.mjs';

test('returns Go vulnerability URL for GO-prefixed ids', () => {
  assert.equal(advisoryUrl('GO-2024-1234'), "https://pkg.go.dev/vuln/GO-2024-1234");
});

test('returns GitHub advisory URL for GHSA-prefixed ids', () => {
  assert.equal(advisoryUrl('GHSA-abc-def-ghi'), "https://github.com/advisories/GHSA-abc-def-ghi");
});

test('returns OSV URL for other non-empty ids', () => {
  assert.equal(advisoryUrl('CVE-2024-1234'), "https://osv.dev/vulnerability/CVE-2024-1234");
});

test('returns OSV URL for empty string input', () => {
  assert.equal(advisoryUrl(''), "https://osv.dev/vulnerability/");
});

test('returns OSV URL for null input', () => {
  assert.equal(advisoryUrl(null), "https://osv.dev/vulnerability/");
});

test('returns OSV URL for undefined input', () => {
  assert.equal(advisoryUrl(undefined), "https://osv.dev/vulnerability/");
});

test('returns OSV URL for zero input', () => {
  assert.equal(advisoryUrl(0), "https://osv.dev/vulnerability/");
});

test('returns OSV URL for false input', () => {
  assert.equal(advisoryUrl(false), "https://osv.dev/vulnerability/");
});
