// codegraph/test/report-units.test.mjs — case tests for formatBuild, readerFor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatBuild, readerFor } from '../report.mjs';

test('formatBuild: minimal graph with no partials, unreadable, or divergence', () => {
  const graph = {
    source: 'worktree',
    files: { input: 10, partial: [] },
    nodes: [1, 2, 3],
    edges: [1, 2],
    summary: {
      analysed: 8,
      partial: 1,
      unreadable: 0,
      unreadableByReason: {},
      nodesByKind: { fn: 3 },
      edgesByKind: { import: 2 },
      edgesByExistence: { static: 2 },
      divergence: {
        filesCompared: 8,
        falsePositive: [],
        falseNegative: [],
      },
      unresolved: {
        imports: [],
        calls: [],
        callsByReason: {},
        ambiguousCalls: [],
      },
    },
  };
  const out = formatBuild(graph);
  assert.ok(out.includes('population     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (worktree)'));
  assert.ok(out.includes('graph          nodes 3 {"fn":3}'));
  assert.ok(out.includes('               edges 2 {"import":2}'));
  assert.ok(out.includes('               existence {"static":2}'));
  assert.ok(out.includes('               FALSE POSITIVE  0 file(s)'));
  assert.ok(out.includes('               FALSE NEGATIVE  0 file(s)'));
  assert.ok(out.includes('               agreed on 8/8 files'));
  assert.ok(out.includes('unresolved     imports 0  calls {}'));
  assert.ok(out.includes('               0 call name(s) resolve to nothing this can see (— of call sites)'));
  assert.ok(out.includes('               ambiguous 0'));
});

test('formatBuild: with unreadable files and reasons', () => {
  const graph = {
    source: 'HEAD',
    files: { input: 5, partial: [] },
    nodes: [],
    edges: [],
    summary: {
      analysed: 3,
      partial: 0,
      unreadable: 2,
      unreadableByReason: { ENOENT: ['a.mjs', 'b.mjs'] },
      nodesByKind: {},
      edgesByKind: {},
      edgesByExistence: {},
      divergence: { filesCompared: 3, falsePositive: [], falseNegative: [] },
      unresolved: { imports: [], calls: [], callsByReason: {}, ambiguousCalls: [] },
    },
  };
  const out = formatBuild(graph);
  assert.ok(out.includes('population     3 analysed + 0 partial + 2 unreadable = 5 tracked .mjs  (HEAD)'));
  assert.ok(out.includes('unreadable {"ENOENT":["a.mjs","b.mjs"]}'));
});

test('formatBuild: partial files are listed (up to 5)', () => {
  const graph = {
    source: 'worktree',
    files: { input: 10, partial: [
      { path: 'x.mjs', reason: 'parse error at line 1' },
      { path: 'y.mjs', reason: 'parse error at line 2' },
    ] },
    nodes: [],
    edges: [],
    summary: {
      analysed: 8,
      partial: 2,
      unreadable: 0,
      unreadableByReason: {},
      nodesByKind: {},
      edgesByKind: {},
      edgesByExistence: {},
      divergence: { filesCompared: 8, falsePositive: [], falseNegative: [] },
      unresolved: { imports: [], calls: [], callsByReason: {}, ambiguousCalls: [] },
    },
  };
  const out = formatBuild(graph);
  assert.ok(out.includes('partial  x.mjs  parse error at line 1'));
  assert.ok(out.includes('partial  y.mjs  parse error at line 2'));
});

test('formatBuild: false positive and negative entries are listed', () => {
  const graph = {
    source: 'worktree',
    files: { input: 10, partial: [] },
    nodes: [],
    edges: [],
    summary: {
      analysed: 8,
      partial: 0,
      unreadable: 0,
      unreadableByReason: {},
      nodesByKind: {},
      edgesByKind: {},
      edgesByExistence: {},
      divergence: {
        filesCompared: 8,
        falsePositive: [{ path: 'a.mjs', names: ['foo', 'bar'] }],
        falseNegative: [{ path: 'b.mjs', names: ['baz'] }],
      },
      unresolved: { imports: [], calls: [], callsByReason: {}, ambiguousCalls: [] },
    },
  };
  const out = formatBuild(graph);
  assert.ok(out.includes('FALSE POSITIVE  1 file(s)'));
  assert.ok(out.includes('a.mjs  foo bar'));
  assert.ok(out.includes('FALSE NEGATIVE  1 file(s)'));
  assert.ok(out.includes('b.mjs  baz'));
  assert.ok(out.includes('agreed on 6/8 files'));
});

test('formatBuild: unknown calls with sites and percentage', () => {
  const graph = {
    source: 'worktree',
    files: { input: 10, partial: [] },
    nodes: [],
    edges: [{ kind: 'calls' }],
    summary: {
      analysed: 8,
      partial: 0,
      unreadable: 0,
      unreadableByReason: {},
      nodesByKind: {},
      edgesByKind: {},
      edgesByExistence: {},
      divergence: { filesCompared: 8, falsePositive: [], falseNegative: [] },
      unresolved: {
        imports: [],
        calls: [{ why: 'unknown', name: 'foo', sites: 3, where: ['a.mjs', 'b.mjs'] }],
        callsByReason: { unknown: 1 },
        ambiguousCalls: [],
      },
    },
  };
  const out = formatBuild(graph);
  assert.ok(out.includes('unresolved     imports 0  calls {"unknown":1}'));
  assert.ok(out.includes('1 call name(s) resolve to nothing this can see (75.0% of call sites)'));
  assert.ok(out.includes('foo ×3  a.mjs b.mjs'));
});

test('formatBuild: ambiguous calls count', () => {
  const graph = {
    source: 'worktree',
    files: { input: 10, partial: [] },
    nodes: [],
    edges: [],
    summary: {
      analysed: 8,
      partial: 0,
      unreadable: 0,
      unreadableByReason: {},
      nodesByKind: {},
      edgesByKind: {},
      edgesByExistence: {},
      divergence: { filesCompared: 8, falsePositive: [], falseNegative: [] },
      unresolved: { imports: [], calls: [], callsByReason: {}, ambiguousCalls: [1, 2, 3] },
    },
  };
  const out = formatBuild(graph);
  assert.ok(out.includes('ambiguous 3'));
});

test('readerFor: worktree mode reads file from disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  try {
    writeFileSync(join(dir, 'a.mjs'), 'export const x = 1;');
    const reader = readerFor(dir, { head: false });
    assert.equal(reader('a.mjs'), 'export const x = 1;');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readerFor: worktree mode throws ENOENT for missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  try {
    const reader = readerFor(dir, { head: false });
    assert.throws(() => reader('nope.mjs'), (e) => e.code === 'ENOENT');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readerFor: head mode returns blob content from map', () => {
  const blobs = new Map([['a.mjs', 'export const y = 2;']]);
  const reader = readerFor('/fake', { head: true, blobs });
  assert.equal(reader('a.mjs'), 'export const y = 2;');
});

test('readerFor: head mode throws ENOENT when path not in blobs', () => {
  const blobs = new Map([['a.mjs', 'content']]);
  const reader = readerFor('/fake', { head: true, blobs });
  assert.throws(() => reader('missing.mjs'), (e) => e.code === 'ENOENT' && /no HEAD blob for missing\.mjs/.test(e.message));
});

test('readerFor: head mode with null blobs throws ENOENT for any path', () => {
  const reader = readerFor('/fake', { head: true, blobs: null });
  assert.throws(() => reader('anything.mjs'), (e) => e.code === 'ENOENT');
});

test('readerFor: head mode with empty blobs map throws ENOENT', () => {
  const reader = readerFor('/fake', { head: true, blobs: new Map() });
  assert.throws(() => reader('a.mjs'), (e) => e.code === 'ENOENT');
});
