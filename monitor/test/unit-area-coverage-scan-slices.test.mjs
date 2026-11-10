// Computes a list of rollup-sweep slice files and their parsed contents (monitor/area-coverage.mjs scanSlices).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSlices } from '../area-coverage.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent when the directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSlices-'));
  try {
    assert.deepEqual(scanSlices(join(dir, 'nope')), { ok: false, reason: "absent" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable when the directory cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSlices-'));
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'x'), 'x');
    assert.deepEqual(scanSlices(join(dir, 'sub', 'x')), { ok: false, reason: "unreadable", detail: "ENOTDIR" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with empty slices and unreadable for an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSlices-'));
  try {
    assert.deepEqual(scanSlices(dir), { ok: true, slices: [], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses a valid slice file into the slices array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSlices-'));
  try {
    writeFileSync(join(dir, 'rollup-sweep-a.json'), JSON.stringify({ sliceId: 's1', generated: 'g1', repos: [{ name: 'r1' }, { name: 'r2' }] }));
    assert.deepEqual(scanSlices(dir), { ok: true, slices: [{ file: "rollup-sweep-a.json", sliceId: "s1", generated: "g1", repos: ["r1", "r2"] }], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records an unparseable slice file in the unreadable array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSlices-'));
  try {
    writeFileSync(join(dir, 'rollup-sweep-bad.json'), 'not json');
    assert.deepEqual(scanSlices(dir), { ok: true, slices: [], unreadable: [{ file: "rollup-sweep-bad.json", reason: "unparseable" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores files that do not match the rollup-sweep pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSlices-'));
  try {
    writeFileSync(join(dir, 'other.json'), '{}');
    writeFileSync(join(dir, 'rollup-sweep-x.txt'), '{}');
    assert.deepEqual(scanSlices(dir), { ok: true, slices: [], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a slice file with missing optional fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSlices-'));
  try {
    writeFileSync(join(dir, 'rollup-sweep-min.json'), JSON.stringify({}));
    assert.deepEqual(scanSlices(dir), { ok: true, slices: [{ file: "rollup-sweep-min.json", sliceId: null, generated: null, repos: [] }], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a slice file whose repos field is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSlices-'));
  try {
    writeFileSync(join(dir, 'rollup-sweep-norepos.json'), JSON.stringify({ sliceId: 's2', generated: 'g2', repos: 'nope' }));
    assert.deepEqual(scanSlices(dir), { ok: true, slices: [{ file: "rollup-sweep-norepos.json", sliceId: "s2", generated: "g2", repos: [] }], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
