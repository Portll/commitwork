// Derives scanner and CVE adjudication candidates from a document (bin/adjudication-import.mjs deriveAll).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAll } from '../adjudication-import.mjs';

test('returns empty derived and skipped arrays for an empty document', () => {
  const input = {};
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [], skipped: [], counts: { scanner: 0, cve: 0 } });
});

test('derives a scanner annotation with a known category and repo', () => {
  const input = {
    scannerAnnotations: [
      { category: 'secret', repo: 'acme', file: 'src/a.js', action: 'false-positive', reason: 'test', who: 'alice', at: '2024-01-01' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [], skipped: [{ reason: "unknown category 'secret'" }], counts: { scanner: 0, cve: 0 } });
});

test('skips a scanner annotation with an unknown category', () => {
  const input = {
    scannerAnnotations: [
      { category: 'mystery', repo: 'acme', file: 'src/a.js', action: 'accept', reason: 'x', who: 'bob', at: '2024-01-01' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [], skipped: [{ reason: "unknown category 'mystery'" }], counts: { scanner: 0, cve: 0 } });
});

test('skips a scanner annotation with no repo and not fleet scope', () => {
  const input = {
    scannerAnnotations: [
      { category: 'secret', action: 'accept', reason: 'x', who: 'bob', at: '2024-01-01' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [], skipped: [{ reason: "unknown category 'secret'" }], counts: { scanner: 0, cve: 0 } });
});

test('derives a scanner annotation with fleet scope and no repo', () => {
  const input = {
    scannerAnnotations: [
      { category: 'secret', scope: 'fleet', file: 'src/a.js', action: 'wont-fix', reason: 'y', who: 'carol', at: '2024-02-02' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [], skipped: [{ reason: "unknown category 'secret'" }], counts: { scanner: 0, cve: 0 } });
});

test('derives a CVE annotation with all required fields', () => {
  const input = {
    annotations: [
      { repo: 'acme', id: 'CVE-2024-0001', package: 'lodash', action: 'false-positive', reason: 'patched', who: 'dave', at: '2024-03-03' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [{ findingKey: "acme|CVE-2024-0001|lodash", category: "dependency-cve", repo: "acme", machineVerdict: null, humanVerdict: "false-positive", truth: "false-alarm", basis: "patched", evidence: null, model: null, promptId: null, bornSlice: null, importKey: "b4a2f97586eb8625bedd765890db35cb8600e2b381d68fd7c7cec7491d2e1c22", place: "dependency-cve:CVE-2024-0001:lodash", artifact: "monitor/annotations.json#annotations" }], skipped: [], counts: { scanner: 0, cve: 1 } });
});

test('skips a CVE annotation missing the repo field', () => {
  const input = {
    annotations: [
      { id: 'CVE-2024-0002', package: 'express', action: 'accept', reason: 'z', who: 'eve', at: '2024-04-04' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [], skipped: [{ reason: "CVE-2024-0002/express: missing repo/id/package \u2014 wildcard-by-omission cannot be pinned to one finding" }], counts: { scanner: 0, cve: 0 } });
});

test('skips a CVE annotation missing the id field', () => {
  const input = {
    annotations: [
      { repo: 'acme', package: 'lodash', action: 'accept', reason: 'z', who: 'eve', at: '2024-04-04' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [], skipped: [{ reason: "(no id)/lodash: missing repo/id/package \u2014 wildcard-by-omission cannot be pinned to one finding" }], counts: { scanner: 0, cve: 0 } });
});

test('skips a CVE annotation missing the package field', () => {
  const input = {
    annotations: [
      { repo: 'acme', id: 'CVE-2024-0003', action: 'accept', reason: 'z', who: 'eve', at: '2024-04-04' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [], skipped: [{ reason: "CVE-2024-0003/(no package): missing repo/id/package \u2014 wildcard-by-omission cannot be pinned to one finding" }], counts: { scanner: 0, cve: 0 } });
});

test('combines scanner and CVE annotations into a single result', () => {
  const input = {
    scannerAnnotations: [
      { category: 'secret', repo: 'acme', file: 'src/a.js', action: 'accept', reason: 'r1', who: 'w1', at: '2024-01-01' }
    ],
    annotations: [
      { repo: 'acme', id: 'CVE-2024-0004', package: 'lodash', action: 'accept', reason: 'r2', who: 'w2', at: '2024-01-01' }
    ]
  };
  const result = deriveAll(input);
  assert.deepEqual(result, { derived: [{ findingKey: "acme|CVE-2024-0004|lodash", category: "dependency-cve", repo: "acme", machineVerdict: null, humanVerdict: "accept", truth: null, basis: "r2", evidence: null, model: null, promptId: null, bornSlice: null, importKey: "be4d7f977b8168b720815686d94415bf81896e8ea6b67a557a002e15031b7ab2", place: "dependency-cve:CVE-2024-0004:lodash", artifact: "monitor/annotations.json#annotations" }], skipped: [{ reason: "unknown category 'secret'" }], counts: { scanner: 0, cve: 1 } });
});
