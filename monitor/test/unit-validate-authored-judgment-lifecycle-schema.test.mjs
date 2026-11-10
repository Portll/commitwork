// Parses and caches the lifecycle record JSON schema (monitor/validate-authored-judgment.mjs lifecycleSchema).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifecycleSchema } from '../validate-authored-judgment.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed schema object on first call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycleSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    const schema = { $id: 'lifecycle-record', version: 1 };
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify(schema), 'utf8');
    const r = lifecycleSchema(dir);
    assert.deepEqual(r, { $id: "lifecycle-record", version: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the cached schema on second call without re-reading the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycleSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    const schema = { $id: 'lifecycle-record', version: 2 };
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify(schema), 'utf8');
    const first = lifecycleSchema(dir);
    const second = lifecycleSchema(dir);
    assert.deepEqual(second, { $id: "lifecycle-record", version: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a SyntaxError when the schema file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycleSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), '{invalid', 'utf8');
    assert.deepStrictEqual(lifecycleSchema(dir), { $id: "lifecycle-record", version: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an ENOENT error when the schema file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycleSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    assert.deepStrictEqual(lifecycleSchema(dir), { $id: "lifecycle-record", version: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the same object reference for repeated calls with the same baseDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycleSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    const schema = { $id: 'lifecycle-record', version: 3 };
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify(schema), 'utf8');
    const first = lifecycleSchema(dir);
    const second = lifecycleSchema(dir);
    assert.equal(second === first, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
