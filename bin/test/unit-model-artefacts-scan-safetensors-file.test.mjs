// Validates the 8-byte little-endian header length and JSON object header of a safetensors file (bin/model-artefacts.mjs scanSafetensorsFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSafetensorsFile } from '../model-artefacts.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns invalid when file size is below 8 bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'tiny.bin');
    writeFileSync(p, Buffer.alloc(7));
    const r = scanSafetensorsFile(p, 7);
    assert.deepEqual(r, { invalid: 'file is 7 bytes, shorter than the 8-byte header length' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid when header length exceeds file size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'short.bin');
    const buf = Buffer.alloc(16);
    buf.writeBigUInt64LE(100n, 0);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 16);
    assert.deepEqual(r, { invalid: 'header length 100 exceeds file size 16' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid naming the file size when header length is 100 MiB plus one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'big.bin');
    const buf = Buffer.alloc(16);
    buf.writeBigUInt64LE(100n * 1024n * 1024n + 1n, 0);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 16);
    assert.deepEqual(r, { invalid: 'header length 104857601 exceeds file size 16' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid when header bytes are not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'badjson.bin');
    const buf = Buffer.alloc(12);
    buf.writeBigUInt64LE(4n, 0);
    buf.write('not json', 8);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 12);
    assert.deepEqual(r, { invalid: 'header is not JSON' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid when header JSON is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'arr.bin');
    const buf = Buffer.alloc(13);
    buf.writeBigUInt64LE(5n, 0);
    buf.write('[1,2]', 8);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 13);
    assert.deepEqual(r, { invalid: 'header JSON is not an object' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid when header JSON is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'str.bin');
    const buf = Buffer.alloc(15);
    buf.writeBigUInt64LE(7n, 0);
    buf.write('"hello"', 8);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 15);
    assert.deepEqual(r, { invalid: 'header JSON is not an object' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid when header JSON is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'null.bin');
    const buf = Buffer.alloc(12);
    buf.writeBigUInt64LE(4n, 0);
    buf.write('null', 8);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 12);
    assert.deepEqual(r, { invalid: 'header JSON is not an object' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid when header bytes are a JSON object followed by padding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'ok.bin');
    const buf = Buffer.alloc(15);
    buf.writeBigUInt64LE(7n, 0);
    buf.write('{}', 8);
    buf.write('pad', 10);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 15);
    assert.deepEqual(r, { invalid: 'header is not JSON' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns valid when header is a JSON object and file size matches header length', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'ok2.bin');
    const buf = Buffer.alloc(10);
    buf.writeBigUInt64LE(2n, 0);
    buf.write('{}', 8);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 10);
    assert.deepEqual(r, { invalid: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid when header length equals exactly 100 MiB but exceeds file size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanSafetensorsFile-'));
  try {
    const p = join(dir, 'max.bin');
    const buf = Buffer.alloc(16);
    buf.writeBigUInt64LE(100n * 1024n * 1024n, 0);
    writeFileSync(p, buf);
    const r = scanSafetensorsFile(p, 16);
    assert.deepEqual(r, { invalid: 'header length 104857600 exceeds file size 16' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
