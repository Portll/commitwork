// Derives inbox items and not-measured signals from a rollup (monitor/inbox.mjs deriveInbox).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveInbox } from '../inbox.mjs';

test('sliceId is null when rollup.sliceId is falsy', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: '', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.equal(r.sliceId, null);
});

test('sliceId equals rollup.sliceId when truthy', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.equal(r.sliceId, "s1");
});

test('hung inflight with startedAt produces at equal to startedAt', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'hung', sliceId: 's1', ageMin: 5, pid: 123, pidState: 'dead', startedAt: '2025-01-01T00:00:00Z' }, lastIngest: null, ingestError: null });
  assert.equal(r.items[0].at, "2025-01-01T00:00:00Z");
});

test('hung inflight without startedAt produces at null', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'hung', sliceId: 's1', ageMin: 5, pid: 123, pidState: 'dead', startedAt: null }, lastIngest: null, ingestError: null });
  assert.equal(r.items[0].at, null);
});

test('unreadable inflight produces a sweep-failed item with marker detail', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'unreadable', detail: 'corrupt' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.items, [{ id: "sweep-failed|p|marker-unreadable:corrupt", kind: "sweep-failed", project: "p", priority: true, title: "Sweep state cannot be read: the in-flight marker is corrupt; treated as failed", at: null, detail: { marker: "corrupt" } }, { id: "ingest-behind|p|slice:s1", kind: "ingest-behind", project: "p", priority: false, title: "Work items were never ingested for this area", at: "2025-01-01T00:00:00Z", detail: { rollupSliceId: "s1", rollupGenerated: "2025-01-01T00:00:00Z", ingestedGenerated: null } }]);
});

test('missing scannerDelta adds a notMeasured entry', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.notMeasured, [{ signal: "new-since-last-sweep", reason: "this rollup carries no scannerDelta" }, { signal: "sla-due-soon", reason: "SLA days per severity are not configured yet (worklist task 7)" }]);
});

test('scannerDelta without byCategory adds a notMeasured entry', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: { comparable: true }, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.notMeasured, [{ signal: "new-since-last-sweep", reason: "this rollup carries no scannerDelta" }, { signal: "sla-due-soon", reason: "SLA days per severity are not configured yet (worklist task 7)" }]);
});

test('non-compared category is skipped and no items are produced', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: { comparable: true, byCategory: { a: { status: 'pending' } } }, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.items, [{ id: "ingest-behind|p|slice:s1", kind: "ingest-behind", project: "p", priority: false, title: "Work items were never ingested for this area", at: "2025-01-01T00:00:00Z", detail: { rollupSliceId: "s1", rollupGenerated: "2025-01-01T00:00:00Z", ingestedGenerated: null } }]);
});

test('compared category with zero crit and no beyond produces no items', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: { comparable: true, byCategory: { a: { status: 'compared', newPlaces: [], truncated: null, newBySev: { crit: 0 } } } }, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.items, [{ id: "ingest-behind|p|slice:s1", kind: "ingest-behind", project: "p", priority: false, title: "Work items were never ingested for this area", at: "2025-01-01T00:00:00Z", detail: { rollupSliceId: "s1", rollupGenerated: "2025-01-01T00:00:00Z", ingestedGenerated: null } }]);
});

test('compared category with crit findings produces a new-critical item', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: { comparable: true, byCategory: { a: { status: 'compared', newPlaces: [{ repo: 'r', sev: 'crit' }], truncated: null, newBySev: { crit: 1 } } } }, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.items, [{ id: "new-critical|p|a|s1", kind: "new-critical", project: "p", priority: true, title: "1 new critical place(s) in a", at: "2025-01-01T00:00:00Z", detail: { lane: "a", count: 1, places: [{ repo: "r", sev: "crit" }], beyondCap: 0 } }, { id: "ingest-behind|p|slice:s1", kind: "ingest-behind", project: "p", priority: false, title: "Work items were never ingested for this area", at: "2025-01-01T00:00:00Z", detail: { rollupSliceId: "s1", rollupGenerated: "2025-01-01T00:00:00Z", ingestedGenerated: null } }]);
});

test('compared category with beyond cap adds a notMeasured entry', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: { comparable: true, byCategory: { a: { status: 'compared', newPlaces: [], truncated: { newPlaces: 3 }, newBySev: { crit: 0 } } } }, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.notMeasured, [{ signal: "sla-due-soon", reason: "SLA days per severity are not configured yet (worklist task 7)" }]);
});

test('scanner with unknown coverage produces a lane-undetermined item', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: { a: { coverage: 'unknown', coverageReason: 'x' } } }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.items, [{ id: "lane-undetermined|p|a|x", kind: "lane-undetermined", project: "p", priority: false, title: "a: coverage is undetermined in this sweep", at: "2025-01-01T00:00:00Z", detail: { lane: "a", reason: "x", coverageChecks: null } }, { id: "ingest-behind|p|slice:s1", kind: "ingest-behind", project: "p", priority: false, title: "Work items were never ingested for this area", at: "2025-01-01T00:00:00Z", detail: { rollupSliceId: "s1", rollupGenerated: "2025-01-01T00:00:00Z", ingestedGenerated: null } }]);
});

test('scanner with unknown coverage and long reason truncates to 300 chars', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: { a: { coverage: 'unknown', coverageReason: 'x'.repeat(350) } } }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.equal(r.items[0].detail.reason, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});

test('ingestError adds a notMeasured entry', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: 'boom' });
  assert.deepEqual(r.notMeasured, [{ signal: "new-since-last-sweep", reason: "this rollup carries no scannerDelta" }, { signal: "ingest-behind", reason: "issue store unreadable: boom" }, { signal: "sla-due-soon", reason: "SLA days per severity are not configured yet (worklist task 7)" }]);
});

test('generated after lastIngest produces an ingest-behind item', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-02T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: { generated: '2025-01-01T00:00:00Z' }, ingestError: null });
  assert.deepEqual(r.items, [{ id: "ingest-behind|p|slice:s1", kind: "ingest-behind", project: "p", priority: false, title: "Work items are behind: last ingested 2025-01-01T00:00:00Z, rollup 2025-01-02T00:00:00Z", at: "2025-01-02T00:00:00Z", detail: { rollupSliceId: "s1", rollupGenerated: "2025-01-02T00:00:00Z", ingestedGenerated: "2025-01-01T00:00:00Z" } }]);
});

test('generated equal to lastIngest produces no ingest-behind item', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: { generated: '2025-01-01T00:00:00Z' }, ingestError: null });
  assert.deepEqual(r.items, []);
});

test('generated before lastIngest produces no ingest-behind item', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: { generated: '2025-01-02T00:00:00Z' }, ingestError: null });
  assert.deepEqual(r.items, []);
});

test('no generated time adds a notMeasured entry', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: null, scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: null, ingestError: null });
  assert.deepEqual(r.notMeasured, [{ signal: "new-since-last-sweep", reason: "this rollup carries no scannerDelta" }, { signal: "ingest-behind", reason: "the rollup has no generated time to compare against" }, { signal: "sla-due-soon", reason: "SLA days per severity are not configured yet (worklist task 7)" }]);
});

test('always appends sla-due-soon to notMeasured', () => {
  const r = deriveInbox({ project: 'p', rollup: { sliceId: 's1', generated: '2025-01-01T00:00:00Z', scannerDelta: null, scanners: {} }, inflight: { verdict: 'ok' }, lastIngest: { generated: '2025-01-01T00:00:00Z' }, ingestError: null });
  assert.deepEqual(r.notMeasured, [{ signal: "new-since-last-sweep", reason: "this rollup carries no scannerDelta" }, { signal: "sla-due-soon", reason: "SLA days per severity are not configured yet (worklist task 7)" }]);
});
