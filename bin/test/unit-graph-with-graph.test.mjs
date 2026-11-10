// Graph store edition metadata merged with a callback's result over the open store (bin/graph.mjs withGraph).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withGraph } from '../graph.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const metaOf = (db) => Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
const header = (file) => readFileSync(file).subarray(0, 16).toString('latin1');

test('returns the stored edition metadata with the fingerprint cut to its first twelve characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withGraph-'));
  try {
    const file = join(dir, 'graph.db');
    const r = withGraph((db) => ({ meta: metaOf(db) }), { file });
    const m = r.meta;
    assert.equal(r.graph.fingerprint, m.fingerprint.slice(0, 12));
    assert.deepEqual(r, {
      graph: { generated: m.generated, fingerprint: m.fingerprint.slice(0, 12), rebuilt: true, status: JSON.parse(m.status) },
      meta: m,
    });
    assert.equal(m.version, '1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports rebuilt as true and writes a SQLite file when the store does not exist yet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withGraph-'));
  try {
    const file = join(dir, 'nested', 'deep', 'graph.db');
    const r = withGraph(() => ({}), { file });
    assert.equal(r.graph.rebuilt, true);
    assert.equal(header(file), 'SQLite format 3\0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports rebuilt as false and keeps the same edition when the store already matches the inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withGraph-'));
  try {
    const file = join(dir, 'graph.db');
    const r1 = withGraph(() => ({}), { file });
    const r2 = withGraph(() => ({}), { file });
    assert.equal(r1.graph.rebuilt, true);
    assert.equal(r2.graph.rebuilt, false);
    assert.deepEqual(r2.graph, { ...r1.graph, rebuilt: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rebuilds over a file that is not a database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withGraph-'));
  try {
    const file = join(dir, 'graph.db');
    writeFileSync(file, 'x'.repeat(1024));
    const r = withGraph((db) => ({ keys: Object.keys(metaOf(db)).sort() }), { file });
    assert.equal(r.graph.rebuilt, true);
    assert.deepEqual(r.keys, ['fingerprint', 'generated', 'status', 'version']);
    assert.equal(header(file), 'SQLite format 3\0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spreads the callback result after the graph key so a returned graph replaces it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withGraph-'));
  try {
    const file = join(dir, 'graph.db');
    const own = { generated: 'override', fingerprint: 'override', rebuilt: true, status: 'override' };
    const r = withGraph(() => ({ graph: own }), { file });
    assert.deepEqual(r, { graph: own });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes the open database to the callback and keeps its other keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withGraph-'));
  try {
    const file = join(dir, 'graph.db');
    const r = withGraph((db) => ({ count: 42, metaKeys: db.prepare('SELECT key FROM meta ORDER BY key').all().map((x) => x.key) }), { file });
    assert.equal(r.count, 42);
    assert.deepEqual(r.metaKeys, ['fingerprint', 'generated', 'status', 'version']);
    assert.deepEqual(Object.keys(r), ['graph', 'count', 'metaKeys']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns only the graph key when the callback returns null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withGraph-'));
  try {
    const file = join(dir, 'graph.db');
    const r = withGraph(() => null, { file });
    assert.deepEqual(Object.keys(r), ['graph']);
    assert.deepEqual(Object.keys(r.graph), ['generated', 'fingerprint', 'rebuilt', 'status']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('propagates an error thrown by the callback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withGraph-'));
  try {
    const file = join(dir, 'graph.db');
    assert.throws(() => withGraph(() => { throw new Error('boom'); }, { file }), { name: 'Error', message: 'boom' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
