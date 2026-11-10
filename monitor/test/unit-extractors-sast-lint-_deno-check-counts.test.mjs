// Counts deno check errors by TS code (monitor/extractors/sast-lint.mjs _denoCheckCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _denoCheckCounts } from '../extractors/sast-lint.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_denoCheckCounts-'));
  try {
    const result = _denoCheckCounts(dir, 'nope.txt');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty artifact when the file is blank', () => {
  const dir = mkdtempSync(join(tmpdir(), '_denoCheckCounts-'));
  try {
    writeFileSync(join(dir, 'log.txt'), '   \n  ');
    const result = _denoCheckCounts(dir, 'log.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a ran artifact with zero counts when no errors are found', () => {
  const dir = mkdtempSync(join(tmpdir(), '_denoCheckCounts-'));
  try {
    writeFileSync(join(dir, 'log.txt'), 'Check file:///app/main.ts\nFound 0 errors.\n');
    const result = _denoCheckCounts(dir, 'log.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aggregates distinct TS codes with counts and messages', () => {
  const dir = mkdtempSync(join(tmpdir(), '_denoCheckCounts-'));
  try {
    const body = [
      'Check file:///app/main.ts',
      '\u001b[31mTS2307\u001b[0m[ERROR]: Cannot find module',
      '\u001b[31mTS2307\u001b[0m[ERROR]: Cannot find module',
      '\u001b[31mTS2322\u001b[0m[ERROR]: Type mismatch',
      'Found 3 errors.',
    ].join('\n');
    writeFileSync(join(dir, 'log.txt'), body);
    const result = _denoCheckCounts(dir, 'log.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 3, total: 3, ran: true, findings: [{ rule: "TS2322", count: 1, sev: "low", message: "Type mismatch" }, { rule: "TS2307", count: 2, sev: "low", message: "Cannot find module" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strips ANSI reset sequences before matching error lines', () => {
  const dir = mkdtempSync(join(tmpdir(), '_denoCheckCounts-'));
  try {
    const body = [
      '\u001b[31mTS1005\u001b[0m[ERROR]: Expected semicolon',
      'Found 1 errors.',
    ].join('\n');
    writeFileSync(join(dir, 'log.txt'), body);
    const result = _denoCheckCounts(dir, 'log.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, findings: [{ rule: "TS1005", count: 1, sev: "low", message: "Expected semicolon" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a single error with an empty message', () => {
  const dir = mkdtempSync(join(tmpdir(), '_denoCheckCounts-'));
  try {
    const body = [
      '\u001b[31mTS9999\u001b[0m[ERROR]:',
      'Found 1 errors.',
    ].join('\n');
    writeFileSync(join(dir, 'log.txt'), body);
    const result = _denoCheckCounts(dir, 'log.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, findings: [{ rule: "TS9999", count: 1, sev: "low", message: "Found 1 errors." }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts detail rows by descending count', () => {
  const dir = mkdtempSync(join(tmpdir(), '_denoCheckCounts-'));
  try {
    const lines = [];
    for (let i = 0; i < 3; i++) lines.push('\u001b[31mTS1111\u001b[0m[ERROR]: a');
    for (let i = 0; i < 2; i++) lines.push('\u001b[31mTS2222\u001b[0m[ERROR]: b');
    lines.push('Found 5 errors.');
    writeFileSync(join(dir, 'log.txt'), lines.join('\n'));
    const result = _denoCheckCounts(dir, 'log.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 5, total: 5, ran: true, findings: [{ rule: "TS2222", count: 2, sev: "low", message: "b" }, { rule: "TS1111", count: 3, sev: "low", message: "a" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts when the log has no Found line', () => {
  const dir = mkdtempSync(join(tmpdir(), '_denoCheckCounts-'));
  try {
    writeFileSync(join(dir, 'log.txt'), 'Check file:///app/main.ts\n');
    const result = _denoCheckCounts(dir, 'log.txt');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
