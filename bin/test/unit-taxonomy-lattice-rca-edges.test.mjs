// Computes judged root-cause-analysis edges from a failure taxonomy JSON file (bin/taxonomy-lattice.mjs rcaEdges).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rcaEdges } from '../taxonomy-lattice.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the taxonomy has no classes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcaEdges-'));
  try {
    const p = join(dir, 't.json');
    writeFileSync(p, JSON.stringify({ classes: [] }));
    assert.deepEqual(rcaEdges(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when a class has no rca property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcaEdges-'));
  try {
    const p = join(dir, 't.json');
    writeFileSync(p, JSON.stringify({ classes: [{ id: 'a' }] }));
    assert.deepEqual(rcaEdges(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when a class has an empty rca array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcaEdges-'));
  try {
    const p = join(dir, 't.json');
    writeFileSync(p, JSON.stringify({ classes: [{ id: 'a', rca: [] }] }));
    assert.deepEqual(rcaEdges(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the only rca edge has an unjudged relation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcaEdges-'));
  try {
    const p = join(dir, 't.json');
    writeFileSync(p, JSON.stringify({ classes: [{ id: 'a', rca: [{ relation: 'causes', to: 'b' }] }] }));
    assert.deepEqual(rcaEdges(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns one edge for a class with a single judged rca relation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcaEdges-'));
  try {
    const p = join(dir, 't.json');
    writeFileSync(p, JSON.stringify({ classes: [{ id: 'a', rca: [{ relation: 'same-defect-as', to: 'b' }] }] }));
    assert.deepEqual(rcaEdges(p), [{ from: "a", relation: "same-defect-as", to: "b" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns edges for multiple classes and skips unjudged relations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcaEdges-'));
  try {
    const p = join(dir, 't.json');
    const t = {
      classes: [
        { id: 'a', rca: [{ relation: 'mechanism-of', to: 'b' }, { relation: 'causes', to: 'c' }] },
        { id: 'd', rca: [{ relation: 'enables', to: 'e' }] }
      ]
    };
    writeFileSync(p, JSON.stringify(t));
    assert.deepEqual(rcaEdges(p), [{ from: "a", relation: "mechanism-of", to: "b" }, { from: "d", relation: "enables", to: "e" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns all judged edges when every rca entry is judged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcaEdges-'));
  try {
    const p = join(dir, 't.json');
    const rels = ['same-defect-as', 'mechanism-of', 'enables', 'masks', 'awaits'];
    const t = { classes: [{ id: 'x', rca: rels.map((r, i) => ({ relation: r, to: 't' + i })) }] };
    writeFileSync(p, JSON.stringify(t));
    assert.deepEqual(rcaEdges(p), [{ from: "x", relation: "same-defect-as", to: "t0" }, { from: "x", relation: "mechanism-of", to: "t1" }, { from: "x", relation: "enables", to: "t2" }, { from: "x", relation: "masks", to: "t3" }, { from: "x", relation: "awaits", to: "t4" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
