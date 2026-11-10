// Reads a JSONL file and returns parsed records plus a malformed count (monitor/resolution-chain.mjs readChains).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChains } from '../resolution-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok true with empty records and fresh true when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChains-'));
  try {
    const p = join(dir, 'missing.jsonl');
    const r = readChains(p);
    assert.deepEqual(r, { ok: true, records: [], fresh: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with empty records and fresh true when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChains-'));
  try {
    const p = join(dir, 'missing2.jsonl');
    const r = readChains(p);
    assert.equal(r.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with empty records and fresh false when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChains-'));
  try {
    const p = join(dir, 'missing3.jsonl');
    const r = readChains(p);
    assert.equal(r.fresh, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with parsed records and fresh false for valid JSONL lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChains-'));
  try {
    const p = join(dir, 'valid.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\n');
    const r = readChains(p);
    assert.deepEqual(r, { ok: true, records: [{ a: 1 }, { b: 2 }], malformed: 0, fresh: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with zero malformed and fresh false for empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChains-'));
  try {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    const r = readChains(p);
    assert.deepEqual(r, { ok: true, records: [], malformed: 0, fresh: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with one malformed and fresh false for a bad line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChains-'));
  try {
    const p = join(dir, 'bad.jsonl');
    writeFileSync(p, '{"a":1}\nnot-json\n');
    const r = readChains(p);
    assert.equal(r.malformed, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with records containing only valid lines and fresh false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChains-'));
  try {
    const p = join(dir, 'mixed.jsonl');
    writeFileSync(p, '{"x":1}\n\n{"y":2}\n');
    const r = readChains(p);
    assert.deepEqual(r.records, [{ x: 1 }, { y: 2 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with fresh false when file exists and has content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChains-'));
  try {
    const p = join(dir, 'content.jsonl');
    writeFileSync(p, '{"z":9}\n');
    const r = readChains(p);
    assert.equal(r.fresh, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
