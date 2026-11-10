// Compares output files between a hit and a check directory (bin/lib/lane-reuse.mjs compareOutputs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareOutputs } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns match true when both files are absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compareOutputs-'));
  try {
    const reportDir = join(dir, 'report');
    const hitDir = join(dir, 'hit');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(hitDir, { recursive: true });
    const r = compareOutputs({ dir: hitDir }, { reuse: { outputs: ['data.txt'] } }, reportDir);
    assert.deepEqual(r, { match: true, differing: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns match false when one file is absent and the other exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compareOutputs-'));
  try {
    const reportDir = join(dir, 'report');
    const hitDir = join(dir, 'hit');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(hitDir, { recursive: true });
    writeFileSync(join(hitDir, 'data.txt'), 'content');
    const r = compareOutputs({ dir: hitDir }, { reuse: { outputs: ['data.txt'] } }, reportDir);
    assert.deepEqual(r, { match: false, differing: ["data.txt"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns match true when both files have identical content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compareOutputs-'));
  try {
    const reportDir = join(dir, 'report');
    const hitDir = join(dir, 'hit');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(hitDir, { recursive: true });
    writeFileSync(join(reportDir, 'data.txt'), 'same');
    writeFileSync(join(hitDir, 'data.txt'), 'same');
    const r = compareOutputs({ dir: hitDir }, { reuse: { outputs: ['data.txt'] } }, reportDir);
    assert.deepEqual(r, { match: true, differing: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns match false when both files have different content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compareOutputs-'));
  try {
    const reportDir = join(dir, 'report');
    const hitDir = join(dir, 'hit');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(hitDir, { recursive: true });
    writeFileSync(join(reportDir, 'data.txt'), 'aaa');
    writeFileSync(join(hitDir, 'data.txt'), 'bbb');
    const r = compareOutputs({ dir: hitDir }, { reuse: { outputs: ['data.txt'] } }, reportDir);
    assert.deepEqual(r, { match: false, differing: ["data.txt"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns match true when sarif files have identical canonical results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compareOutputs-'));
  try {
    const reportDir = join(dir, 'report');
    const hitDir = join(dir, 'hit');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(hitDir, { recursive: true });
    const sarif = JSON.stringify({ runs: [] });
    writeFileSync(join(reportDir, 'out.sarif'), sarif);
    writeFileSync(join(hitDir, 'out.sarif'), sarif);
    const r = compareOutputs({ dir: hitDir }, { reuse: { outputs: ['out.sarif'] } }, reportDir);
    assert.deepEqual(r, { match: true, differing: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns match false when sarif files have different canonical results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compareOutputs-'));
  try {
    const reportDir = join(dir, 'report');
    const hitDir = join(dir, 'hit');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(hitDir, { recursive: true });
    writeFileSync(join(reportDir, 'out.sarif'), JSON.stringify({ runs: [{ results: [1] }] }));
    writeFileSync(join(hitDir, 'out.sarif'), JSON.stringify({ runs: [{ results: [2] }] }));
    const r = compareOutputs({ dir: hitDir }, { reuse: { outputs: ['out.sarif'] } }, reportDir);
    assert.deepEqual(r, { match: false, differing: ["out.sarif"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores log files in the comparison', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compareOutputs-'));
  try {
    const reportDir = join(dir, 'report');
    const hitDir = join(dir, 'hit');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(hitDir, { recursive: true });
    writeFileSync(join(reportDir, 'app.log'), 'log1');
    writeFileSync(join(hitDir, 'app.log'), 'log2');
    const r = compareOutputs({ dir: hitDir }, { reuse: { outputs: ['app.log'] } }, reportDir);
    assert.deepEqual(r, { match: true, differing: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns match true when no output files are specified', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compareOutputs-'));
  try {
    const reportDir = join(dir, 'report');
    const hitDir = join(dir, 'hit');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(hitDir, { recursive: true });
    const r = compareOutputs({ dir: hitDir }, { reuse: { outputs: [] } }, reportDir);
    assert.deepEqual(r, { match: true, differing: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
