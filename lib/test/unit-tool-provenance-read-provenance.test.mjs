// Reads a provenance store file and validates its shape (lib/tool-provenance.mjs readProvenance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProvenance } from '../tool-provenance.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty tools object when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    const p = join(dir, 'missing.json');
    assert.deepEqual(readProvenance(p), { tools: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed data when file contains valid provenance store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    const p = join(dir, 'valid.json');
    writeFileSync(p, JSON.stringify({ tools: { git: { version: '1.0' } } }));
    assert.deepEqual(readProvenance(p), { tools: { git: { version: "1.0" } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file contains null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    assert.throws(() => readProvenance(p), { name: 'Error', message: `${p}: not a provenance store` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file contains a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    const p = join(dir, 'str.json');
    writeFileSync(p, '"hello"');
    assert.throws(() => readProvenance(p), { name: 'Error', message: `${p}: not a provenance store` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file contains object without tools property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    const p = join(dir, 'notools.json');
    writeFileSync(p, JSON.stringify({ foo: 'bar' }));
    assert.throws(() => readProvenance(p), { name: 'Error', message: `${p}: not a provenance store` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when tools property is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    const p = join(dir, 'strtools.json');
    writeFileSync(p, JSON.stringify({ tools: 'not-an-object' }));
    assert.throws(() => readProvenance(p), { name: 'Error', message: `${p}: not a provenance store` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when tools property is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    const p = join(dir, 'nulltools.json');
    writeFileSync(p, JSON.stringify({ tools: null }));
    assert.throws(() => readProvenance(p), { name: 'Error', message: `${p}: not a provenance store` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file contains a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    const p = join(dir, 'num.json');
    writeFileSync(p, '42');
    assert.throws(() => readProvenance(p), { name: 'Error', message: `${p}: not a provenance store` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
