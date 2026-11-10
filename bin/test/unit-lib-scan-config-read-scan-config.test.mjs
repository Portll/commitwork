// Reads and validates scan-config.json, returning a normalized config or ABSENT (bin/lib/scan-config.mjs readScanConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readScanConfig } from '../lib/scan-config.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ABSENT when the config file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScanConfig-'));
  try {
    const p = join(dir, 'scan-config.json');
    const r = readScanConfig({ path: p });
    assert.deepEqual(r, { absent: true, version: 1, checks: {}, tools: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the config file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScanConfig-'));
  try {
    const p = join(dir, 'scan-config.json');
    writeFileSync(p, 'not json');
    assert.throws(() => readScanConfig({ path: p }), { name: "Error", message: "scan-config is unreadable, which is not the same as absent: Unexpected token 'o', \"not json\" is not valid JSON" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the config file is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScanConfig-'));
  try {
    const p = join(dir, 'scan-config.json');
    writeFileSync(p, '"hello"');
    assert.throws(() => readScanConfig({ path: p }), {
      name: 'Error',
      message: 'scan-config is not an object',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the config version is not 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScanConfig-'));
  try {
    const p = join(dir, 'scan-config.json');
    writeFileSync(p, JSON.stringify({ version: 2, checks: {}, tools: {} }));
    assert.throws(() => readScanConfig({ path: p }), {
      name: 'Error',
      message: 'scan-config version 2 is not one this build understands',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns normalized config with version 1 and valid checks and tools', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScanConfig-'));
  try {
    const p = join(dir, 'scan-config.json');
    writeFileSync(p, JSON.stringify({ version: 1, at: '2024-01-01T00:00:00Z', checks: { a: 1 }, tools: { b: 2 } }));
    const r = readScanConfig({ path: p });
    assert.deepEqual(r, { absent: false, version: 1, at: "2024-01-01T00:00:00Z", checks: { a: 1 }, tools: { b: 2 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty objects when checks and tools are missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScanConfig-'));
  try {
    const p = join(dir, 'scan-config.json');
    writeFileSync(p, JSON.stringify({ version: 1 }));
    const r = readScanConfig({ path: p });
    assert.deepEqual(r, { absent: false, version: 1, at: null, checks: {}, tools: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty objects when checks and tools are not objects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScanConfig-'));
  try {
    const p = join(dir, 'scan-config.json');
    writeFileSync(p, JSON.stringify({ version: 1, checks: 'bad', tools: 42 }));
    const r = readScanConfig({ path: p });
    assert.deepEqual(r, { absent: false, version: 1, at: null, checks: {}, tools: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for at when it is missing from the config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScanConfig-'));
  try {
    const p = join(dir, 'scan-config.json');
    writeFileSync(p, JSON.stringify({ version: 1, checks: { x: 1 }, tools: { y: 2 } }));
    const r = readScanConfig({ path: p });
    assert.equal(r.at, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
