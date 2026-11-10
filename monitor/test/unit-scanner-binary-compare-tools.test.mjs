// Compares observed tools against a baseline to detect changes, removals, and state transitions (monitor/scanner-binary.mjs compareTools).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTools } from '../scanner-binary.mjs';

test('returns no-baseline state when baseline is null', () => {
  const observed = [{ name: 'a', path: '/p', sha256: 'h1', version: '1.0' }];
  const result = compareTools(observed, null);
  assert.deepEqual(result, { rows: [{ name: "a", path: "/p", sha256: "h1", version: "1.0", state: "unbaselined" }], findings: [], state: "no-baseline" });
});

test('returns ok state when tool matches baseline exactly', () => {
  const observed = [{ name: 'a', path: '/p', sha256: 'h1', version: '1.0' }];
  const baseline = { tools: { a: { path: '/p', sha256: 'h1', version: '1.0' } } };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", path: "/p", sha256: "h1", version: "1.0", state: "ok" }], findings: [], state: "ok" });
});

test('returns findings state when tool is removed', () => {
  const observed = [{ name: 'a', path: null, sha256: null, version: null }];
  const baseline = { tools: { a: { path: '/p', sha256: 'h1', version: '1.0' } } };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", state: "removed", baseline: { path: "/p", sha256: "h1", version: "1.0" } }], findings: [{ name: "a", state: "removed", baseline: { path: "/p", sha256: "h1", version: "1.0" } }], state: "findings" });
});

test('returns unpinned state when tool is unbaselined', () => {
  const observed = [{ name: 'a', path: '/p', sha256: 'h1', version: '1.0' }];
  const baseline = { tools: {} };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", path: "/p", sha256: "h1", version: "1.0", state: "unbaselined" }], findings: [], state: "unpinned" });
});

test('returns findings state when tool is swapped with same version', () => {
  const observed = [{ name: 'a', path: '/p', sha256: 'h2', version: '1.0' }];
  const baseline = { tools: { a: { path: '/p', sha256: 'h1', version: '1.0' } } };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", path: "/p", sha256: "h2", version: "1.0", state: "swapped", baseline: { path: "/p", sha256: "h1", version: "1.0" }, versionComparable: true }], findings: [{ name: "a", path: "/p", sha256: "h2", version: "1.0", state: "swapped", baseline: { path: "/p", sha256: "h1", version: "1.0" }, versionComparable: true }], state: "findings" });
});

test('returns findings state when tool is changed with different versions', () => {
  const observed = [{ name: 'a', path: '/p', sha256: 'h2', version: '2.0' }];
  const baseline = { tools: { a: { path: '/p', sha256: 'h1', version: '1.0' } } };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", path: "/p", sha256: "h2", version: "2.0", state: "changed", baseline: { path: "/p", sha256: "h1", version: "1.0" }, versionComparable: true }], findings: [{ name: "a", path: "/p", sha256: "h2", version: "2.0", state: "changed", baseline: { path: "/p", sha256: "h1", version: "1.0" }, versionComparable: true }], state: "findings" });
});

test('returns unpinned state when tool is unhashable', () => {
  const observed = [{ name: 'a', path: '/p', sha256: null, version: null, unknownReason: 'r', unknownDetail: 'd' }];
  const baseline = { tools: { a: { path: '/p', sha256: 'h1', version: '1.0' } } };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", state: "unhashable", path: "/p", unknownReason: "r", unknownDetail: "d" }], findings: [], state: "unpinned" });
});

test('returns ok state when tool moved but hash matches', () => {
  const observed = [{ name: 'a', path: '/new', sha256: 'h1', version: '1.0' }];
  const baseline = { tools: { a: { path: '/old', sha256: 'h1', version: '1.0' } } };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", path: "/new", sha256: "h1", version: "1.0", state: "ok", moved: true, from: "/old" }], findings: [], state: "ok" });
});

test('returns findings state when tool changed and moved', () => {
  const observed = [{ name: 'a', path: '/new', sha256: 'h2', version: '2.0' }];
  const baseline = { tools: { a: { path: '/old', sha256: 'h1', version: '1.0' } } };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", path: "/new", sha256: "h2", version: "2.0", state: "changed", baseline: { path: "/old", sha256: "h1", version: "1.0" }, moved: true, versionComparable: true }], findings: [{ name: "a", path: "/new", sha256: "h2", version: "2.0", state: "changed", baseline: { path: "/old", sha256: "h1", version: "1.0" }, moved: true, versionComparable: true }], state: "findings" });
});

test('returns ok state when version is null but hash matches', () => {
  const observed = [{ name: 'a', path: '/p', sha256: 'h1', version: null }];
  const baseline = { tools: { a: { path: '/p', sha256: 'h1', version: '1.0' } } };
  const result = compareTools(observed, baseline);
  assert.deepEqual(result, { rows: [{ name: "a", path: "/p", sha256: "h1", version: null, versionAxis: { unknown: true, unknownReason: "unstated", unknownDetail: "version output unreadable" }, state: "ok" }], findings: [], state: "ok" });
});
