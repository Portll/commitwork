// Reconciles authored worklist statuses against machine-derived verdicts (monitor/worklist-reconcile.mjs assembleReconcile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleReconcile } from '../worklist-reconcile.mjs';

test('empty worklist returns zeroed summary and empty programs', () => {
  assert.deepEqual(assembleReconcile({ programs: [] }), { programs: [], summary: { agree: 0, mismatch: 0, unverifiable: 0, byProgram: {} } });
});

test('prose-only program item is unverifiable with prose source', () => {
  const wl = { programs: [{ key: 'cve-2026-10532', items: [{ id: 'a1', status: 'open', title: 't', evidence: 'e' }] }] };
  assert.deepEqual(assembleReconcile(wl), { programs: [{ key: "cve-2026-10532", items: [{ id: "a1", authoredStatus: "open", derivedStatus: null, verdict: "unverifiable", source: "prose-only program (no machine anchor)" }] }], summary: { agree: 0, mismatch: 0, unverifiable: 1, byProgram: { "cve-2026-10532": { agree: 0, mismatch: 0, unverifiable: 1 } } } });
});

test('unknown program key item is unverifiable with no machine source', () => {
  const wl = { programs: [{ key: 'unknown-key', items: [{ id: 'b1', status: 'done', title: 't', evidence: 'e' }] }] };
  assert.deepEqual(assembleReconcile(wl), { programs: [{ key: "unknown-key", items: [{ id: "b1", authoredStatus: "done", derivedStatus: null, verdict: "unverifiable", source: "no machine source resolved this item" }] }], summary: { agree: 0, mismatch: 0, unverifiable: 1, byProgram: { "unknown-key": { agree: 0, mismatch: 0, unverifiable: 1 } } } });
});

test('modernization item with matching roster and reached era agrees done', () => {
  const wl = { programs: [{ key: 'modernization', items: [{ id: 'm1', status: 'done', title: 'svc-x', evidence: 'e' }] }] };
  const ctx = { migrationRoster: [{ id: 'svc-x', reachedEra: 'v2', targetEra: 'v2', blocked: false }] };
  assert.deepEqual(assembleReconcile(wl, ctx), { programs: [{ key: "modernization", items: [{ id: "m1", authoredStatus: "done", derivedStatus: "done", verdict: "agree", source: "migration-state: svc-x reached=v2 target=v2 blocked=false" }] }], summary: { agree: 1, mismatch: 0, unverifiable: 0, byProgram: { modernization: { agree: 1, mismatch: 0, unverifiable: 0 } } } });
});

test('modernization item with blocked service mismatches to gated', () => {
  const wl = { programs: [{ key: 'modernization', items: [{ id: 'm2', status: 'open', title: 'svc-y', evidence: 'e' }] }] };
  const ctx = { migrationRoster: [{ id: 'svc-y', reachedEra: 'v1', targetEra: 'v2', blocked: true }] };
  assert.deepEqual(assembleReconcile(wl, ctx), { programs: [{ key: "modernization", items: [{ id: "m2", authoredStatus: "open", derivedStatus: "gated", verdict: "mismatch", source: "migration-state: svc-y reached=v1 target=v2 blocked=true" }] }], summary: { agree: 0, mismatch: 1, unverifiable: 0, byProgram: { modernization: { agree: 0, mismatch: 1, unverifiable: 0 } } } });
});

test('infra-images item with CVE in fixed agrees done', () => {
  const wl = { programs: [{ key: 'infra-images', items: [{ id: 'i1', status: 'done', title: 'CVE-2025-1234 fix', evidence: 'e' }] }] };
  const ctx = { imageAcceptance: { fixed: [{ cve: 'CVE-2025-1234' }], accepted: [], fixableViaRebuild: [] } };
  assert.deepEqual(assembleReconcile(wl, ctx), { programs: [{ key: "infra-images", items: [{ id: "i1", authoredStatus: "done", derivedStatus: "done", verdict: "agree", source: "image-acceptance: CVE-2025-1234 in fixed[]" }] }], summary: { agree: 1, mismatch: 0, unverifiable: 0, byProgram: { "infra-images": { agree: 1, mismatch: 0, unverifiable: 0 } } } });
});

test('infra-images item with CVE only in fixableViaRebuild mismatches to open', () => {
  const wl = { programs: [{ key: 'infra-images', items: [{ id: 'i2', status: 'done', title: 'CVE-2025-5678 fix', evidence: 'e' }] }] };
  const ctx = { imageAcceptance: { fixed: [], accepted: [], fixableViaRebuild: [{ cve: 'CVE-2025-5678' }] } };
  assert.deepEqual(assembleReconcile(wl, ctx), { programs: [{ key: "infra-images", items: [{ id: "i2", authoredStatus: "done", derivedStatus: "open", verdict: "mismatch", source: "image-acceptance: CVE-2025-5678 only in fixableViaRebuild[]" }] }], summary: { agree: 0, mismatch: 1, unverifiable: 0, byProgram: { "infra-images": { agree: 0, mismatch: 1, unverifiable: 0 } } } });
});

test('commitwork-coverage item with no evidence is unverifiable', () => {
  const wl = { programs: [{ key: 'commitwork-coverage', items: [{ id: 'c1', status: 'open', title: 't', evidence: '' }] }] };
  assert.deepEqual(assembleReconcile(wl, {}), { programs: [{ key: "commitwork-coverage", items: [{ id: "c1", authoredStatus: "open", derivedStatus: null, verdict: "unverifiable", source: "no machine source resolved this item" }] }], summary: { agree: 0, mismatch: 0, unverifiable: 1, byProgram: { "commitwork-coverage": { agree: 0, mismatch: 0, unverifiable: 1 } } } });
});

test('worklist without programs key returns zeroed summary', () => {
  assert.deepEqual(assembleReconcile({}), { programs: [], summary: { agree: 0, mismatch: 0, unverifiable: 0, byProgram: {} } });
});

test('program without items key returns zeroed per-program counts', () => {
  const wl = { programs: [{ key: 'modernization' }] };
  assert.deepEqual(assembleReconcile(wl, {}), { programs: [{ key: "modernization", items: [] }], summary: { agree: 0, mismatch: 0, unverifiable: 0, byProgram: { modernization: { agree: 0, mismatch: 0, unverifiable: 0 } } } });
});
