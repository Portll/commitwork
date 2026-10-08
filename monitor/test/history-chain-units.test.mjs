// monitor/test/history-chain-units.test.mjs — case tests for anchorsPath, fileExists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { anchorsPath, fileExists } from '../history-chain.mjs';

test('returns env override when CW_CHAIN_ANCHORS is set', () => {
  const prev = process.env.CW_CHAIN_ANCHORS;
  process.env.CW_CHAIN_ANCHORS = '/custom/anchors.jsonl';
  try {
    assert.equal(anchorsPath(), '/custom/anchors.jsonl');
  } finally {
    if (prev === undefined) delete process.env.CW_CHAIN_ANCHORS;
    else process.env.CW_CHAIN_ANCHORS = prev;
  }
});

test('returns default path when CW_CHAIN_ANCHORS is unset', () => {
  const prev = process.env.CW_CHAIN_ANCHORS;
  delete process.env.CW_CHAIN_ANCHORS;
  try {
    const result = anchorsPath();
    assert.equal(typeof result, 'string');
    assert.ok(result.endsWith(join('.claude', 'store', 'chain-tips.jsonl')));
  } finally {
    if (prev !== undefined) process.env.CW_CHAIN_ANCHORS = prev;
  }
});

test('returns default path when CW_CHAIN_ANCHORS is empty string', () => {
  const prev = process.env.CW_CHAIN_ANCHORS;
  process.env.CW_CHAIN_ANCHORS = '';
  try {
    const result = anchorsPath();
    assert.equal(typeof result, 'string');
    assert.ok(result.endsWith(join('.claude', 'store', 'chain-tips.jsonl')));
  } finally {
    if (prev === undefined) delete process.env.CW_CHAIN_ANCHORS;
    else process.env.CW_CHAIN_ANCHORS = prev;
  }
});

test('returns true for an existing regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-'));
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'x');
    assert.equal(fileExists(f), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for a non-existent path', () => {
  assert.equal(fileExists('/no/such/path/xyz'), false);
});

test('returns false for an existing directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-'));
  try {
    assert.equal(fileExists(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for a path with a missing parent directory', () => {
  assert.equal(fileExists('/no/such/dir/file.txt'), false);
});

test('returns true for a file inside a nested directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const f = join(sub, 'b.txt');
    writeFileSync(f, 'y');
    assert.equal(fileExists(f), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
