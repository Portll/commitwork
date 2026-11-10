// Computes the current head state of a verdict journal store (bin/anchor-witness.mjs storeHead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeHead } from '../anchor-witness.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

test('returns absent state when journal file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHead-'));
  try {
    const path = join(dir, 'journal.jsonl');
    const result = storeHead('test-agent', path);
    assert.deepEqual(result, {
      name: 'test-agent',
      present: false,
      records: 0,
      tipHash: null,
      generations: 0,
      chain: null
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with records and tipHash for valid journal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHead-'));
  try {
    const path = join(dir, 'journal.jsonl');
    const line1 = '{"type":"record","data":"a"}';
    const line2 = '{"type":"record","data":"b"}';
    writeFileSync(path, line1 + '\n' + line2 + '\n');
    const result = storeHead('agent1', path);
    assert.equal(result.name, 'agent1');
    assert.equal(result.present, true);
    assert.equal(result.records, 2);
    assert.equal(result.tipHash, lineHash(line2));
    assert.equal(result.generations, 0);
    assert.deepEqual(result.chain, { verified: 0, broken: 0, raced: 0, unchained: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts generation files matching base pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHead-'));
  try {
    const path = join(dir, 'journal.jsonl');
    writeFileSync(path, '{"type":"record"}\n');
    writeFileSync(join(dir, 'journal.jsonl.1'), 'gen1');
    writeFileSync(join(dir, 'journal.jsonl.2'), 'gen2');
    writeFileSync(join(dir, 'journal.jsonl.3'), 'gen3');
    writeFileSync(join(dir, 'journal.jsonl.abc'), 'not-a-gen');
    writeFileSync(join(dir, 'other.jsonl.1'), 'other');
    const result = storeHead('agent2', path);
    assert.equal(result.generations, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null tipHash when journal is empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHead-'));
  try {
    const path = join(dir, 'journal.jsonl');
    writeFileSync(path, '');
    const result = storeHead('agent3', path);
    assert.equal(result.present, true);
    assert.equal(result.records, 0);
    assert.equal(result.tipHash, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles journal with chain field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHead-'));
  try {
    const path = join(dir, 'journal.jsonl');
    const line = '{"type":"record","chain":"abc123"}';
    writeFileSync(path, line + '\n');
    const result = storeHead('agent4', path);
    assert.deepEqual(result.chain, { verified: 0, broken: 0, raced: 0, unchained: 1 });
    assert.equal(result.tipHash, lineHash(line));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero generations when directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHead-'));
  try {
    const path = join(dir, 'nonexistent', 'journal.jsonl');
    const result = storeHead('agent5', path);
    assert.equal(result.present, false);
    assert.equal(result.generations, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computes correct tipHash for single line journal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHead-'));
  try {
    const path = join(dir, 'journal.jsonl');
    const line = 'single-line-content';
    writeFileSync(path, line + '\n');
    const result = storeHead('agent6', path);
    assert.equal(result.tipHash, lineHash(line));
    assert.equal(result.records, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple records with correct count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHead-'));
  try {
    const path = join(dir, 'journal.jsonl');
    const lines = Array.from({ length: 5 }, (_, i) => `{"idx":${i}}`);
    writeFileSync(path, lines.join('\n') + '\n');
    const result = storeHead('agent7', path);
    assert.equal(result.records, 5);
    assert.equal(result.tipHash, lineHash(lines[4]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
