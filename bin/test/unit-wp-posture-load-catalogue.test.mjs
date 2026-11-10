// Parses a JSON catalogue file, validates each entry, and returns a structured catalogue object. (bin/wp-posture.mjs loadCatalogue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogue } from '../wp-posture.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('valid catalogue returns structured object with entries and no invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'valid.json');
    const doc = {
      name: 'test-catalogue',
      routes: { r1: {} },
      componentClasses: { c1: {} },
      entries: [{
        id: 'my-check',
        sev: 'high',
        cwe: 'CWE-79',
        predicate: { verb: 'exists', type: 'file', where: { name: { regex: '^a.*' } } },
        enables: ['r1'],
        detail: 'Found {{name}}'
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.deepEqual(result, {
      path: p,
      name: 'test-catalogue',
      routes: { r1: {} },
      componentClasses: { c1: {} },
      entries: doc.entries,
      invalid: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when entries is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'no-entries.json');
    writeFileSync(p, JSON.stringify({ name: 'x', entries: {} }));
    assert.throws(() => loadCatalogue(p), { name: 'Error', message: 'catalogue has no entries[]' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts id starting with digit 2 as valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'id-digit.json');
    const doc = {
      name: 'x',
      routes: {},
      entries: [{
        id: '2good',
        sev: 'low',
        cwe: 'CWE-1',
        predicate: { verb: 'exists', type: 'file' },
        detail: 'd'
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.deepEqual(result.invalid, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats string where clause as having no operators', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'where-string.json');
    const doc = {
      name: 'x',
      routes: {},
      entries: [{
        id: 'good-id',
        sev: 'low',
        cwe: 'CWE-2',
        predicate: { verb: 'exists', type: 'file', where: 'not-an-object' },
        detail: 'd'
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.deepEqual(result.invalid, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags entry with invalid regex in where as invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'bad-regex.json');
    const doc = {
      name: 'x',
      routes: {},
      entries: [{
        id: 'good-id',
        sev: 'low',
        cwe: 'CWE-3',
        predicate: { verb: 'exists', type: 'file', where: { name: { regex: '[invalid' } } },
        detail: 'd'
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.deepEqual(result.invalid, [{
      id: 'good-id',
      why: 'Invalid regular expression: /[invalid/: Unterminated character class'
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts count verb with finite than', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'count-finite.json');
    const doc = {
      name: 'x',
      routes: {},
      entries: [{
        id: 'good-id',
        sev: 'low',
        cwe: 'CWE-4',
        predicate: { verb: 'count-gt', type: 'file', than: 5 },
        detail: 'd'
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.deepEqual(result.invalid, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags entry with unknown route in enables as invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'bad-route.json');
    const doc = {
      name: 'x',
      routes: { known: {} },
      entries: [{
        id: 'good-id',
        sev: 'low',
        cwe: 'CWE-5',
        predicate: { verb: 'exists', type: 'file' },
        enables: ['unknown-route'],
        detail: 'd'
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.deepEqual(result.invalid, [{
      id: 'good-id',
      why: "enables names unknown route 'unknown-route'"
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags entry with non-string truthy detail as invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'non-string-detail.json');
    const doc = {
      name: 'x',
      routes: {},
      entries: [{
        id: 'good-id',
        sev: 'low',
        cwe: 'CWE-6',
        predicate: { verb: 'exists', type: 'file' },
        detail: 123
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.deepEqual(result.invalid, [{
      id: 'good-id',
      why: 'detail template required'
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns catalogue name when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'with-name.json');
    const doc = {
      name: 'my-catalogue',
      routes: {},
      entries: [{
        id: 'good-id',
        sev: 'low',
        cwe: 'CWE-7',
        predicate: { verb: 'exists', type: 'file' },
        detail: 'd'
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.equal(result.name, 'my-catalogue');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for name when catalogue has no name field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogue-'));
  try {
    const p = join(dir, 'no-name.json');
    const doc = {
      routes: {},
      entries: [{
        id: 'good-id',
        sev: 'low',
        cwe: 'CWE-8',
        predicate: { verb: 'exists', type: 'file' },
        detail: 'd'
      }]
    };
    writeFileSync(p, JSON.stringify(doc));
    const result = loadCatalogue(p);
    assert.equal(result.name, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
