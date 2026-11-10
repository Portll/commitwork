// Reads a JSON-lines trace file and reports whether the preload hook ran and witnessed itself. (flow/runtime.mjs readTrace).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTrace } from '../runtime.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent state when the trace file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTrace-'));
  try {
    const r = readTrace(join(dir, 'missing.json'));
    assert.deepEqual(r, { state: "absent", rows: [], reason: "no trace file" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unusable state with EACCES reason when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTrace-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    const r = readTrace(sub);
    assert.deepEqual(r, { state: "unusable", rows: [], reason: "trace unreadable: EISDIR" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unusable state when no installed row is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTrace-'));
  try {
    const p = join(dir, 'trace.json');
    writeFileSync(p, JSON.stringify({ t: 'other' }) + '\n');
    const r = readTrace(p);
    assert.deepEqual(r, { state: "unusable", rows: [{ t: "other" }], reason: "no installed row \u2014 the preload never ran" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unusable state when installed row lacks selfWitness', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTrace-'));
  try {
    const p = join(dir, 'trace.json');
    writeFileSync(p, JSON.stringify({ t: 'installed', node: 'v22', pid: 1 }) + '\n');
    const r = readTrace(p);
    assert.deepEqual(r, { state: "unusable", rows: [{ t: "installed", node: "v22", pid: 1 }], reason: "hook could not witness its own read \u2014 patch is inert" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns usable state with node and pid when installed row has selfWitness', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTrace-'));
  try {
    const p = join(dir, 'trace.json');
    writeFileSync(p, JSON.stringify({ t: 'installed', selfWitness: true, node: 'v22.0.0', pid: 42 }) + '\n');
    const r = readTrace(p);
    assert.deepEqual(r, { state: "usable", rows: [{ t: "installed", selfWitness: true, node: "v22.0.0", pid: 42 }], reason: null, malformed: 0, node: "v22.0.0", pid: 42 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts malformed lines when a line is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTrace-'));
  try {
    const p = join(dir, 'trace.json');
    writeFileSync(p, JSON.stringify({ t: 'installed', selfWitness: true, node: 'v22', pid: 7 }) + '\nnot-json\n');
    const r = readTrace(p);
    assert.deepEqual(r, { state: "usable", rows: [{ t: "installed", selfWitness: true, node: "v22", pid: 7 }], reason: null, malformed: 1, node: "v22", pid: 7 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips empty lines and parses valid JSON lines correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTrace-'));
  try {
    const p = join(dir, 'trace.json');
    const lines = [JSON.stringify({ t: 'installed', selfWitness: true, node: 'v22', pid: 99 }), '', JSON.stringify({ t: 'other' })];
    writeFileSync(p, lines.join('\n') + '\n');
    const r = readTrace(p);
    assert.deepEqual(r, { state: "usable", rows: [{ t: "installed", selfWitness: true, node: "v22", pid: 99 }, { t: "other" }], reason: null, malformed: 0, node: "v22", pid: 99 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unusable state with EACCES reason when file is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readTrace-'));
  try {
    const p = join(dir, 'trace.json');
    writeFileSync(p, 'x');
    const r = readTrace(join(dir, 'sub', 'trace.json'));
    assert.deepEqual(r, { state: "absent", rows: [], reason: "no trace file" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
