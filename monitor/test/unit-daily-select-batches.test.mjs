// Selects the two most recent complete sweep batches for an area (monitor/daily.mjs selectBatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBatches } from '../daily.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns nulls when no batch directories exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when directory does not match area', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-otherarea');
    mkdirSync(dir);
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify({ rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } }));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ group: 'all', scope: { repos: [{ name: 'repo1' }] } }));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when verdict file is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ group: 'all', scope: { repos: [{ name: 'repo1' }] } }));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when verdict rollup is not published', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify({ rollup: 'failed', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } }));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ group: 'all', scope: { repos: [{ name: 'repo1' }] } }));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when resolved is zero', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify({ rollup: 'published', repos: { resolved: 0, scanned: 0, scans: [] } }));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ group: 'all', scope: { repos: [{ name: 'repo1' }] } }));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when scanned does not equal resolved', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify({ rollup: 'published', repos: { resolved: 2, scanned: 1, scans: [{ ran: true }] } }));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ group: 'all', scope: { repos: [{ name: 'repo1' }] } }));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when a scan did not run', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify({ rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: false }] } }));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ group: 'all', scope: { repos: [{ name: 'repo1' }] } }));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when manifest group does not match', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify({ rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } }));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ group: 'other', scope: { repos: [{ name: 'repo1' }] } }));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when a member is not in manifest scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify({ rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } }));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ group: 'all', scope: { repos: [{ name: 'repo1' }] } }));
    const result = selectBatches(root, 'area1', ['repo1', 'repo2']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns current batch when one complete batch exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    const verdict = { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } };
    const manifest = { group: 'all', scope: { repos: [{ name: 'repo1' }] } };
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify(verdict));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify(manifest));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.equal(result.current.sliceId, 'sweep-20240101000000');
    assert.equal(result.current.stamp, '20240101000000');
    assert.equal(result.current.dir, dir);
    assert.deepEqual(result.current.manifest, manifest);
    assert.deepEqual(result.current.verdict, verdict);
    assert.equal(result.previous, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns current and previous when two complete batches exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir1 = join(root, 'sweep-20240102000000-area1');
    const dir2 = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir1);
    mkdirSync(dir2);
    const verdict = { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } };
    const manifest = { group: 'all', scope: { repos: [{ name: 'repo1' }] } };
    writeFileSync(join(dir1, 'batch-verdict.json'), JSON.stringify(verdict));
    writeFileSync(join(dir1, 'batch-manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dir2, 'batch-verdict.json'), JSON.stringify(verdict));
    writeFileSync(join(dir2, 'batch-manifest.json'), JSON.stringify(manifest));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.equal(result.current.sliceId, 'sweep-20240102000000');
    assert.equal(result.previous.sliceId, 'sweep-20240101000000');
    assert.equal(result.current.dir, dir1);
    assert.equal(result.previous.dir, dir2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips inflight batch and returns next complete batch as current', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir1 = join(root, 'sweep-20240102000000-area1');
    const dir2 = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir1);
    mkdirSync(dir2);
    const verdict = { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } };
    const manifest = { group: 'all', scope: { repos: [{ name: 'repo1' }] } };
    writeFileSync(join(dir1, 'batch-verdict.json'), JSON.stringify(verdict));
    writeFileSync(join(dir1, 'batch-manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dir2, 'batch-verdict.json'), JSON.stringify(verdict));
    writeFileSync(join(dir2, 'batch-manifest.json'), JSON.stringify(manifest));
    const result = selectBatches(root, 'area1', ['repo1'], { inflight: 'sweep-20240102000000' });
    assert.equal(result.current.sliceId, 'sweep-20240101000000');
    assert.equal(result.previous, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when inflight is the only complete batch', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    const verdict = { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } };
    const manifest = { group: 'all', scope: { repos: [{ name: 'repo1' }] } };
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify(verdict));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify(manifest));
    const result = selectBatches(root, 'area1', ['repo1'], { inflight: 'sweep-20240101000000' });
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns nulls when manifest has only flag set', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    const verdict = { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } };
    const manifest = { only: true, group: 'all', scope: { repos: [{ name: 'repo1' }] } };
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify(verdict));
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify(manifest));
    const result = selectBatches(root, 'area1', ['repo1']);
    assert.deepEqual(result, { current: null, previous: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('throws when manifest is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    const dir = join(root, 'sweep-20240101000000-area1');
    mkdirSync(dir);
    const verdict = { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } };
    writeFileSync(join(dir, 'batch-verdict.json'), JSON.stringify(verdict));
    assert.throws(() => selectBatches(root, 'area1', ['repo1']), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
