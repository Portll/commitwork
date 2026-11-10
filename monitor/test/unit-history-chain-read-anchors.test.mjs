// The chain-tip anchors recorded for one area (monitor/history-chain.mjs readAnchors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAnchors } from '../history-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const one = { area: 'alpha', tip: 'tip-1' };
const two = { area: 'alpha', tip: 'tip-2' };
const other = { area: 'beta', tip: 'tip-9' };
const jsonl = (...rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n');

test('a missing anchor file reads as absent with no error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    const p = join(dir, 'missing.jsonl');
    assert.deepEqual(readAnchors('alpha', p), { present: false, anchors: [], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a path that cannot be read as a file reports its error code and path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    assert.deepEqual(readAnchors('alpha', dir), { present: false, anchors: [], tailTorn: false, error: `EISDIR reading ${dir}`, path: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file with no content lines is present with no anchors and no torn tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [], tailTorn: false, error: null, path: p });
    writeFileSync(p, '\n\n');
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only anchors for the requested area are kept, in file order with all their fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    const p = join(dir, 'match.jsonl');
    writeFileSync(p, jsonl(one, other, { area: 'alpha', tip: 'tip-3', seq: 7 }, ''));
    const anchors = [one, { area: 'alpha', tip: 'tip-3', seq: 7 }];
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors, tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file with only other areas yields no anchors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    const p = join(dir, 'nomatch.jsonl');
    writeFileSync(p, jsonl(other, { area: 'gamma', tip: 'tip-8' }));
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a matching area without a string tip is left out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    const p = join(dir, 'badtip.jsonl');
    writeFileSync(p, jsonl({ area: 'alpha', tip: 42 }, { area: 'alpha', tip: null }, { area: 'alpha' }, two));
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [two], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('valid JSON lines that are not anchor objects are skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    const p = join(dir, 'values.jsonl');
    writeFileSync(p, jsonl('null', '0', '"alpha"', '[]', one));
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [one], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unparseable final line sets tailTorn and keeps the anchors before it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    const p = join(dir, 'torn.jsonl');
    writeFileSync(p, jsonl(one, 'not-json'));
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [one], tailTorn: true, error: null, path: p });
    writeFileSync(p, jsonl(one, '{"area":"alpha"', '', ''));
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [one], tailTorn: true, error: null, path: p });
    writeFileSync(p, 'not-json');
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [], tailTorn: true, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unparseable line before the last is skipped without setting tailTorn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  try {
    const p = join(dir, 'mid.jsonl');
    writeFileSync(p, jsonl(one, 'not-json', two));
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [one, two], tailTorn: false, error: null, path: p });
    writeFileSync(p, jsonl('not-json', one, two));
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [one, two], tailTorn: false, error: null, path: p });
    writeFileSync(p, jsonl(one, 'not-json', two, 'not-json'));
    assert.deepEqual(readAnchors('alpha', p), { present: true, anchors: [one, two], tailTorn: true, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without a path argument the file named by CW_CHAIN_ANCHORS is read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readAnchors-'));
  const saved = process.env.CW_CHAIN_ANCHORS;
  try {
    const p = join(dir, 'env.jsonl');
    writeFileSync(p, jsonl(one, ''));
    process.env.CW_CHAIN_ANCHORS = p;
    assert.deepEqual(readAnchors('alpha'), { present: true, anchors: [one], tailTorn: false, error: null, path: p });
  } finally {
    if (saved === undefined) delete process.env.CW_CHAIN_ANCHORS;
    else process.env.CW_CHAIN_ANCHORS = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
