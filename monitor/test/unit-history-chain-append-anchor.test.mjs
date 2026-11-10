// Appends the current chain tip as an anchor line to the sidecar store (monitor/history-chain.mjs appendAnchor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendAnchor } from '../history-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('throws when the chain file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendAnchor-'));
  try {
    const histDir = join(dir, 'hist');
    const storeDir = join(dir, 'store');
    mkdirSync(histDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    const path = join(storeDir, 'chain-tips.jsonl');
    assert.throws(() => appendAnchor(histDir, 'area1', '2024-01-01T00:00:00Z', path), {
      name: 'Error',
      message: 'nothing to anchor: empty chain'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the chain has a torn tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendAnchor-'));
  try {
    const histDir = join(dir, 'hist');
    const storeDir = join(dir, 'store');
    mkdirSync(histDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(histDir, 'chain.jsonl'), '{"chain":"abc"}\n{"broken');
    const path = join(storeDir, 'chain-tips.jsonl');
    assert.throws(() => appendAnchor(histDir, 'area1', '2024-01-01T00:00:00Z', path), {
      name: 'Error',
      message: 'nothing to anchor: torn tail'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the anchor store directory is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendAnchor-'));
  try {
    const histDir = join(dir, 'hist');
    mkdirSync(histDir, { recursive: true });
    writeFileSync(join(histDir, 'chain.jsonl'), '{"chain":"abc"}\n');
    const path = join(dir, 'nonexistent-store', 'chain-tips.jsonl');
    assert.throws(() => appendAnchor(histDir, 'area1', '2024-01-01T00:00:00Z', path), {
      name: 'Error',
      message: `anchor store ${join(dir, 'nonexistent-store')} is absent \u2014 not creating it (it is a symlink into the sidecar)`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appends the tip of a single-event chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendAnchor-'));
  try {
    const histDir = join(dir, 'hist');
    const storeDir = join(dir, 'store');
    mkdirSync(histDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(histDir, 'chain.jsonl'), '{"chain":"abc"}\n');
    const path = join(storeDir, 'chain-tips.jsonl');
    const result = appendAnchor(histDir, 'area1', '2024-01-01T00:00:00Z', path);
    assert.deepEqual(result, { at: '2024-01-01T00:00:00Z', area: 'area1', length: 1, tip: 'abc' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appends the tip of a multi-event chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendAnchor-'));
  try {
    const histDir = join(dir, 'hist');
    const storeDir = join(dir, 'store');
    mkdirSync(histDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(histDir, 'chain.jsonl'), '{"chain":"abc"}\n{"chain":"def"}\n{"chain":"ghi"}\n');
    const path = join(storeDir, 'chain-tips.jsonl');
    const result = appendAnchor(histDir, 'area1', '2024-01-01T00:00:00Z', path);
    assert.deepEqual(result, { at: '2024-01-01T00:00:00Z', area: 'area1', length: 3, tip: 'ghi' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes the anchor line to the store file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendAnchor-'));
  try {
    const histDir = join(dir, 'hist');
    const storeDir = join(dir, 'store');
    mkdirSync(histDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(histDir, 'chain.jsonl'), '{"chain":"abc"}\n{"chain":"def"}\n');
    const path = join(storeDir, 'chain-tips.jsonl');
    appendAnchor(histDir, 'area1', '2024-01-01T00:00:00Z', path);
    const content = readFileSync(path, 'utf8');
    assert.equal(content, '{"at":"2024-01-01T00:00:00Z","area":"area1","length":2,"tip":"def"}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
