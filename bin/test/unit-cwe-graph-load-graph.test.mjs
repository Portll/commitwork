// Loads and validates the CWE graph JSON file (bin/cwe-graph.mjs loadGraph).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGraph } from '../cwe-graph.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty graph when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'missing.json');
    const r = loadGraph(p);
    assert.deepEqual(r, { cwes: {}, categories: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed object when file has valid cwes map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'valid.json');
    writeFileSync(p, JSON.stringify({ cwes: { C1: 'x' }, categories: { A: 'y' } }));
    const r = loadGraph(p);
    assert.deepEqual(r, { cwes: { C1: "x" }, categories: { A: "y" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file has no cwes property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'nocwes.json');
    writeFileSync(p, JSON.stringify({ categories: { A: 'y' } }));
    assert.throws(() => loadGraph(p), { name: 'Error', message: `cwe graph at ${p} has no cwes map` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when cwes is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'nullcwes.json');
    writeFileSync(p, JSON.stringify({ cwes: null }));
    assert.throws(() => loadGraph(p), { name: 'Error', message: `cwe graph at ${p} has no cwes map` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when cwes is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'strcwes.json');
    writeFileSync(p, JSON.stringify({ cwes: 'not-an-object' }));
    assert.throws(() => loadGraph(p), { name: 'Error', message: `cwe graph at ${p} has no cwes map` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file contains null JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadGraph-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    assert.throws(() => loadGraph(p), { name: 'Error', message: `cwe graph at ${p} has no cwes map` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
