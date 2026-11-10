// Marks findings as actively exploited when their CVE appears in the CISA KEV cache (monitor/vulncheck-enrich.mjs enrichWithKev).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichWithKev } from '../vulncheck-enrich.mjs';

test('returns the same rows array with activelyExploited set to null when cache is absent', () => {
  const f = { id: 'CVE-2024-0001' };
  const rows = [f];
  const r = enrichWithKev(rows, null);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", activelyExploited: null }]);
});

test('returns an empty array when findings is null and cache is absent', () => {
  const r = enrichWithKev(null, null);
  assert.deepEqual(r, []);
});

test('returns an empty array when findings is undefined and cache is absent', () => {
  const r = enrichWithKev(undefined, null);
  assert.deepEqual(r, []);
});

test('sets activelyExploited to true and copies kevDateAdded and kevRansomware when the finding id matches a KEV entry', () => {
  const f = { id: 'CVE-2024-0001' };
  const cache = { entries: [{ cve: ['CVE-2024-0001'], dateAdded: '2024-01-15', knownRansomwareCampaignUse: 'Known' }] };
  const r = enrichWithKev([f], cache);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", activelyExploited: true, kevDateAdded: "2024-01-15", kevRansomware: true }]);
});

test('sets activelyExploited to false when the finding id does not match any KEV entry', () => {
  const f = { id: 'CVE-2024-9999' };
  const cache = { entries: [{ cve: ['CVE-2024-0001'], dateAdded: '2024-01-15', knownRansomwareCampaignUse: 'Known' }] };
  const r = enrichWithKev([f], cache);
  assert.deepEqual(r, [{ id: "CVE-2024-9999", activelyExploited: false }]);
});

test('matches a KEV entry via an alias when the primary id does not match', () => {
  const f = { id: 'CVE-2024-0002', aliases: ['CVE-2024-0001'] };
  const cache = { entries: [{ cve: ['CVE-2024-0001'], dateAdded: '2024-02-20', knownRansomwareCampaignUse: 'Known' }] };
  const r = enrichWithKev([f], cache);
  assert.deepEqual(r, [{ id: "CVE-2024-0002", aliases: ["CVE-2024-0001"], activelyExploited: true, kevDateAdded: "2024-02-20", kevRansomware: true }]);
});

test('sets kevRansomware to false when the KEV entry has knownRansomwareCampaignUse not equal to Known', () => {
  const f = { id: 'CVE-2024-0001' };
  const cache = { entries: [{ cve: ['CVE-2024-0001'], dateAdded: '2024-03-10', knownRansomwareCampaignUse: 'Unknown' }] };
  const r = enrichWithKev([f], cache);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", activelyExploited: true, kevDateAdded: "2024-03-10", kevRansomware: false }]);
});

test('skips null findings in the rows array without throwing', () => {
  const f = { id: 'CVE-2024-0001' };
  const cache = { entries: [{ cve: ['CVE-2024-0001'], dateAdded: '2024-01-15', knownRansomwareCampaignUse: 'Known' }] };
  const r = enrichWithKev([null, f], cache);
  assert.deepEqual(r, [null, { id: "CVE-2024-0001", activelyExploited: true, kevDateAdded: "2024-01-15", kevRansomware: true }]);
});
