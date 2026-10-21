// docsite-versions.test.mjs — snapshot/list/read, pruning at the cap, and path confinement on the
// one place a caller-supplied string (a version id) becomes a filesystem path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CW_DOCSITE_ROOT = mkdtempSync(join(tmpdir(), 'cw-docsite-versions-'));
const { snapshotBeforeWrite, listVersions, readVersion, ORIGINS } = await import('../../lib/docsite-versions.mjs');

test('a first write has nothing to snapshot — null previous content is a no-op', () => {
  snapshotBeforeWrite('page-a', 'generated', null);
  assert.deepEqual(listVersions('page-a', 'generated'), []);
});

test('a snapshot is listed newest first, and its content round-trips', () => {
  snapshotBeforeWrite('page-b', 'editor-save', 'v1');
  snapshotBeforeWrite('page-b', 'editor-save', 'v2');
  const versions = listVersions('page-b', 'editor-save');
  assert.equal(versions.length, 2);
  // newest (the LAST snapshot taken, i.e. the content that was overwritten most recently) first
  assert.equal(readVersion('page-b', 'editor-save', versions[0].id).toString('utf8'), 'v2');
  assert.equal(readVersion('page-b', 'editor-save', versions[1].id).toString('utf8'), 'v1');
});

test('editor-save and generated are separate pools for the same key', () => {
  snapshotBeforeWrite('page-c', 'editor-save', 'source content');
  snapshotBeforeWrite('page-c', 'generated', 'rendered content');
  assert.equal(listVersions('page-c', 'editor-save').length, 1);
  assert.equal(listVersions('page-c', 'generated').length, 1);
  assert.equal(readVersion('page-c', 'editor-save', listVersions('page-c', 'editor-save')[0].id).toString('utf8'), 'source content');
  assert.equal(readVersion('page-c', 'generated', listVersions('page-c', 'generated')[0].id).toString('utf8'), 'rendered content');
});

test('a bad key is refused rather than becoming a path', () => {
  assert.throws(() => snapshotBeforeWrite('../escape', 'generated', 'x'), /bad key/);
  assert.throws(() => listVersions('../escape', 'generated'), /bad key/);
});

test('a bad origin is refused', () => {
  assert.throws(() => snapshotBeforeWrite('page-d', 'bogus', 'x'), /bad origin/);
});

test('readVersion refuses an id that does not match its own filename shape', () => {
  snapshotBeforeWrite('page-e', 'generated', 'x');
  assert.throws(() => readVersion('page-e', 'generated', '../../../etc/passwd'), /bad version id/);
  assert.throws(() => readVersion('page-e', 'generated', 'not-a-real-id.snapshot'), /bad version id/);
});

test('readVersion on a well-formed id that was never written fails closed, not silently empty', () => {
  assert.throws(() => readVersion('page-e', 'generated', '2026-01-01T00-00-00-000Z-000000-000000000000.snapshot'), /ENOENT|no such file/);
});

test('listVersions on a key/origin with no writes yet is empty, not an error', () => {
  assert.deepEqual(listVersions('never-written', 'generated'), []);
});

// Exercises the real cap (100) rather than a stand-in — pruning has to actually fire against the
// value ORIGINS declares, not a number chosen to make the test convenient.
test('pruning: only ORIGINS[origin] versions survive, oldest dropped first', () => {
  // No inter-write delay: the per-process seq counter (not wall-clock alone) is what guarantees
  // write order survives pruning even when many writes land in the same millisecond — this test
  // deliberately hammers that fast, rather than relying on real time passing between snapshots.
  const cap = ORIGINS['editor-save'];
  const N = cap + 5;
  for (let i = 0; i < N; i++) snapshotBeforeWrite('page-f', 'editor-save', `v${i}`);
  const versions = listVersions('page-f', 'editor-save');
  assert.equal(versions.length, cap);
  // newest-first, and the newest is the LAST one written; the oldest surviving is v5 (v0-v4 pruned)
  assert.equal(readVersion('page-f', 'editor-save', versions[0].id).toString('utf8'), `v${N - 1}`);
  assert.equal(readVersion('page-f', 'editor-save', versions[versions.length - 1].id).toString('utf8'), `v${N - cap}`);
});

process.on('exit', () => { try { rmSync(process.env.CW_DOCSITE_ROOT, { recursive: true, force: true }); } catch { /* best effort */ } });
