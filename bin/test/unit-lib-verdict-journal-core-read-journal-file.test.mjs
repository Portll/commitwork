// Reads a JSONL verdict journal, parses records, and verifies the prev-hash chain (bin/lib/verdict-journal-core.mjs readJournalFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJournalFile } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

test('returns absent true with empty records and zero torn when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const r = readJournalFile(join(dir, 'missing.jsonl'));
    assert.deepEqual(r, { absent: true, records: [], torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent false with empty records and zero torn when file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [], torn: 0, chain: { verified: 0, broken: 0, raced: 0, unchained: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a genesis record as verified when it is the only line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'genesis.jsonl');
    writeFileSync(p, JSON.stringify({ v: 1, gate: 'g', prev: 'genesis' }) + '\n');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [{ v: 1, gate: "g", prev: "genesis" }], torn: 0, chain: { verified: 1, broken: 0, raced: 0, unchained: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a rotation prefix as verified when it is the first line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'rot.jsonl');
    writeFileSync(p, JSON.stringify({ v: 1, gate: 'g', prev: 'rotation:abc123' }) + '\n');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [{ v: 1, gate: "g", prev: "rotation:abc123" }], torn: 0, chain: { verified: 1, broken: 0, raced: 0, unchained: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a non-genesis first line as broken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'badfirst.jsonl');
    writeFileSync(p, JSON.stringify({ v: 1, gate: 'g', prev: 'deadbeef' }) + '\n');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [{ v: 1, gate: "g", prev: "deadbeef" }], torn: 0, chain: { verified: 0, broken: 1, raced: 0, unchained: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a record with undefined prev as unchained', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'unchained.jsonl');
    writeFileSync(p, JSON.stringify({ v: 1, gate: 'g' }) + '\n');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [{ v: 1, gate: "g" }], torn: 0, chain: { verified: 0, broken: 0, raced: 0, unchained: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a second line matching the previous hash as verified', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'chain.jsonl');
    const l1 = JSON.stringify({ v: 1, gate: 'g', prev: 'genesis' });
    const l2 = JSON.stringify({ v: 1, gate: 'g', prev: lineHash(l1) });
    writeFileSync(p, l1 + '\n' + l2 + '\n');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [{ v: 1, gate: "g", prev: "genesis" }, { v: 1, gate: "g", prev: "b45c1b522cb0a81e30211de65c9905ed" }], torn: 0, chain: { verified: 2, broken: 0, raced: 0, unchained: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a second line with a mismatched prev as broken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'broken.jsonl');
    const l1 = JSON.stringify({ v: 1, gate: 'g', prev: 'genesis' });
    const l2 = JSON.stringify({ v: 1, gate: 'g', prev: 'ffffffffffffffffffffffffffffffff' });
    writeFileSync(p, l1 + '\n' + l2 + '\n');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [{ v: 1, gate: "g", prev: "genesis" }, { v: 1, gate: "g", prev: "ffffffffffffffffffffffffffffffff" }], torn: 0, chain: { verified: 1, broken: 1, raced: 0, unchained: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a second line referencing a seen hash as raced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'raced.jsonl');
    const l1 = JSON.stringify({ v: 1, gate: 'g', prev: 'genesis' });
    const l2 = JSON.stringify({ v: 1, gate: 'g', prev: lineHash(l1) });
    const l3 = JSON.stringify({ v: 1, gate: 'g', prev: lineHash(l1) });
    writeFileSync(p, l1 + '\n' + l2 + '\n' + l3 + '\n');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [{ v: 1, gate: "g", prev: "genesis" }, { v: 1, gate: "g", prev: "b45c1b522cb0a81e30211de65c9905ed" }, { v: 1, gate: "g", prev: "b45c1b522cb0a81e30211de65c9905ed" }], torn: 0, chain: { verified: 2, broken: 0, raced: 1, unchained: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts unparseable lines as torn and skips them from the chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournalFile-'));
  try {
    const p = join(dir, 'torn.jsonl');
    const l1 = JSON.stringify({ v: 1, gate: 'g', prev: 'genesis' });
    const l2 = 'not valid json {{{';
    const l3 = JSON.stringify({ v: 1, gate: 'g', prev: lineHash(l1) });
    writeFileSync(p, l1 + '\n' + l2 + '\n' + l3 + '\n');
    const r = readJournalFile(p);
    assert.deepEqual(r, { absent: false, records: [{ v: 1, gate: "g", prev: "genesis" }, { v: 1, gate: "g", prev: "b45c1b522cb0a81e30211de65c9905ed" }], torn: 1, chain: { verified: 1, broken: 0, raced: 1, unchained: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
