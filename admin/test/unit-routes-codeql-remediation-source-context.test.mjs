// Extracts a window of source lines around a finding line, with path and size guards (admin/routes/codeql-remediation.mjs sourceContext).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceContext } from '../routes/codeql-remediation.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns a note when the repository path is not provided', () => {
  const result = sourceContext(null, 'src/index.js', 1);
  assert.deepEqual(result, { text: null, note: 'repository path not resolved on this box \u2014 source not read' });
});

test('returns a note when the finding path escapes the repository root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceContext-'));
  try {
    const result = sourceContext(dir, '../outside.txt', 1);
    assert.deepEqual(result, { text: null, note: 'finding path escapes the repository \u2014 source read refused' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a note when the source file cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceContext-'));
  try {
    const result = sourceContext(dir, 'missing.txt', 1);
    assert.deepEqual(result, { text: null, note: 'source file missing.txt not readable in the working tree \u2014 it may have moved since the scan' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the full file when it fits within the context window and byte cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceContext-'));
  try {
    const content = 'line1\nline2\nline3';
    writeFileSync(join(dir, 'small.txt'), content, 'utf8');
    const result = sourceContext(dir, 'small.txt', 2);
    assert.equal(result.text, '1: line1\n2: line2\n3: line3');
    assert.equal(result.note, 'lines 1-3 of 3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clips the context window to the file boundaries when the line is near the start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceContext-'));
  try {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    writeFileSync(join(dir, 'mid.txt'), lines.join('\n'), 'utf8');
    const result = sourceContext(dir, 'mid.txt', 1);
    const expectedFrom = 1;
    const expectedTo = 81;
    const expectedText = lines.slice(0, 81).map((l, i) => `${i + 1}: ${l}`).join('\n');
    assert.equal(result.text, expectedText);
    assert.equal(result.note, `lines ${expectedFrom}-${expectedTo} of 100`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clips the context window to the file boundaries when the line is near the end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceContext-'));
  try {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    writeFileSync(join(dir, 'end.txt'), lines.join('\n'), 'utf8');
    const result = sourceContext(dir, 'end.txt', 100);
    const expectedFrom = 20;
    const expectedTo = 100;
    const expectedText = lines.slice(19, 100).map((l, i) => `${20 + i}: ${l}`).join('\n');
    assert.equal(result.text, expectedText);
    assert.equal(result.note, `lines ${expectedFrom}-${expectedTo} of 100`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('truncates the text and adds a cap note when the output exceeds the byte limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceContext-'));
  try {
    const longLine = 'x'.repeat(20000);
    const lines = [longLine, 'short'];
    writeFileSync(join(dir, 'big.txt'), lines.join('\n'), 'utf8');
    const result = sourceContext(dir, 'big.txt', 1);
    assert.equal(result.text.length, 16000);
    assert.equal(result.note, 'lines 1-2 of 2 (capped at 16000 bytes \u2014 your conclusions are a floor, say so)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats a non-numeric line argument as line 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceContext-'));
  try {
    const content = 'a\nb\nc';
    writeFileSync(join(dir, 'nonnum.txt'), content, 'utf8');
    const result = sourceContext(dir, 'nonnum.txt', 'abc');
    assert.equal(result.text, '1: a\n2: b\n3: c');
    assert.equal(result.note, 'lines 1-3 of 3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
