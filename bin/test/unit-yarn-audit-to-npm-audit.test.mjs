// Converts yarn audit advisories into an npm audit v2 report shape (bin/yarn-audit.mjs toNpmAudit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNpmAudit } from '../yarn-audit.mjs';

test('empty advisories and locked map produce zero counts and empty vulnerabilities', () => {
  const r = toNpmAudit({}, new Map(), new Set());
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 0 } } });
});

test('single low advisory increments low count and total by one', () => {
  const advisories = { 'left-pad': [{ id: 1, title: 't', url: 'u', severity: 'low', cwe: ['CWE-1'], cvss: { score: 3, vectorString: 'v' }, vulnerable_versions: '<1.0.0' }] };
  const locked = new Map([['left-pad', ['1.0.0']]]);
  const directDeps = new Set(['left-pad']);
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { "left-pad": { name: "left-pad", severity: "low", isDirect: true, via: [{ source: 1, name: "left-pad", dependency: "left-pad", title: "t", url: "u", severity: "low", cwe: ["CWE-1"], cvss: { score: 3, vectorString: "v" }, range: "<1.0.0" }], effects: [], range: "1.0.0", nodes: ["node_modules/left-pad"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } });
});

test('advisory with undefined items is skipped and does not affect counts', () => {
  const advisories = { 'skipped': undefined, 'real': [{ id: 2, title: 'x', url: 'y', severity: 'high', cwe: [], cvss: null, vulnerable_versions: '>=2.0.0' }] };
  const locked = new Map([['real', ['2.1.0']]]);
  const directDeps = new Set();
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { real: { name: "real", severity: "high", isDirect: false, via: [{ source: 2, name: "real", dependency: "real", title: "x", url: "y", severity: "high", cwe: [], cvss: { score: 0, vectorString: null }, range: ">=2.0.0" }], effects: [], range: "2.1.0", nodes: ["node_modules/real"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } });
});

test('advisory with empty items array is skipped and does not affect counts', () => {
  const advisories = { 'empty': [], 'real': [{ id: 3, title: 'z', url: 'w', severity: 'critical', cwe: ['CWE-2'], cvss: { score: 9.8, vectorString: 'cv' }, vulnerable_versions: '*' }] };
  const locked = new Map([['real', ['3.0.0', '3.1.0']]]);
  const directDeps = new Set(['real']);
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { real: { name: "real", severity: "critical", isDirect: true, via: [{ source: 3, name: "real", dependency: "real", title: "z", url: "w", severity: "critical", cwe: ["CWE-2"], cvss: { score: 9.8, vectorString: "cv" }, range: "*" }], effects: [], range: "3.0.0 || 3.1.0", nodes: ["node_modules/real"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } });
});

test('advisory with missing title and severity uses empty string and low rank', () => {
  const advisories = { 'no-title': [{ id: 4, cwe: [], cvss: null, vulnerable_versions: '' }] };
  const locked = new Map([['no-title', ['0.1.0']]]);
  const directDeps = new Set();
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { "no-title": { name: "no-title", severity: "low", isDirect: false, via: [{ source: 4, name: "no-title", dependency: "no-title", title: "", url: "", severity: "", cwe: [], cvss: { score: 0, vectorString: null }, range: "" }], effects: [], range: "0.1.0", nodes: ["node_modules/no-title"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } });
});

test('advisory with missing cvss object defaults score to zero and vectorString to null', () => {
  const advisories = { 'no-cvss': [{ id: 5, title: 'tc', url: 'uc', severity: 'moderate', cwe: ['CWE-3'], vulnerable_versions: '<5.0.0' }] };
  const locked = new Map([['no-cvss', ['5.0.0']]]);
  const directDeps = new Set(['no-cvss']);
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { "no-cvss": { name: "no-cvss", severity: "moderate", isDirect: true, via: [{ source: 5, name: "no-cvss", dependency: "no-cvss", title: "tc", url: "uc", severity: "moderate", cwe: ["CWE-3"], cvss: { score: 0, vectorString: null }, range: "<5.0.0" }], effects: [], range: "5.0.0", nodes: ["node_modules/no-cvss"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } });
});

test('advisory with missing id and github_advisory_id falls back to package name as source', () => {
  const advisories = { 'fallback-src': [{ title: 'fs', url: 'us', severity: 'info', cwe: [], cvss: { score: 0, vectorString: null }, vulnerable_versions: '1.0.0' }] };
  const locked = new Map([['fallback-src', ['1.0.0']]]);
  const directDeps = new Set();
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { "fallback-src": { name: "fallback-src", severity: "low", isDirect: false, via: [{ source: "fallback-src", name: "fallback-src", dependency: "fallback-src", title: "fs", url: "us", severity: "info", cwe: [], cvss: { score: 0, vectorString: null }, range: "1.0.0" }], effects: [], range: "1.0.0", nodes: ["node_modules/fallback-src"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } });
});

test('advisory with github_advisory_id uses it as source when id is missing', () => {
  const advisories = { 'gh-src': [{ github_advisory_id: 'GHSA-abc', title: 'gt', url: 'gu', severity: 'high', cwe: ['CWE-4'], cvss: { score: 7.5, vectorString: 'gv' }, vulnerable_versions: '<2.0.0' }] };
  const locked = new Map([['gh-src', ['2.0.0']]]);
  const directDeps = new Set(['gh-src']);
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { "gh-src": { name: "gh-src", severity: "high", isDirect: true, via: [{ source: "GHSA-abc", name: "gh-src", dependency: "gh-src", title: "gt", url: "gu", severity: "high", cwe: ["CWE-4"], cvss: { score: 7.5, vectorString: "gv" }, range: "<2.0.0" }], effects: [], range: "2.0.0", nodes: ["node_modules/gh-src"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } });
});

test('multiple advisories with different severities produce correct per-severity counts', () => {
  const advisories = {
    'pkg-a': [{ id: 10, title: 'a', url: 'ua', severity: 'low', cwe: [], cvss: null, vulnerable_versions: '<1.0.0' }],
    'pkg-b': [{ id: 11, title: 'b', url: 'ub', severity: 'high', cwe: [], cvss: null, vulnerable_versions: '<2.0.0' }],
    'pkg-c': [{ id: 12, title: 'c', url: 'uc', severity: 'critical', cwe: [], cvss: null, vulnerable_versions: '<3.0.0' }]
  };
  const locked = new Map([['pkg-a', ['1.0.0']], ['pkg-b', ['2.0.0']], ['pkg-c', ['3.0.0']]]);
  const directDeps = new Set(['pkg-a', 'pkg-b']);
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { "pkg-a": { name: "pkg-a", severity: "low", isDirect: true, via: [{ source: 10, name: "pkg-a", dependency: "pkg-a", title: "a", url: "ua", severity: "low", cwe: [], cvss: { score: 0, vectorString: null }, range: "<1.0.0" }], effects: [], range: "1.0.0", nodes: ["node_modules/pkg-a"], fixAvailable: false }, "pkg-b": { name: "pkg-b", severity: "high", isDirect: true, via: [{ source: 11, name: "pkg-b", dependency: "pkg-b", title: "b", url: "ub", severity: "high", cwe: [], cvss: { score: 0, vectorString: null }, range: "<2.0.0" }], effects: [], range: "2.0.0", nodes: ["node_modules/pkg-b"], fixAvailable: false }, "pkg-c": { name: "pkg-c", severity: "critical", isDirect: false, via: [{ source: 12, name: "pkg-c", dependency: "pkg-c", title: "c", url: "uc", severity: "critical", cwe: [], cvss: { score: 0, vectorString: null }, range: "<3.0.0" }], effects: [], range: "3.0.0", nodes: ["node_modules/pkg-c"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 1, critical: 1, total: 3 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 3 } } });
});

test('locked map with multiple versions joins them with double pipe', () => {
  const advisories = { 'multi-ver': [{ id: 20, title: 'mv', url: 'umv', severity: 'moderate', cwe: ['CWE-5'], cvss: { score: 5.5, vectorString: 'vmv' }, vulnerable_versions: '<4.0.0' }] };
  const locked = new Map([['multi-ver', ['4.0.0', '4.1.0', '4.2.0']]]);
  const directDeps = new Set();
  const r = toNpmAudit(advisories, locked, directDeps);
  assert.deepEqual(r, { auditReportVersion: 2, vulnerabilities: { "multi-ver": { name: "multi-ver", severity: "moderate", isDirect: false, via: [{ source: 20, name: "multi-ver", dependency: "multi-ver", title: "mv", url: "umv", severity: "moderate", cwe: ["CWE-5"], cvss: { score: 5.5, vectorString: "vmv" }, range: "<4.0.0" }], effects: [], range: "4.0.0 || 4.1.0 || 4.2.0", nodes: ["node_modules/multi-ver"], fixAvailable: false } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 }, dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } });
});
