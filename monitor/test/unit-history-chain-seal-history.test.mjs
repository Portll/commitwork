// Seals index rows into the chain as retro-seal events (monitor/history-chain.mjs sealHistory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealHistory } from '../history-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns sealed 0 and refused error when chain is corrupt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealHistory-'));
  try {
    writeFileSync(join(dir, 'chain.jsonl'), 'not-json\n');
    const r = sealHistory(dir, [{ stamp: 's1' }], '2024-01-01T00:00:00Z');
    assert.deepEqual(r, { sealed: 0, refused: "torn tail" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns sealed 0 and refused torn tail when chain has torn tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealHistory-'));
  try {
    writeFileSync(join(dir, 'chain.jsonl'), '{"at":"a","op":"slice","stamp":"s1","sliceId":null,"source":null,"sliceSha256":null,"by":"unattributed","chainVersion":2,"prev":"0000000000000000000000000000000000000000000000000000000000000000","chain":"x"}\n{"torn');
    const r = sealHistory(dir, [{ stamp: 's2' }], '2024-01-01T00:00:00Z');
    assert.deepEqual(r, { sealed: 0, refused: "torn tail" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns sealed 0 and refused null when index is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealHistory-'));
  try {
    const r = sealHistory(dir, [], '2024-01-01T00:00:00Z');
    assert.deepEqual(r, { sealed: 0, refused: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('seals a row with sliceSha256 and skips rows already covered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealHistory-'));
  try {
    writeFileSync(join(dir, 'chain.jsonl'), '{"at":"a","op":"slice","stamp":"s1","sliceId":null,"source":null,"sliceSha256":null,"by":"unattributed","chainVersion":2,"prev":"0000000000000000000000000000000000000000000000000000000000000000","chain":"x"}\n');
    const r = sealHistory(dir, [{ stamp: 's1' }, { stamp: 's2', sliceSha256: 'abc' }], '2024-01-01T00:00:00Z');
    assert.deepEqual(r, { sealed: 1, refused: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('seals a row with file by hashing the slice bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealHistory-'));
  try {
    writeFileSync(join(dir, 'slice.txt'), 'hello');
    const r = sealHistory(dir, [{ stamp: 's1', file: 'slice.txt' }], '2024-01-01T00:00:00Z');
    assert.deepEqual(r, { sealed: 1, refused: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('seals a row with unreadable file as no hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealHistory-'));
  try {
    const r = sealHistory(dir, [{ stamp: 's1', file: 'missing.txt' }], '2024-01-01T00:00:00Z');
    assert.deepEqual(r, { sealed: 1, refused: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('skips rows with empty stamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealHistory-'));
  try {
    const r = sealHistory(dir, [{ stamp: '' }], '2024-01-01T00:00:00Z');
    assert.deepEqual(r, { sealed: 0, refused: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('seals multiple rows and appends them to the chain file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealHistory-'));
  try {
    const r = sealHistory(dir, [{ stamp: 'a', sliceSha256: 'h1' }, { stamp: 'b', sliceSha256: 'h2' }], '2024-01-01T00:00:00Z');
    assert.deepEqual(r, { sealed: 2, refused: null });
    const lines = readFileSync(join(dir, 'chain.jsonl'), 'utf8').split('\n').filter((l) => l.length);
    assert.equal(lines.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
