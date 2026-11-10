// Groups findings by detector address and reports bucket sizes and unaddressed reasons (monitor/detector-identity.mjs byDetector).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byDetector } from '../detector-identity.mjs';

test('returns empty buckets and zero counts for null rows', () => {
  assert.deepEqual(byDetector(null), { buckets: new Map([]), unaddressed: [], report: { rows: 0, addressed: 0, unaddressed: 0, detectors: 0, reasons: {}, largestBucket: { address: null, n: 0 } } });
});

test('returns empty buckets and zero counts for undefined rows', () => {
  assert.deepEqual(byDetector(undefined), { buckets: new Map([]), unaddressed: [], report: { rows: 0, addressed: 0, unaddressed: 0, detectors: 0, reasons: {}, largestBucket: { address: null, n: 0 } } });
});

test('returns empty buckets and zero counts for empty rows array', () => {
  assert.deepEqual(byDetector([]), { buckets: new Map([]), unaddressed: [], report: { rows: 0, addressed: 0, unaddressed: 0, detectors: 0, reasons: {}, largestBucket: { address: null, n: 0 } } });
});

test('buckets a single valid trufflehog row and reports one addressed finding', () => {
  const rows = [{ tool: 'trufflehog', DetectorName: 'MongoDB' }];
  assert.deepEqual(byDetector(rows), { buckets: new Map([["trufflehog/MongoDB", [{ tool: "trufflehog", DetectorName: "MongoDB" }]]]), unaddressed: [], report: { rows: 1, addressed: 1, unaddressed: 0, detectors: 1, reasons: {}, largestBucket: { address: "trufflehog/MongoDB", n: 1 } } });
});

test('buckets multiple rows into the same detector address', () => {
  const rows = [
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
  ];
  assert.deepEqual(byDetector(rows), { buckets: new Map([["trufflehog/MongoDB", [{ tool: "trufflehog", DetectorName: "MongoDB" }, { tool: "trufflehog", DetectorName: "MongoDB" }, { tool: "trufflehog", DetectorName: "MongoDB" }]]]), unaddressed: [], report: { rows: 3, addressed: 3, unaddressed: 0, detectors: 1, reasons: {}, largestBucket: { address: "trufflehog/MongoDB", n: 3 } } });
});

test('buckets rows across different detectors and reports the largest bucket', () => {
  const rows = [
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
    { tool: 'scorecard', name: 'Branch-Protection' },
  ];
  assert.deepEqual(byDetector(rows), { buckets: new Map([["trufflehog/MongoDB", [{ tool: "trufflehog", DetectorName: "MongoDB" }, { tool: "trufflehog", DetectorName: "MongoDB" }]], ["scorecard/Branch-Protection", [{ tool: "scorecard", name: "Branch-Protection" }]]]), unaddressed: [], report: { rows: 3, addressed: 3, unaddressed: 0, detectors: 2, reasons: {}, largestBucket: { address: "trufflehog/MongoDB", n: 2 } } });
});

test('counts unaddressed rows with unknown tool reason', () => {
  const rows = [
    { tool: 'unknown-tool', foo: 'bar' },
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
  ];
  assert.deepEqual(byDetector(rows), { buckets: new Map([["trufflehog/MongoDB", [{ tool: "trufflehog", DetectorName: "MongoDB" }]]]), unaddressed: [{ tool: "unknown-tool", foo: "bar" }], report: { rows: 2, addressed: 1, unaddressed: 1, detectors: 1, reasons: { "no extractor declared for tool 'unknown-tool'": 1 }, largestBucket: { address: "trufflehog/MongoDB", n: 1 } } });
});

test('counts unaddressed rows with missing field reason', () => {
  const rows = [
    { tool: 'trufflehog' },
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
  ];
  assert.deepEqual(byDetector(rows), { buckets: new Map([["trufflehog/MongoDB", [{ tool: "trufflehog", DetectorName: "MongoDB" }]]]), unaddressed: [{ tool: "trufflehog" }], report: { rows: 2, addressed: 1, unaddressed: 1, detectors: 1, reasons: { "tool 'trufflehog' declared, but this row carries no DetectorName": 1 }, largestBucket: { address: "trufflehog/MongoDB", n: 1 } } });
});

test('aggregates multiple unaddressed rows with the same reason', () => {
  const rows = [
    { tool: 'unknown-tool', foo: 'bar' },
    { tool: 'unknown-tool', foo: 'baz' },
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
  ];
  assert.deepEqual(byDetector(rows), { buckets: new Map([["trufflehog/MongoDB", [{ tool: "trufflehog", DetectorName: "MongoDB" }]]]), unaddressed: [{ tool: "unknown-tool", foo: "bar" }, { tool: "unknown-tool", foo: "baz" }], report: { rows: 3, addressed: 1, unaddressed: 2, detectors: 1, reasons: { "no extractor declared for tool 'unknown-tool'": 2 }, largestBucket: { address: "trufflehog/MongoDB", n: 1 } } });
});

test('reports largest bucket when two buckets have equal size', () => {
  const rows = [
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
    { tool: 'trufflehog', DetectorName: 'MongoDB' },
    { tool: 'scorecard', name: 'Branch-Protection' },
    { tool: 'scorecard', name: 'Branch-Protection' },
  ];
  assert.deepEqual(byDetector(rows), { buckets: new Map([["trufflehog/MongoDB", [{ tool: "trufflehog", DetectorName: "MongoDB" }, { tool: "trufflehog", DetectorName: "MongoDB" }]], ["scorecard/Branch-Protection", [{ tool: "scorecard", name: "Branch-Protection" }, { tool: "scorecard", name: "Branch-Protection" }]]]), unaddressed: [], report: { rows: 4, addressed: 4, unaddressed: 0, detectors: 2, reasons: {}, largestBucket: { address: "trufflehog/MongoDB", n: 2 } } });
});
