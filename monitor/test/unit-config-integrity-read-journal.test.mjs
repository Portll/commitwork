// Reads the config-integrity journal file and returns parsed rows with sha256 hashes (monitor/config-integrity.mjs readJournal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJournal } from '../config-integrity.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('returns null when the journal file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournal-'));
  try {
    const baselineDir = join(dir, 'baseline');
    mkdirSync(baselineDir, { recursive: true });
    process.env.CW_CONFINT_BASELINE = join(baselineDir, 'config-integrity-baseline.json');
    const r = readJournal();
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_CONFINT_BASELINE;
  }
});

test('returns an empty array when the journal file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournal-'));
  try {
    const baselineDir = join(dir, 'baseline');
    mkdirSync(baselineDir, { recursive: true });
    process.env.CW_CONFINT_BASELINE = join(baselineDir, 'config-integrity-baseline.json');
    const journalFile = join(baselineDir, 'config-integrity-journal.jsonl');
    writeFileSync(journalFile, '');
    const r = readJournal();
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_CONFINT_BASELINE;
  }
});

test('returns parsed rows with sha256 hashes for each non-empty line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournal-'));
  try {
    const baselineDir = join(dir, 'baseline');
    mkdirSync(baselineDir, { recursive: true });
    process.env.CW_CONFINT_BASELINE = join(baselineDir, 'config-integrity-baseline.json');
    const journalFile = join(baselineDir, 'config-integrity-journal.jsonl');
    const line1 = JSON.stringify({ action: 'pin', path: 'a' });
    const line2 = JSON.stringify({ action: 'unpin', path: 'b' });
    writeFileSync(journalFile, line1 + '\n' + line2 + '\n');
    const r = readJournal();
    assert.deepEqual(r, [{ sha256: "09c5f953062a8751f7bb14cd2f4941cde37ae1450ac185dcdf15f9802e4c98d7", row: { action: "pin", path: "a" } }, { sha256: "b598f9b0c9ba34a99931f0aec45c7caa4fc1e7ed7dedbcaadd76a763422a4416", row: { action: "unpin", path: "b" } }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_CONFINT_BASELINE;
  }
});

test('filters out empty lines between valid rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournal-'));
  try {
    const baselineDir = join(dir, 'baseline');
    mkdirSync(baselineDir, { recursive: true });
    process.env.CW_CONFINT_BASELINE = join(baselineDir, 'config-integrity-baseline.json');
    const journalFile = join(baselineDir, 'config-integrity-journal.jsonl');
    const line1 = JSON.stringify({ n: 1 });
    const line2 = JSON.stringify({ n: 2 });
    writeFileSync(journalFile, line1 + '\n\n' + line2 + '\n');
    const r = readJournal();
    assert.deepEqual(r, [{ sha256: "2bfd14f43d17fc7cea24e0917a8879b4b2f880b8baeec1b9d90fbaad655e71bd", row: { n: 1 } }, { sha256: "363379742f80b51bdb9206579af7754911543079b9399cb3fc315fb199f476e8", row: { n: 2 } }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_CONFINT_BASELINE;
  }
});

test('throws when the journal file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournal-'));
  try {
    const baselineDir = join(dir, 'baseline');
    mkdirSync(baselineDir, { recursive: true });
    process.env.CW_CONFINT_BASELINE = join(baselineDir, 'config-integrity-baseline.json');
    const journalFile = join(baselineDir, 'config-integrity-journal.jsonl');
    writeFileSync(journalFile, 'not-json\n');
    assert.throws(() => readJournal(), { name: "SyntaxError", message: "Unexpected token 'o', \"not-json\" is not valid JSON" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_CONFINT_BASELINE;
  }
});

test('throws when the journal file is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournal-'));
  try {
    const baselineDir = join(dir, 'baseline');
    mkdirSync(baselineDir, { recursive: true });
    process.env.CW_CONFINT_BASELINE = join(baselineDir, 'config-integrity-baseline.json');
    const journalFile = join(baselineDir, 'config-integrity-journal.jsonl');
    mkdirSync(journalFile, { recursive: true });
    assert.throws(() => readJournal(), { name: "Error", message: "EISDIR: illegal operation on a directory, read" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_CONFINT_BASELINE;
  }
});
