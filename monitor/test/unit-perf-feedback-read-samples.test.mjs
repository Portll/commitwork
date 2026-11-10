// Reads a JSONL file and returns parsed samples with state and unparseable count (monitor/perf-feedback.mjs readSamples).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSamples } from '../perf-feedback.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok true with empty samples and state absent when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSamples-'));
  try {
    const r = readSamples({ path: join(dir, 'missing.jsonl') });
    assert.deepEqual(r, { ok: true, samples: [], state: "absent" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with empty samples and state absent when the file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSamples-'));
  try {
    const p = join(dir, 'present.jsonl');
    writeFileSync(p, '');
    const r = readSamples({ path: p });
    assert.deepEqual(r, { ok: true, samples: [], state: "present", unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with parsed samples and state present for valid JSONL lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSamples-'));
  try {
    const p = join(dir, 'valid.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\n');
    const r = readSamples({ path: p });
    assert.deepEqual(r, { ok: true, samples: [{ a: 1 }, { b: 2 }], state: "present", unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with zero unparseable lines when all lines are blank', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSamples-'));
  try {
    const p = join(dir, 'blank.jsonl');
    writeFileSync(p, '\n\n  \n');
    const r = readSamples({ path: p });
    assert.deepEqual(r, { ok: true, samples: [], state: "present", unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with unparseableLines count for invalid JSON lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSamples-'));
  try {
    const p = join(dir, 'mixed.jsonl');
    writeFileSync(p, '{"ok":true}\nnot-json\n{"ok":false}\n');
    const r = readSamples({ path: p });
    assert.deepEqual(r, { ok: true, samples: [{ ok: true }, { ok: false }], state: "present", unparseableLines: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with state unreadable and samples null when the file cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSamples-'));
  try {
    const p = join(dir, 'unreadable.jsonl');
    writeFileSync(p, 'x');
    const r = readSamples({ path: join(dir, 'sub', 'unreadable.jsonl') });
    assert.deepEqual(r, { ok: true, samples: [], state: "absent" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with state present and unparseableLines zero for a single valid line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSamples-'));
  try {
    const p = join(dir, 'single.jsonl');
    writeFileSync(p, '{"x":42}\n');
    const r = readSamples({ path: p });
    assert.deepEqual(r, { ok: true, samples: [{ x: 42 }], state: "present", unparseableLines: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
