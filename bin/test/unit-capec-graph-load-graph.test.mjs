// Loads the CAPEC graph JSON from disk, returning an empty graph when the file is missing. (bin/capec-graph.mjs loadGraph).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGraph } from '../capec-graph.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty graph when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'missing.json');
    assert.deepEqual(loadGraph(p), { patterns: {}, byCwe: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when the file contains a valid graph', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'g.json');
    writeFileSync(p, JSON.stringify({ patterns: { a: 1 }, byCwe: { c: 2 } }));
    assert.deepEqual(loadGraph(p), { patterns: { a: 1 }, byCwe: { c: 2 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'n.json');
    writeFileSync(p, 'null');
    assert.throws(() => loadGraph(p), new Error(`capec graph at ${p} has no patterns map`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 's.json');
    writeFileSync(p, '"hello"');
    assert.throws(() => loadGraph(p), new Error(`capec graph at ${p} has no patterns map`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'num.json');
    writeFileSync(p, '42');
    assert.throws(() => loadGraph(p), new Error(`capec graph at ${p} has no patterns map`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains a boolean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, 'true');
    assert.throws(() => loadGraph(p), new Error(`capec graph at ${p} has no patterns map`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains an empty object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'e.json');
    writeFileSync(p, '{}');
    assert.throws(() => loadGraph(p), new Error(`capec graph at ${p} has no patterns map`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains an object with a string patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'sp.json');
    writeFileSync(p, JSON.stringify({ patterns: 'x' }));
    assert.throws(() => loadGraph(p), new Error(`capec graph at ${p} has no patterns map`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains an object with a number patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'np.json');
    writeFileSync(p, JSON.stringify({ patterns: 5 }));
    assert.throws(() => loadGraph(p), new Error(`capec graph at ${p} has no patterns map`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains an object with a null patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'np2.json');
    writeFileSync(p, JSON.stringify({ patterns: null }));
    assert.throws(() => loadGraph(p), new Error(`capec graph at ${p} has no patterns map`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
