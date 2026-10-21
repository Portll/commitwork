// monitor/test/worklist-reconcile-units.test.mjs — case tests for assembleReconcile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleReconcile } from '../worklist-reconcile.mjs';

test('empty worklist returns empty programs and zero summary', () => {
  const r = assembleReconcile({ programs: [] }, {});
  assert.deepEqual(r.programs, []);
  assert.deepEqual(r.summary, { agree: 0, mismatch: 0, unverifiable: 0, byProgram: {} });
});

test('prose-only program yields unverifiable with prose-only source', () => {
  const r = assembleReconcile(
    { programs: [{ key: 'cve-2026-10532', items: [{ id: 'a', status: 'done', evidence: '', title: '' }] }] },
    {}
  );
  const it = r.programs[0].items[0];
  assert.equal(it.verdict, 'unverifiable');
  assert.equal(it.derivedStatus, null);
  assert.equal(it.source, 'prose-only program (no machine anchor)');
  assert.equal(r.summary.unverifiable, 1);
});

test('resolver-backed program with no ctx yields unverifiable with no-machine-source', () => {
  const r = assembleReconcile(
    { programs: [{ key: 'infra-images', items: [{ id: 'x', status: 'open', evidence: '', title: '' }] }] },
    {}
  );
  const it = r.programs[0].items[0];
  assert.equal(it.verdict, 'unverifiable');
  assert.equal(it.source, 'no machine source resolved this item');
  assert.equal(r.summary.unverifiable, 1);
});

test('infra-images with CVE in fixed[] yields done and agree', () => {
  const r = assembleReconcile(
    { programs: [{ key: 'infra-images', items: [{ id: 'i1', status: 'done', evidence: '', title: 'CVE-2024-1234' }] }] },
    { imageAcceptance: { fixed: [{ cve: 'CVE-2024-1234' }] } }
  );
  const it = r.programs[0].items[0];
  assert.equal(it.derivedStatus, 'done');
  assert.equal(it.verdict, 'agree');
  assert.equal(it.source, 'image-acceptance: CVE-2024-1234 in fixed[]');
  assert.equal(r.summary.agree, 1);
});

test('infra-images with CVE only in fixableViaRebuild yields open and mismatch', () => {
  const r = assembleReconcile(
    { programs: [{ key: 'infra-images', items: [{ id: 'i2', status: 'done', evidence: '', title: 'CVE-2024-9999' }] }] },
    { imageAcceptance: { fixableViaRebuild: [{ cve: 'CVE-2024-9999' }] } }
  );
  const it = r.programs[0].items[0];
  assert.equal(it.derivedStatus, 'open');
  assert.equal(it.verdict, 'mismatch');
  assert.equal(r.summary.mismatch, 1);
});

test('modernization roster reached==target and not blocked yields done', () => {
  const r = assembleReconcile(
    { programs: [{ key: 'modernization', items: [{ id: 'm1', status: 'done', evidence: '', title: 'svc-alpha' }] }] },
    { migrationRoster: [{ id: 'svc-alpha', reachedEra: 'v2', targetEra: 'v2', blocked: false }] }
  );
  const it = r.programs[0].items[0];
  assert.equal(it.derivedStatus, 'done');
  assert.equal(it.verdict, 'agree');
  assert.equal(it.source, 'migration-state: svc-alpha reached=v2 target=v2 blocked=false');
});

test('modernization roster blocked yields gated', () => {
  const r = assembleReconcile(
    { programs: [{ key: 'modernization', items: [{ id: 'm2', status: 'open', evidence: '', title: 'svc-beta' }] }] },
    { migrationRoster: [{ id: 'svc-beta', reachedEra: 'v1', targetEra: 'v2', blocked: true }] }
  );
  const it = r.programs[0].items[0];
  assert.equal(it.derivedStatus, 'gated');
  assert.equal(it.verdict, 'mismatch');
});

test('summary aggregates across multiple programs', () => {
  const r = assembleReconcile(
    {
      programs: [
        { key: 'infra-images', items: [{ id: 'a', status: 'done', evidence: '', title: 'CVE-2024-1111' }] },
        { key: 'cve-2026-10532', items: [{ id: 'b', status: 'open', evidence: '', title: '' }] },
      ],
    },
    { imageAcceptance: { fixed: [{ cve: 'CVE-2024-1111' }] } }
  );
  assert.equal(r.summary.agree, 1);
  assert.equal(r.summary.unverifiable, 1);
  assert.equal(r.summary.mismatch, 0);
  assert.deepEqual(r.summary.byProgram['infra-images'], { agree: 1, mismatch: 0, unverifiable: 0 });
  assert.deepEqual(r.summary.byProgram['cve-2026-10532'], { agree: 0, mismatch: 0, unverifiable: 1 });
});
