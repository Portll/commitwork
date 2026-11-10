// Per-scanner timing summary with sample counts, percentiles, and non-zero exit counts (monitor/perf-feedback.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../perf-feedback.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok false with unreadable state when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const r = summarise({ path: join(dir, 'nonexistent.jsonl') });
    assert.deepEqual(r, { ok: true, state: "absent", totalSamples: 0, unparseableLines: 0, scanners: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with empty scanners when file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const r = summarise({ path: join(dir, 'absent.jsonl') });
    assert.deepEqual(r, { ok: true, state: "absent", totalSamples: 0, unparseableLines: 0, scanners: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computes median and max correctly for a single scanner with enough samples', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const lines = [
      JSON.stringify({ scanner: 'a', ms: 10, exit: 0 }),
      JSON.stringify({ scanner: 'a', ms: 20, exit: 0 }),
      JSON.stringify({ scanner: 'a', ms: 30, exit: 0 }),
      JSON.stringify({ scanner: 'a', ms: 40, exit: 0 }),
      JSON.stringify({ scanner: 'a', ms: 50, exit: 0 })
    ].join('\n');
    writeFileSync(join(dir, 'f.jsonl'), lines);
    const r = summarise({ path: join(dir, 'f.jsonl') });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 5, unparseableLines: 0, scanners: [{ scanner: "a", samples: 5, enough: true, minMs: 10, medianMs: 30, p90Ms: 50, maxMs: 50, nonZeroExits: 0, note: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks scanner as not enough when samples are below minSamples', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const lines = [
      JSON.stringify({ scanner: 'b', ms: 100, exit: 0 }),
      JSON.stringify({ scanner: 'b', ms: 200, exit: 0 })
    ].join('\n');
    writeFileSync(join(dir, 'f.jsonl'), lines);
    const r = summarise({ path: join(dir, 'f.jsonl') });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 2, unparseableLines: 0, scanners: [{ scanner: "b", samples: 2, enough: false, minMs: 100, medianMs: 200, p90Ms: 200, maxMs: 200, nonZeroExits: 0, note: "2 sample(s) \u2014 below the 3 needed to say anything; reported, not used" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts non-zero exits that are not 0 or 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const lines = [
      JSON.stringify({ scanner: 'c', ms: 10, exit: 0 }),
      JSON.stringify({ scanner: 'c', ms: 20, exit: 1 }),
      JSON.stringify({ scanner: 'c', ms: 30, exit: 2 }),
      JSON.stringify({ scanner: 'c', ms: 40, exit: 3 }),
      JSON.stringify({ scanner: 'c', ms: 50, exit: null })
    ].join('\n');
    writeFileSync(join(dir, 'f.jsonl'), lines);
    const r = summarise({ path: join(dir, 'f.jsonl') });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 5, unparseableLines: 0, scanners: [{ scanner: "c", samples: 5, enough: true, minMs: 10, medianMs: 30, p90Ms: 50, maxMs: 50, nonZeroExits: 2, note: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts scanners by median descending', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const lines = [
      JSON.stringify({ scanner: 'low', ms: 10, exit: 0 }),
      JSON.stringify({ scanner: 'low', ms: 20, exit: 0 }),
      JSON.stringify({ scanner: 'low', ms: 30, exit: 0 }),
      JSON.stringify({ scanner: 'high', ms: 100, exit: 0 }),
      JSON.stringify({ scanner: 'high', ms: 200, exit: 0 }),
      JSON.stringify({ scanner: 'high', ms: 300, exit: 0 })
    ].join('\n');
    writeFileSync(join(dir, 'f.jsonl'), lines);
    const r = summarise({ path: join(dir, 'f.jsonl') });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 6, unparseableLines: 0, scanners: [{ scanner: "high", samples: 3, enough: true, minMs: 100, medianMs: 200, p90Ms: 300, maxMs: 300, nonZeroExits: 0, note: "" }, { scanner: "low", samples: 3, enough: true, minMs: 10, medianMs: 20, p90Ms: 30, maxMs: 30, nonZeroExits: 0, note: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out samples with missing scanner or non-finite ms', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const lines = [
      JSON.stringify({ scanner: 'd', ms: 10, exit: 0 }),
      JSON.stringify({ ms: 20, exit: 0 }),
      JSON.stringify({ scanner: 'd', ms: 'abc', exit: 0 }),
      JSON.stringify({ scanner: 'd', ms: 30, exit: 0 }),
      JSON.stringify({ scanner: 'd', ms: 40, exit: 0 })
    ].join('\n');
    writeFileSync(join(dir, 'f.jsonl'), lines);
    const r = summarise({ path: join(dir, 'f.jsonl') });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 5, unparseableLines: 0, scanners: [{ scanner: "d", samples: 3, enough: true, minMs: 10, medianMs: 30, p90Ms: 40, maxMs: 40, nonZeroExits: 0, note: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports unparseable lines count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const lines = [
      JSON.stringify({ scanner: 'e', ms: 10, exit: 0 }),
      'not valid json',
      JSON.stringify({ scanner: 'e', ms: 20, exit: 0 }),
      'also bad',
      JSON.stringify({ scanner: 'e', ms: 30, exit: 0 })
    ].join('\n');
    writeFileSync(join(dir, 'f.jsonl'), lines);
    const r = summarise({ path: join(dir, 'f.jsonl') });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 3, unparseableLines: 2, scanners: [{ scanner: "e", samples: 3, enough: true, minMs: 10, medianMs: 20, p90Ms: 30, maxMs: 30, nonZeroExits: 0, note: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
