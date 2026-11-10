// Verifies that every pinned file in the store exists and matches its sha256 pin (bin/yara-rules.mjs verifyStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyStore } from '../yara-rules.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('returns ok true when all pinned files exist with matching hashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyStore-'));
  try {
    const content = 'rule test { }';
    const hash = sha(content);
    const setDir = join(dir, 'myset', 'abc123');
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, 'rule.yar'), content);
    const doc = { sets: { myset: { commit: 'abc123', files: { 'rule.yar': hash } } } };
    const result = verifyStore(doc, dir);
    const expectedDir = join(dir, 'myset', 'abc123');
    assert.deepEqual(result, {
      ok: true,
      problems: [],
      sets: [{
        name: 'myset',
        dir: expectedDir,
        entry: undefined,
        relaxedRegex: false,
        defaultSev: 'med',
        undeterminedReason: '',
        url: undefined,
        license: undefined,
        commit: 'abc123',
        files: ['rule.yar']
      }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports not installed when a pinned file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyStore-'));
  try {
    const content = 'rule test { }';
    const hash = sha(content);
    const setDir = join(dir, 'myset', 'abc123');
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, 'other.yar'), content);
    const doc = { sets: { myset: { commit: 'abc123', files: { 'missing.yar': hash } } } };
    const result = verifyStore(doc, dir);
    const expectedDir = join(dir, 'myset', 'abc123');
    assert.deepEqual(result, {
      ok: false,
      problems: ['myset/missing.yar: not installed'],
      sets: [{
        name: 'myset',
        dir: expectedDir,
        entry: undefined,
        relaxedRegex: false,
        defaultSev: 'med',
        undeterminedReason: '',
        url: undefined,
        license: undefined,
        commit: 'abc123',
        files: ['missing.yar']
      }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports sha256 mismatch when file content differs from pin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyStore-'));
  try {
    const content = 'rule test { }';
    const wrongHash = sha('different content');
    const setDir = join(dir, 'myset', 'abc123');
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, 'rule.yar'), content);
    const doc = { sets: { myset: { commit: 'abc123', files: { 'rule.yar': wrongHash } } } };
    const result = verifyStore(doc, dir);
    const expectedDir = join(dir, 'myset', 'abc123');
    assert.deepEqual(result, {
      ok: false,
      problems: ['myset/rule.yar: sha256 does not match the pin'],
      sets: [{
        name: 'myset',
        dir: expectedDir,
        entry: undefined,
        relaxedRegex: false,
        defaultSev: 'med',
        undeterminedReason: '',
        url: undefined,
        license: undefined,
        commit: 'abc123',
        files: ['rule.yar']
      }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports unreadable error for non-ENOENT read failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyStore-'));
  try {
    const content = 'rule test { }';
    const hash = sha(content);
    const setDir = join(dir, 'myset', 'abc123');
    mkdirSync(setDir, { recursive: true });
    const fileRel = 'rule.yar';
    const filePath = join(setDir, fileRel);
    mkdirSync(filePath);
    const doc = { sets: { myset: { commit: 'abc123', files: { [fileRel]: hash } } } };
    const result = verifyStore(doc, dir);
    const expectedDir = join(dir, 'myset', 'abc123');
    assert.deepEqual(result, {
      ok: false,
      problems: ['myset/rule.yar: unreadable (EISDIR)'],
      sets: [{
        name: 'myset',
        dir: expectedDir,
        entry: undefined,
        relaxedRegex: false,
        defaultSev: 'med',
        undeterminedReason: '',
        url: undefined,
        license: undefined,
        commit: 'abc123',
        files: ['rule.yar']
      }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false when any problem exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyStore-'));
  try {
    const content = 'rule test { }';
    const hash = sha(content);
    const setDir = join(dir, 'myset', 'abc123');
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, 'rule.yar'), content);
    const doc = { sets: { myset: { commit: 'abc123', files: { 'rule.yar': hash, 'gone.yar': hash } } } };
    const result = verifyStore(doc, dir);
    const expectedDir = join(dir, 'myset', 'abc123');
    assert.deepEqual(result, {
      ok: false,
      problems: ['myset/gone.yar: not installed'],
      sets: [{
        name: 'myset',
        dir: expectedDir,
        entry: undefined,
        relaxedRegex: false,
        defaultSev: 'med',
        undeterminedReason: '',
        url: undefined,
        license: undefined,
        commit: 'abc123',
        files: ['rule.yar', 'gone.yar']
      }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('populates set metadata fields with defaults when optional fields are absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyStore-'));
  try {
    const content = 'rule test { }';
    const hash = sha(content);
    const setDir = join(dir, 'myset', 'abc123');
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, 'rule.yar'), content);
    const doc = { sets: { myset: { commit: 'abc123', files: { 'rule.yar': hash } } } };
    const result = verifyStore(doc, dir);
    const expectedDir = join(dir, 'myset', 'abc123');
    assert.deepEqual(result, {
      ok: true,
      problems: [],
      sets: [{
        name: 'myset',
        dir: expectedDir,
        entry: undefined,
        relaxedRegex: false,
        defaultSev: 'med',
        undeterminedReason: '',
        url: undefined,
        license: undefined,
        commit: 'abc123',
        files: ['rule.yar']
      }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with zero problems for a fully valid store with multiple files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifyStore-'));
  try {
    const c1 = 'rule a { }';
    const c2 = 'rule b { }';
    const h1 = sha(c1);
    const h2 = sha(c2);
    const setDir = join(dir, 'myset', 'abc123');
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, 'a.yar'), c1);
    writeFileSync(join(setDir, 'b.yar'), c2);
    const doc = { sets: { myset: { commit: 'abc123', files: { 'a.yar': h1, 'b.yar': h2 } } } };
    const result = verifyStore(doc, dir);
    const expectedDir = join(dir, 'myset', 'abc123');
    assert.deepEqual(result, {
      ok: true,
      problems: [],
      sets: [{
        name: 'myset',
        dir: expectedDir,
        entry: undefined,
        relaxedRegex: false,
        defaultSev: 'med',
        undeterminedReason: '',
        url: undefined,
        license: undefined,
        commit: 'abc123',
        files: ['a.yar', 'b.yar']
      }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
