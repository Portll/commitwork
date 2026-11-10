// Computes fixed, remaining, and introduced rows between two vulnerability snapshots (monitor/update-vulns.mjs setDiff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setDiff } from '../update-vulns.mjs';

test('returns empty arrays when both inputs are empty', () => {
  const r = setDiff([], []);
  assert.deepEqual(r, { fixed: [], remaining: [], introduced: [] });
});

test('returns all rows as introduced when now is empty', () => {
  const after = [
    { id: 'CVE-1', component: 'pkg-a' },
    { id: 'CVE-2', component: 'pkg-b' },
  ];
  const r = setDiff([], after);
  assert.deepEqual(r, { fixed: [], remaining: [], introduced: [{ id: "CVE-1", component: "pkg-a" }, { id: "CVE-2", component: "pkg-b" }] });
});

test('returns all rows as fixed when after is empty', () => {
  const now = [
    { id: 'CVE-1', component: 'pkg-a' },
    { id: 'CVE-2', component: 'pkg-b' },
  ];
  const r = setDiff(now, []);
  assert.deepEqual(r, { fixed: [{ id: "CVE-1", component: "pkg-a" }, { id: "CVE-2", component: "pkg-b" }], remaining: [], introduced: [] });
});

test('returns all rows as remaining when inputs are identical', () => {
  const rows = [
    { id: 'CVE-1', component: 'pkg-a' },
    { id: 'CVE-2', component: 'pkg-b' },
    { id: 'CVE-3', component: 'pkg-c' },
  ];
  const r = setDiff(rows, rows);
  assert.deepEqual(r, { fixed: [], remaining: [{ id: "CVE-1", component: "pkg-a" }, { id: "CVE-2", component: "pkg-b" }, { id: "CVE-3", component: "pkg-c" }], introduced: [] });
});

test('classifies a mix of fixed, remaining, and introduced rows', () => {
  const now = [
    { id: 'CVE-1', component: 'pkg-a' },
    { id: 'CVE-2', component: 'pkg-b' },
    { id: 'CVE-3', component: 'pkg-c' },
  ];
  const after = [
    { id: 'CVE-2', component: 'pkg-b' },
    { id: 'CVE-3', component: 'pkg-c' },
    { id: 'CVE-4', component: 'pkg-d' },
  ];
  const r = setDiff(now, after);
  assert.deepEqual(r, { fixed: [{ id: "CVE-1", component: "pkg-a" }], remaining: [{ id: "CVE-2", component: "pkg-b" }, { id: "CVE-3", component: "pkg-c" }], introduced: [{ id: "CVE-4", component: "pkg-d" }] });
});

test('distinguishes rows with same id but different components', () => {
  const now = [
    { id: 'CVE-1', component: 'pkg-a' },
    { id: 'CVE-1', component: 'pkg-b' },
  ];
  const after = [
    { id: 'CVE-1', component: 'pkg-a' },
    { id: 'CVE-1', component: 'pkg-c' },
  ];
  const r = setDiff(now, after);
  assert.deepEqual(r, { fixed: [{ id: "CVE-1", component: "pkg-b" }], remaining: [{ id: "CVE-1", component: "pkg-a" }], introduced: [{ id: "CVE-1", component: "pkg-c" }] });
});

test('handles duplicate rows in after correctly', () => {
  const now = [
    { id: 'CVE-1', component: 'pkg-a' },
  ];
  const after = [
    { id: 'CVE-1', component: 'pkg-a' },
    { id: 'CVE-1', component: 'pkg-a' },
  ];
  const r = setDiff(now, after);
  assert.deepEqual(r, { fixed: [], remaining: [{ id: "CVE-1", component: "pkg-a" }, { id: "CVE-1", component: "pkg-a" }], introduced: [] });
});

test('handles duplicate rows in now correctly', () => {
  const now = [
    { id: 'CVE-1', component: 'pkg-a' },
    { id: 'CVE-1', component: 'pkg-a' },
  ];
  const after = [
    { id: 'CVE-1', component: 'pkg-a' },
  ];
  const r = setDiff(now, after);
  assert.deepEqual(r, { fixed: [], remaining: [{ id: "CVE-1", component: "pkg-a" }], introduced: [] });
});
