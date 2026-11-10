// Marks findings with corroboration metadata (monitor/corroborate.mjs markCorroboration).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markCorroboration } from '../corroborate.mjs';

test('returns empty array for empty input', () => {
  const r = markCorroboration([]);
  assert.deepEqual(r, []);
});

test('returns null for null input', () => {
  const r = markCorroboration(null);
  assert.deepEqual(r, []);
});

test('marks row with non-advisory id as citing no advisory', () => {
  const r = markCorroboration([{ id: 'not-an-advisory', tool: 't1', key: 'repo1', package: 'pkg1' }]);
  assert.deepEqual(r, [{ id: "not-an-advisory", tool: "t1", key: "repo1", package: "pkg1", citesNoAdvisory: true, attribution: "parent-rollup" }]);
});

test('marks row with advisory id and no twins as not corroborated', () => {
  const r = markCorroboration([{ id: 'CVE-2024-0001', tool: 't1', key: 'repo1', package: 'pkg1' }]);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", tool: "t1", key: "repo1", package: "pkg1" }]);
});

test('corroborates row with twin from different tool', () => {
  const r = markCorroboration([
    { id: 'CVE-2024-0001', tool: 't1', key: 'repo1', package: 'pkg1', path: 'a.js' },
    { id: 'CVE-2024-0001', tool: 't2', key: 'repo1', package: 'pkg1', path: 'b.js' }
  ]);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", tool: "t1", key: "repo1", package: "pkg1", path: "a.js", corroboratedBy: [{ tool: "t2", id: "CVE-2024-0001", path: "b.js", basis: "unclassified" }], tools: 2, independentBases: 0, agreement: "same-basis" }, { id: "CVE-2024-0001", tool: "t2", key: "repo1", package: "pkg1", path: "b.js", corroboratedBy: [{ tool: "t1", id: "CVE-2024-0001", path: "a.js", basis: "unclassified" }], tools: 2, independentBases: 0, agreement: "same-basis" }]);
});

test('does not corroborate row with twin from same tool', () => {
  const r = markCorroboration([
    { id: 'CVE-2024-0001', tool: 't1', key: 'repo1', package: 'pkg1' },
    { id: 'CVE-2024-0001', tool: 't1', key: 'repo1', package: 'pkg1' }
  ]);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", tool: "t1", key: "repo1", package: "pkg1" }, { id: "CVE-2024-0001", tool: "t1", key: "repo1", package: "pkg1" }]);
});

test('corroborates row via alias from different tool', () => {
  const r = markCorroboration([
    { id: 'CVE-2024-0001', aliases: ['GHSA-abc'], tool: 't1', key: 'repo1', package: 'pkg1' },
    { id: 'GHSA-abc', tool: 't2', key: 'repo1', package: 'pkg1' }
  ]);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", aliases: ["GHSA-abc"], tool: "t1", key: "repo1", package: "pkg1", corroboratedBy: [{ tool: "t2", id: "GHSA-abc", path: "", basis: "unclassified" }], tools: 2, independentBases: 0, agreement: "same-basis" }, { id: "GHSA-abc", tool: "t2", key: "repo1", package: "pkg1", corroboratedBy: [{ tool: "t1", id: "CVE-2024-0001", path: "", basis: "unclassified" }], tools: 2, independentBases: 0, agreement: "same-basis" }]);
});

test('does not corroborate rows in different repos', () => {
  const r = markCorroboration([
    { id: 'CVE-2024-0001', tool: 't1', key: 'repo1', package: 'pkg1' },
    { id: 'CVE-2024-0001', tool: 't2', key: 'repo2', package: 'pkg1' }
  ]);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", tool: "t1", key: "repo1", package: "pkg1" }, { id: "CVE-2024-0001", tool: "t2", key: "repo2", package: "pkg1" }]);
});

test('does not corroborate rows in different packages', () => {
  const r = markCorroboration([
    { id: 'CVE-2024-0001', tool: 't1', key: 'repo1', package: 'pkg1' },
    { id: 'CVE-2024-0001', tool: 't2', key: 'repo1', package: 'pkg2' }
  ]);
  assert.deepEqual(r, [{ id: "CVE-2024-0001", tool: "t1", key: "repo1", package: "pkg1" }, { id: "CVE-2024-0001", tool: "t2", key: "repo1", package: "pkg2" }]);
});

test('handles null entries in findings array', () => {
  const r = markCorroboration([null, { id: 'CVE-2024-0001', tool: 't1', key: 'repo1', package: 'pkg1' }]);
  assert.deepEqual(r, [null, { id: "CVE-2024-0001", tool: "t1", key: "repo1", package: "pkg1" }]);
});
