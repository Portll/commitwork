// Computes the list of failed work items and the count of undetermined fields for one sweep-area-verdict (bin/digest.mjs areaVerdictFailures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaVerdictFailures } from '../digest.mjs';

test('returns zero unknown and no failures when every field is present and healthy', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [{ name: 'n1', ran: true, manifest: 'm1' }], missing: [] },
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'ok' },
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'ok' },
    steps: { a: 'ok' },
    finalize: { b: 'ok' }
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [], unknown: 0 });
});

test('counts repos as unknown when repos is missing', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'ok' },
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'ok' },
    steps: {},
    finalize: {}
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [], unknown: 1 });
});

test('adds a scan-not-run failure for a scan with ran false and a manifest', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [{ name: 'n1', ran: false, manifest: 'm1', why: 'w1' }], missing: [] },
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'ok' },
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'ok' },
    steps: {},
    finalize: {}
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [{ at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "scan-not-run", subject: "n1 (m1)", detail: "w1", key: "sweep:scan-not-run|a/n1/m1" }], unknown: 0 });
});

test('adds a scan-not-run failure for a scan with ran false and no manifest', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [{ name: 'n2', ran: false }], missing: [] },
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'ok' },
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'ok' },
    steps: {},
    finalize: {}
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [{ at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "scan-not-run", subject: "n2", detail: null, key: "sweep:scan-not-run|a/n2" }], unknown: 0 });
});

test('adds a rollup-not-published failure when rollup is not published', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [], missing: [] },
    rollup: 'failed',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'ok' },
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'ok' },
    steps: {},
    finalize: {}
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [{ at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "rollup-not-published", subject: "rollup", detail: "failed", key: "sweep:rollup-not-published|a/rollup" }], unknown: 0 });
});

test('adds a step-failed failure for issues when issues is the string failed', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [], missing: [] },
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: 'failed',
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'ok' },
    steps: {},
    finalize: {}
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [{ at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "step-failed", subject: "issues", detail: null, key: "sweep:step-failed|a/issues" }], unknown: 0 });
});

test('adds an ingest-refused failure when issues is an object with status refused', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [], missing: [] },
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'refused' },
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'ok' },
    steps: {},
    finalize: {}
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [{ at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "ingest-refused", subject: "issues", detail: "refused", key: "sweep:ingest-refused|a/issues" }], unknown: 0 });
});

test('adds an export-failed failure when memoryExport kind is broken with a reason', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [], missing: [] },
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'ok' },
    memoryExport: { kind: 'broken', state: 'err', reason: 'r1' },
    canary: { state: 'ok' },
    steps: {},
    finalize: {}
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [{ at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "export-failed", subject: "memoryExport", detail: "err: r1", key: "sweep:export-failed|a/memoryExport" }], unknown: 0 });
});

test('adds a canary-failed failure when canary state is failed with a why', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [], missing: [] },
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'ok' },
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'failed', why: 'w1' },
    steps: {},
    finalize: {}
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [{ at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "canary-failed", subject: "canary", detail: "w1", key: "sweep:canary-failed|a/canary" }], unknown: 0 });
});

test('adds step-failed failures for failed steps and finalize entries sorted by key', () => {
  const v = {
    at: '2025-01-01T00:00:00Z',
    area: 'a',
    sliceId: 's1',
    repos: { scans: [], missing: [] },
    rollup: 'published',
    preflight: 'ok',
    hostInventory: 'ok',
    races: 'ok',
    issues: { status: 'ok' },
    memoryExport: { kind: 'ok', state: 'done' },
    canary: { state: 'ok' },
    steps: { b: 'failed', a: 'ok' },
    finalize: { c: 'failed' }
  };
  assert.deepEqual(areaVerdictFailures(v), { failures: [{ at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "step-failed", subject: "steps.b", detail: null, key: "sweep:step-failed|a/steps.b" }, { at: "2025-01-01T00:00:00Z", area: "a", sliceId: "s1", type: "step-failed", subject: "finalize.c", detail: null, key: "sweep:step-failed|a/finalize.c" }], unknown: 0 });
});
