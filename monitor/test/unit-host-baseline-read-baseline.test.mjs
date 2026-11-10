// Parsed host baseline file or an unknown marker (monitor/host-baseline.mjs readBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaseline } from '../host-baseline.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns unknown absent with the path as detail when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'missing.json');
    const r = readBaseline(p);
    assert.deepEqual(r, { unknown: true, unknownReason: 'absent', unknownDetail: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with the parsed object when the file contains a JSON object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'valid.json');
    writeFileSync(p, JSON.stringify({ owner: 'alice', count: 3 }), 'utf8');
    const r = readBaseline(p);
    assert.deepEqual(r, { ok: true, value: { owner: 'alice', count: 3 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown unparseable with the parser message when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json', 'utf8');
    const r = readBaseline(p);
    assert.deepEqual(r, {
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${p}: Expected property name or '}' in JSON at position 2 (line 1 column 3)`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown unparseable when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'empty.json');
    writeFileSync(p, '', 'utf8');
    const r = readBaseline(p);
    assert.deepEqual(r, {
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${p}: Unexpected end of JSON input`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with the parsed array when the file contains a JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'arr.json');
    writeFileSync(p, JSON.stringify([1, 2, 3]), 'utf8');
    const r = readBaseline(p);
    assert.deepEqual(r, { ok: true, value: [1, 2, 3] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with a null value when the file contains JSON null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null', 'utf8');
    const r = readBaseline(p);
    assert.deepEqual(r, { ok: true, value: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown unparseable with the read error when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const r = readBaseline(dir);
    assert.deepEqual(r, {
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${dir}: EISDIR: illegal operation on a directory, read`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reads the file named by CW_HOST_BASELINE when called without an argument', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  const saved = process.env.CW_HOST_BASELINE;
  try {
    const p = join(dir, 'env.json');
    writeFileSync(p, JSON.stringify({ source: 'env' }), 'utf8');
    process.env.CW_HOST_BASELINE = p;
    const r = readBaseline();
    assert.deepEqual(r, { ok: true, value: { source: 'env' } });
  } finally {
    if (saved === undefined) delete process.env.CW_HOST_BASELINE;
    else process.env.CW_HOST_BASELINE = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
