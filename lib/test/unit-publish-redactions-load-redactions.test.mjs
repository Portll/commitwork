// Returns the redaction map as an array of [source, pseudonym] pairs sorted by source length descending (lib/publish-redactions.mjs loadRedactions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRedactions } from '../publish-redactions.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when map is empty object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRedactions-'));
  try {
    const mapPath = join(dir, 'map.json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(mapPath, JSON.stringify({ map: {} }));
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } } }));
    const result = loadRedactions({ CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns single entry when map has one pair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRedactions-'));
  try {
    const mapPath = join(dir, 'map.json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'teamA': 'anon-1' } }));
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } } }));
    const result = loadRedactions({ CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath });
    assert.deepEqual(result, [['teamA', 'anon-1']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts entries by source length descending', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRedactions-'));
  try {
    const mapPath = join(dir, 'map.json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'teamA': 'anon-1', 'teamA-libs': 'anon-2', 'b': 'anon-3' } }));
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } } }));
    const result = loadRedactions({ CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath });
    assert.deepEqual(result, [['teamA-libs', 'anon-2'], ['teamA', 'anon-1'], ['b', 'anon-3']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when map file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRedactions-'));
  try {
    const mapPath = join(dir, 'nonexistent.json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } } }));
    assert.throws(() => {
      loadRedactions({ CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath });
    }, /map is ABSENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when map file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRedactions-'));
  try {
    const mapPath = join(dir, 'map.json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(mapPath, 'not valid json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } } }));
    assert.throws(() => {
      loadRedactions({ CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath });
    }, /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when map does not satisfy schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRedactions-'));
  try {
    const mapPath = join(dir, 'map.json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(mapPath, JSON.stringify({ map: 'not-an-object' }));
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    assert.throws(() => {
      loadRedactions({ CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath });
    }, /does not satisfy its schema/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple entries with same length in stable order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRedactions-'));
  try {
    const mapPath = join(dir, 'map.json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'abc': 'x', 'def': 'y', 'ghi': 'z' } }));
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } } }));
    const result = loadRedactions({ CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath });
    assert.equal(result.length, 3);
    assert.deepEqual(result[0], ['abc', 'x']);
    assert.deepEqual(result[1], ['def', 'y']);
    assert.deepEqual(result[2], ['ghi', 'z']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
