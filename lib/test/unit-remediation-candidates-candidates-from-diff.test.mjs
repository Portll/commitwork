// computes remediation candidates from a unified diff (lib/remediation-candidates.mjs candidatesFromDiff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFromDiff } from '../remediation-candidates.mjs';

const simpleDiff = [
  'diff --git a/file.txt b/file.txt',
  '--- a/file.txt',
  '+++ b/file.txt',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

const twoFileDiff = [
  'diff --git a/a.txt b/a.txt',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1 +1 @@',
  '-a1',
  '+a2',
  'diff --git a/b.txt b/b.txt',
  '--- a/b.txt',
  '+++ b/b.txt',
  '@@ -1 +1 @@',
  '-b1',
  '+b2',
].join('\n');

test('returns empty arrays when there are no findings', () => {
  const input = { findings: [], diff: simpleDiff, tool: null, version: null };
  const result = candidatesFromDiff(input);
  assert.deepEqual(result, { candidates: [], unattributed: [{ path: "file.txt" }] });
});

test('creates a candidate for a matching finding in a single\u2011file diff', () => {
  const input = {
    findings: [{ identity: 'id1', occurrence: 0, file: 'file.txt' }],
    diff: simpleDiff,
    tool: 'mytool',
    version: '1.2.3',
  };
  const result = candidatesFromDiff(input);
  assert.deepEqual(result, { candidates: [{ identity: "id1", occurrence: 0, candidate: { id: "f03cbf1b28812284", tier: "deterministic", provenance: { tool: "mytool", model: null, version: "1.2.3" }, patch: "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new", cached: false, verification: { status: "unverified", witness: { lanes: [], before: 0, after: null, digest: null }, newFindings: [], tests: { command: null, status: "notDeclared" }, reason: null } } }], unattributed: [] });
});

test('includes an unattributed entry when a changed file has no matching finding', () => {
  const input = {
    findings: [{ identity: 'id1', occurrence: 0, file: null }],
    diff: simpleDiff,
    tool: null,
    version: null,
  };
  const result = candidatesFromDiff(input);
  assert.deepEqual(result, { candidates: [], unattributed: [{ path: "file.txt" }] });
});

test('throws when a finding has an invalid identity type', () => {
  const input = {
    findings: [{ identity: 123, occurrence: 0, file: 'file.txt' }],
    diff: simpleDiff,
    tool: null,
    version: null,
  };
  assert.throws(() => candidatesFromDiff(input), {
    name: 'TypeError',
    message: 'candidatesFromDiff: findings[0].identity must be a non-empty string',
  });
});

test('throws when a finding has a negative occurrence', () => {
  const input = {
    findings: [{ identity: 'id', occurrence: -1, file: 'file.txt' }],
    diff: simpleDiff,
    tool: null,
    version: null,
  };
  assert.throws(() => candidatesFromDiff(input), {
    name: 'TypeError',
    message: 'candidatesFromDiff: findings[0].occurrence must be a non-negative integer',
  });
});

test('original code throws on a slice that parses to two files (detects changed loop start)', () => {
  const input = {
    findings: [{ identity: 'idA', occurrence: 0, file: 'a.txt' }],
    diff: twoFileDiff,
    tool: null,
    version: null,
  };
  assert.deepStrictEqual(candidatesFromDiff(input), { candidates: [{ identity: "idA", occurrence: 0, candidate: { id: "26879b5228da7356", tier: "deterministic", provenance: { tool: null, model: null, version: null }, patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a1\n+a2\n", cached: false, verification: { status: "unverified", witness: { lanes: [], before: 0, after: null, digest: null }, newFindings: [], tests: { command: null, status: "notDeclared" }, reason: null } } }], unattributed: [{ path: "b.txt" }] });
});

test('original code returns a candidate for the first file in a two\u2011file diff (detects loop start change)', () => {
  const input = {
    findings: [{ identity: 'idA', occurrence: 0, file: 'a.txt' }],
    diff: twoFileDiff,
    tool: null,
    version: null,
  };
  const result = candidatesFromDiff(input);
  assert.deepEqual(result, { candidates: [{ identity: "idA", occurrence: 0, candidate: { id: "26879b5228da7356", tier: "deterministic", provenance: { tool: null, model: null, version: null }, patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a1\n+a2\n", cached: false, verification: { status: "unverified", witness: { lanes: [], before: 0, after: null, digest: null }, newFindings: [], tests: { command: null, status: "notDeclared" }, reason: null } } }], unattributed: [{ path: "b.txt" }] });
});

test('original code does not throw when a slice parses to a single file (detects changed again[1] access)', () => {
  const input = {
    findings: [{ identity: 'id1', occurrence: 0, file: 'file.txt' }],
    diff: simpleDiff,
    tool: null,
    version: null,
  };
  const result = candidatesFromDiff(input);
  assert.deepEqual(result, { candidates: [{ identity: "id1", occurrence: 0, candidate: { id: "f03cbf1b28812284", tier: "deterministic", provenance: { tool: null, model: null, version: null }, patch: "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new", cached: false, verification: { status: "unverified", witness: { lanes: [], before: 0, after: null, digest: null }, newFindings: [], tests: { command: null, status: "notDeclared" }, reason: null } } }], unattributed: [] });
});
