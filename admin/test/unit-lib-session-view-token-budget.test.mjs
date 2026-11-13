// Computes token budget for a session transcript with caching (admin/lib/session-view.mjs tokenBudget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenBudget, TOKEN_CACHE_MAX } from '../lib/session-view.mjs';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const validTranscript = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }) + '\n' +
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } }) + '\n';

test('returns unknown when no path provided', () => {
  const result = tokenBudget('');
  assert.deepEqual(result, { state: "unknown", why: "session reports no transcript id" });
});

test('returns absent when transcript file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const missing = join(dir, 'missing.jsonl');
    const result = tokenBudget(missing);
    assert.deepEqual(result, { state: "absent", why: "no transcript on this box" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable when stat throws non-ENOENT error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, validTranscript);
    chmodSync(dir, 0o000);
    const result = tokenBudget(file);
    assert.deepEqual(result, { state: "unreadable", why: "EACCES" });
  } finally {
    try { chmodSync(dir, 0o700); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns live summary on cache miss for valid transcript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, validTranscript);
    const result = tokenBudget(file);
    assert.deepEqual(result, { state: "live", turns: 1, syntheticTurns: 0, turnsWithoutTools: 1, turnsWithoutUsage: 1, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null, unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns cached result on cache hit for same file size and mtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, validTranscript);
    const first = tokenBudget(file);
    const second = tokenBudget(file);
    assert.deepEqual(second, { state: "live", turns: 1, syntheticTurns: 0, turnsWithoutTools: 1, turnsWithoutUsage: 1, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null, unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable when transcript parse fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const file = join(dir, 'bad.jsonl');
    writeFileSync(file, 'not valid json\n{broken');
    const result = tokenBudget(file);
    assert.deepEqual(result, { state: "live", turns: 0, syntheticTurns: 0, turnsWithoutTools: 0, turnsWithoutUsage: 0, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null, unparseableLines: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evicts older cache entries for same path when file changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, validTranscript);
    const first = tokenBudget(file);
    writeFileSync(file, validTranscript + JSON.stringify({ type: 'user', message: { role: 'user', content: 'more' } }) + '\n');
    const second = tokenBudget(file);
    assert.deepEqual(second, { state: "live", turns: 2, syntheticTurns: 0, turnsWithoutTools: 1, turnsWithoutUsage: 2, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null, unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evicts oldest entry when cache reaches TOKEN_CACHE_MAX', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const files = [];
    for (let i = 0; i < TOKEN_CACHE_MAX; i++) {
      const file = join(dir, `session${i}.jsonl`);
      writeFileSync(file, validTranscript);
      files.push(file);
    }
    const firstResult = tokenBudget(files[0]);
    for (let i = 1; i < TOKEN_CACHE_MAX; i++) {
      tokenBudget(files[i]);
    }
    const firstResultAgain = tokenBudget(files[0]);
    assert.deepStrictEqual(firstResultAgain, { state: "live", turns: 1, syntheticTurns: 0, turnsWithoutTools: 1, turnsWithoutUsage: 1, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null, unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseableLines as 0 when parsed.unparseable is 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const file = join(dir, 'clean.jsonl');
    writeFileSync(file, validTranscript);
    const result = tokenBudget(file);
    assert.deepEqual(result, { state: "live", turns: 1, syntheticTurns: 0, turnsWithoutTools: 1, turnsWithoutUsage: 1, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null, unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseableLines as parsed.unparseable when > 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenBudget-'));
  try {
    const file = join(dir, 'messy.jsonl');
    const messy = 'garbage line\n' + validTranscript;
    writeFileSync(file, messy);
    const result = tokenBudget(file);
    assert.deepEqual(result, { state: "live", turns: 1, syntheticTurns: 0, turnsWithoutTools: 1, turnsWithoutUsage: 1, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null, unparseableLines: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
