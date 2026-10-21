// Loads and validates an external redaction map, returning sorted entries (lib/external-write.mjs loadExternalMap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExternalMap } from '../external-write.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns entries sorted by key length descending for a valid map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { b: '2', a: '1', ccc: '3' } }));
    const result = loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath });
    assert.deepEqual(result, [['ccc', '3'], ['b', '2'], ['a', '1']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the map file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'missing.json');
    assert.throws(() => loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath }), /map is ABSENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'bad.json');
    writeFileSync(mapPath, 'not json');
    assert.throws(() => loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath }), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the JSON has no map property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'nomap.json');
    writeFileSync(mapPath, JSON.stringify({ foo: 'bar' }));
    assert.throws(() => loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath }), /has no map\{\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when map is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'arr.json');
    writeFileSync(mapPath, JSON.stringify({ map: ['a', 'b'] }));
    assert.throws(() => loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath }), /has no map\{\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when map is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'empty.json');
    writeFileSync(mapPath, JSON.stringify({ map: {} }));
    assert.throws(() => loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath }), /maps nothing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when a value is an empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'emptyval.json');
    writeFileSync(mapPath, JSON.stringify({ map: { key: '' } }));
    assert.throws(() => loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath }), /malformed entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when a key contains whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'wskey.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'bad key': 'val' } }));
    assert.throws(() => loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath }), /malformed entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when a value is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExternalMap-'));
  try {
    const mapPath = join(dir, 'numval.json');
    writeFileSync(mapPath, JSON.stringify({ map: { key: 123 } }));
    assert.throws(() => loadExternalMap({ CW_EXTERNAL_REDACTIONS: mapPath }), /malformed entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
