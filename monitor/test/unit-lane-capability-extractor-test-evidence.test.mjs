// Maps declared lane fixtures to extractor witness evidence (monitor/lane-capability.mjs extractorTestEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractorTestEvidence } from '../lane-capability.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

test('returns read false when index file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    const r = extractorTestEvidence(idx, [['c', null, () => null]]);
    assert.deepEqual(r, { read: false, byCategory: {}, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns read true with empty byCategory when index has no fixtures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [] }));
    const r = extractorTestEvidence(idx, [['c', null, () => null]]);
    assert.deepEqual(r, { read: true, byCategory: {}, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pushes unknown category when extractor is not in specs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [{ category: 'missing', file: 'x.json', test: 't' }] }));
    const r = extractorTestEvidence(idx, [['c', null, () => null]]);
    assert.deepEqual(r, { read: true, byCategory: {}, unknown: ["missing"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no-fixture witness when fixture file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [{ category: 'c', file: 'ghost.json', test: 't' }] }));
    const r = extractorTestEvidence(idx, [['c', null, () => null]]);
    assert.deepEqual(r, { read: true, byCategory: { c: [{ test: "t", fixture: "ghost.json", witness: "no-fixture", note: "declared fixture file is missing", credits: false }] }, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns counting witness when extractor finds findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [{ category: 'c', file: 'data.json', test: 't' }] }));
    writeFileSync(join(dir, 'data.json'), '{}');
    const r = extractorTestEvidence(idx, [['c', null, () => ({ findings: [1] })]]);
    assert.deepEqual(r, { read: true, byCategory: { c: [{ test: "t", fixture: "data.json", witness: "counting", credits: true }] }, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero-on-golden witness when extractor returns clean zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [{ category: 'c', file: 'data.json', test: 't' }] }));
    writeFileSync(join(dir, 'data.json'), '{}');
    const r = extractorTestEvidence(idx, [['c', null, () => ({ total: 0, undetermined: 0, findings: [] })]]);
    assert.deepEqual(r, { read: true, byCategory: { c: [{ test: "t", fixture: "data.json", witness: "zero-on-golden", note: "a clean zero from a non-empty golden artifact \u2014 the F8 silent-green shape; fix the fixture or the parser before trusting this lane's zeros", credits: false }] }, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns shape-only witness when extractor returns unparseable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [{ category: 'c', file: 'data.json', test: 't' }] }));
    writeFileSync(join(dir, 'data.json'), '{}');
    const r = extractorTestEvidence(idx, [['c', null, () => ({ unparseable: true })]]);
    assert.deepEqual(r, { read: true, byCategory: { c: [{ test: "t", fixture: "data.json", witness: "shape-only", credits: false }] }, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no-fixture witness when extractor returns null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [{ category: 'c', file: 'data.json', test: 't' }] }));
    writeFileSync(join(dir, 'data.json'), '{}');
    const r = extractorTestEvidence(idx, [['c', null, () => null]]);
    assert.deepEqual(r, { read: true, byCategory: { c: [{ test: "t", fixture: "data.json", witness: "no-fixture", note: "fixture dir holds no artifact under the filename this extractor reads", credits: false }] }, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns extractor-threw witness when extractor throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [{ category: 'c', file: 'data.json', test: 't' }] }));
    writeFileSync(join(dir, 'data.json'), '{}');
    const r = extractorTestEvidence(idx, [['c', null, () => { throw new Error('boom'); }]]);
    assert.deepEqual(r, { read: true, byCategory: { c: [{ test: "t", fixture: "data.json", witness: "extractor-threw", note: "boom", credits: false }] }, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes exit file when fixture has exit code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractorTestEvidence-'));
  try {
    const idx = join(dir, 'INDEX.json');
    writeFileSync(idx, JSON.stringify({ fixtures: [{ category: 'c', file: 'data.json', test: 't', exit: 1 }] }));
    writeFileSync(join(dir, 'data.json'), '{}');
    const r = extractorTestEvidence(idx, [['c', null, () => ({ findings: [1] })]]);
    assert.deepEqual(r, { read: true, byCategory: { c: [{ test: "t", fixture: "data.json", witness: "counting", credits: true }] }, unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
