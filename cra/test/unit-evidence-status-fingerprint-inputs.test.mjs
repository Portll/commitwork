// Computes per-input evidence fingerprints with presence, size, and hash state (cra/evidence-status.mjs fingerprintInputs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintInputs } from '../evidence-status.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns unresolved state when a path key is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprintInputs-'));
  try {
    const paths = { rollup: null, ledger: null, historyIndex: null, annotations: null, products: null, controls: null, kev: null, epss: null };
    const result = fingerprintInputs(paths);
    assert.equal(result.length, 8);
    assert.deepEqual(result[0], { name: 'rollup', feed: false, path: null, state: 'unresolved' });
    assert.deepEqual(result[1], { name: 'ledger', feed: false, path: null, state: 'unresolved' });
    assert.deepEqual(result[2], { name: 'history', feed: false, path: null, state: 'unresolved' });
    assert.deepEqual(result[3], { name: 'annotations', feed: false, path: null, state: 'unresolved' });
    assert.deepEqual(result[4], { name: 'products', feed: false, path: null, state: 'unresolved' });
    assert.deepEqual(result[5], { name: 'controls', feed: false, path: null, state: 'unresolved' });
    assert.deepEqual(result[6], { name: 'kev', feed: true, path: null, state: 'unresolved' });
    assert.deepEqual(result[7], { name: 'epss', feed: true, path: null, state: 'unresolved' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent state when a file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprintInputs-'));
  try {
    const missingPath = join(dir, 'nonexistent.json');
    const paths = { rollup: missingPath, ledger: null, historyIndex: null, annotations: null, products: null, controls: null, kev: null, epss: null };
    const result = fingerprintInputs(paths);
    assert.equal(result[0].name, 'rollup');
    assert.equal(result[0].feed, false);
    assert.equal(result[0].state, 'absent');
    assert.equal(result[0].path, missingPath);
    assert.equal(result[1].state, 'unresolved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with bytes and sha256 when a file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprintInputs-'));
  try {
    const filePath = join(dir, 'rollup.json');
    const content = Buffer.from('{"test":true}');
    writeFileSync(filePath, content);
    const paths = { rollup: filePath, ledger: null, historyIndex: null, annotations: null, products: null, controls: null, kev: null, epss: null };
    const result = fingerprintInputs(paths);
    assert.equal(result[0].name, 'rollup');
    assert.equal(result[0].feed, false);
    assert.equal(result[0].state, 'present');
    assert.equal(result[0].bytes, content.length);
    assert.equal(typeof result[0].sha256, 'string');
    assert.equal(result[0].sha256.length, 64);
    assert.equal(result[1].state, 'unresolved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state for feed inputs with feed flag true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprintInputs-'));
  try {
    const kevPath = join(dir, 'kev.json');
    const epssPath = join(dir, 'epss.json');
    writeFileSync(kevPath, Buffer.from('kev-data'));
    writeFileSync(epssPath, Buffer.from('epss-data'));
    const paths = { rollup: null, ledger: null, historyIndex: null, annotations: null, products: null, controls: null, kev: kevPath, epss: epssPath };
    const result = fingerprintInputs(paths);
    assert.equal(result[6].name, 'kev');
    assert.equal(result[6].feed, true);
    assert.equal(result[6].state, 'present');
    assert.equal(result[6].bytes, 8);
    assert.equal(result[7].name, 'epss');
    assert.equal(result[7].feed, true);
    assert.equal(result[7].state, 'present');
    assert.equal(result[7].bytes, 9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent state for feed inputs when files do not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprintInputs-'));
  try {
    const kevPath = join(dir, 'missing-kev.json');
    const epssPath = join(dir, 'missing-epss.json');
    const paths = { rollup: null, ledger: null, historyIndex: null, annotations: null, products: null, controls: null, kev: kevPath, epss: epssPath };
    const result = fingerprintInputs(paths);
    assert.equal(result[6].name, 'kev');
    assert.equal(result[6].feed, true);
    assert.equal(result[6].state, 'absent');
    assert.equal(result[7].name, 'epss');
    assert.equal(result[7].feed, true);
    assert.equal(result[7].state, 'absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unresolved for all inputs when all paths are undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprintInputs-'));
  try {
    const paths = {};
    const result = fingerprintInputs(paths);
    assert.equal(result.length, 8);
    for (const entry of result) {
      assert.equal(entry.state, 'unresolved');
      assert.equal(entry.path, null);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles empty file as present with zero bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprintInputs-'));
  try {
    const filePath = join(dir, 'empty.json');
    writeFileSync(filePath, Buffer.alloc(0));
    const paths = { rollup: filePath, ledger: null, historyIndex: null, annotations: null, products: null, controls: null, kev: null, epss: null };
    const result = fingerprintInputs(paths);
    assert.equal(result[0].state, 'present');
    assert.equal(result[0].bytes, 0);
    assert.equal(typeof result[0].sha256, 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state for every input when all files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprintInputs-'));
  try {
    const paths = {};
    const keys = ['rollup', 'ledger', 'historyIndex', 'annotations', 'products', 'controls', 'kev', 'epss'];
    for (const key of keys) {
      const filePath = join(dir, `${key}.json`);
      writeFileSync(filePath, Buffer.from(`content-${key}`));
      paths[key] = filePath;
    }
    const result = fingerprintInputs(paths);
    for (const entry of result) {
      assert.equal(entry.state, 'present');
      assert.equal(typeof entry.bytes, 'number');
      assert.equal(entry.bytes > 0, true);
      assert.equal(typeof entry.sha256, 'string');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
