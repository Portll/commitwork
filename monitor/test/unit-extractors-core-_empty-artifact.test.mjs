// Computes whether a tool produced an empty artifact due to failure or missing source (monitor/extractors/core.mjs _emptyArtifact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _emptyArtifact } from '../extractors/core.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns zero counts with nosrc when exit file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_emptyArtifact-'));
  try {
    const p = join(dir, 'artifact');
    const result = _emptyArtifact(p);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with nosrc when exit is 0', () => {
  const dir = mkdtempSync(join(tmpdir(), '_emptyArtifact-'));
  try {
    const p = join(dir, 'artifact');
    writeFileSync(`${p}.exit`, '0');
    const result = _emptyArtifact(p);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with nosrc when exit is 1', () => {
  const dir = mkdtempSync(join(tmpdir(), '_emptyArtifact-'));
  try {
    const p = join(dir, 'artifact');
    writeFileSync(`${p}.exit`, '1');
    const result = _emptyArtifact(p);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with toolfailed when exit is 2', () => {
  const dir = mkdtempSync(join(tmpdir(), '_emptyArtifact-'));
  try {
    const p = join(dir, 'artifact');
    writeFileSync(`${p}.exit`, '2');
    const result = _emptyArtifact(p);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with toolfailed when exit is 127', () => {
  const dir = mkdtempSync(join(tmpdir(), '_emptyArtifact-'));
  try {
    const p = join(dir, 'artifact');
    writeFileSync(`${p}.exit`, '127');
    const result = _emptyArtifact(p);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with nosrc when exit file contains non-numeric text', () => {
  const dir = mkdtempSync(join(tmpdir(), '_emptyArtifact-'));
  try {
    const p = join(dir, 'artifact');
    writeFileSync(`${p}.exit`, 'not-a-number');
    const result = _emptyArtifact(p);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with nosrc when exit file contains whitespace around 0', () => {
  const dir = mkdtempSync(join(tmpdir(), '_emptyArtifact-'));
  try {
    const p = join(dir, 'artifact');
    writeFileSync(`${p}.exit`, '  0  ');
    const result = _emptyArtifact(p);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with toolfailed when exit file contains whitespace around 3', () => {
  const dir = mkdtempSync(join(tmpdir(), '_emptyArtifact-'));
  try {
    const p = join(dir, 'artifact');
    writeFileSync(`${p}.exit`, '  3  ');
    const result = _emptyArtifact(p);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
