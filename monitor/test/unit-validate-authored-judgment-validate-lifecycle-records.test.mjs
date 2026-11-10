// Validates lifecycle records against the bundled schema (monitor/validate-authored-judgment.mjs validateLifecycleRecords).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLifecycleRecords } from '../validate-authored-judgment.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array for valid record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleRecords-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify({
      required: ['key', 'severity', 'residualVerdict', 'bugVisibleTo', 'weaknessClassSource', 'lifecycleStatus'],
      properties: {
        severity: { enum: ['low', 'medium', 'high'] },
        residualVerdict: { enum: ['clean', 'dirty'] },
        bugVisibleTo: { enum: ['user', 'admin'] },
        weaknessClassSource: { enum: ['cwe', 'custom'] },
        weaknessClass: { items: { pattern: '^CWE-\\d+$' } },
        cwxRef: { pattern: '^CW-\\d+$' }
      }
    }));
    const rec = {
      key: 'k1', severity: 'low', residualVerdict: 'clean', bugVisibleTo: 'user',
      weaknessClassSource: 'cwe', lifecycleStatus: 'active',
      weaknessClass: ['CWE-79'], cwxRef: 'CW-1',
      scanProvenance: { ran: true, at: '2024-01-01T00:00:00Z' }
    };
    const r = validateLifecycleRecords([rec], { baseDir: dir });
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports missing required field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleRecords-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify({
      required: ['key', 'severity', 'residualVerdict', 'bugVisibleTo', 'weaknessClassSource', 'lifecycleStatus'],
      properties: {
        severity: { enum: ['low', 'medium', 'high'] },
        residualVerdict: { enum: ['clean', 'dirty'] },
        bugVisibleTo: { enum: ['user', 'admin'] },
        weaknessClassSource: { enum: ['cwe', 'custom'] },
        weaknessClass: { items: { pattern: '^CWE-\\d+$' } },
        cwxRef: { pattern: '^CW-\\d+$' }
      }
    }));
    const rec = { key: 'k1', severity: 'low', residualVerdict: 'clean', bugVisibleTo: 'user', weaknessClassSource: 'cwe' };
    const r = validateLifecycleRecords([rec], { baseDir: dir });
    assert.deepEqual(r, ["lifecycle[0] k1: missing required 'lifecycleStatus'"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports invalid severity enum value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleRecords-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify({
      required: ['key', 'severity', 'residualVerdict', 'bugVisibleTo', 'weaknessClassSource', 'lifecycleStatus'],
      properties: {
        severity: { enum: ['low', 'medium', 'high'] },
        residualVerdict: { enum: ['clean', 'dirty'] },
        bugVisibleTo: { enum: ['user', 'admin'] },
        weaknessClassSource: { enum: ['cwe', 'custom'] },
        weaknessClass: { items: { pattern: '^CWE-\\d+$' } },
        cwxRef: { pattern: '^CW-\\d+$' }
      }
    }));
    const rec = {
      key: 'k1', severity: 'critical', residualVerdict: 'clean', bugVisibleTo: 'user',
      weaknessClassSource: 'cwe', lifecycleStatus: 'active'
    };
    const r = validateLifecycleRecords([rec], { baseDir: dir });
    assert.deepEqual(r, ["lifecycle[0] k1: severity 'critical' not in enum"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports non-object record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleRecords-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify({
      required: ['key', 'severity', 'residualVerdict', 'bugVisibleTo', 'weaknessClassSource', 'lifecycleStatus'],
      properties: {
        severity: { enum: ['low', 'medium', 'high'] },
        residualVerdict: { enum: ['clean', 'dirty'] },
        bugVisibleTo: { enum: ['user', 'admin'] },
        weaknessClassSource: { enum: ['cwe', 'custom'] },
        weaknessClass: { items: { pattern: '^CWE-\\d+$' } },
        cwxRef: { pattern: '^CW-\\d+$' }
      }
    }));
    const r = validateLifecycleRecords(['not-an-object'], { baseDir: dir });
    assert.deepEqual(r, ["lifecycle[0]: not an object"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports malformed cwxRef', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleRecords-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify({
      required: ['key', 'severity', 'residualVerdict', 'bugVisibleTo', 'weaknessClassSource', 'lifecycleStatus'],
      properties: {
        severity: { enum: ['low', 'medium', 'high'] },
        residualVerdict: { enum: ['clean', 'dirty'] },
        bugVisibleTo: { enum: ['user', 'admin'] },
        weaknessClassSource: { enum: ['cwe', 'custom'] },
        weaknessClass: { items: { pattern: '^CWE-\\d+$' } },
        cwxRef: { pattern: '^CW-\\d+$' }
      }
    }));
    const rec = {
      key: 'k1', severity: 'low', residualVerdict: 'clean', bugVisibleTo: 'user',
      weaknessClassSource: 'cwe', lifecycleStatus: 'active', cwxRef: 'BAD-REF'
    };
    const r = validateLifecycleRecords([rec], { baseDir: dir });
    assert.deepEqual(r, ["lifecycle[0] k1: cwxRef 'BAD-REF' malformed"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports scanProvenance ran=false with wrong lifecycleStatus', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleRecords-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify({
      required: ['key', 'severity', 'residualVerdict', 'bugVisibleTo', 'weaknessClassSource', 'lifecycleStatus'],
      properties: {
        severity: { enum: ['low', 'medium', 'high'] },
        residualVerdict: { enum: ['clean', 'dirty'] },
        bugVisibleTo: { enum: ['user', 'admin'] },
        weaknessClassSource: { enum: ['cwe', 'custom'] },
        weaknessClass: { items: { pattern: '^CWE-\\d+$' } },
        cwxRef: { pattern: '^CW-\\d+$' }
      }
    }));
    const rec = {
      key: 'k1', severity: 'low', residualVerdict: 'clean', bugVisibleTo: 'user',
      weaknessClassSource: 'cwe', lifecycleStatus: 'active',
      scanProvenance: { ran: false, at: '2024-01-01T00:00:00Z' }
    };
    const r = validateLifecycleRecords([rec], { baseDir: dir });
    assert.deepEqual(r, ["lifecycle[0] k1: scanProvenance.ran=false but lifecycleStatus='active' (must be unknown-not-scanned \u2014 never imply clean)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports weaknessClass populated with null source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleRecords-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify({
      required: ['key', 'severity', 'residualVerdict', 'bugVisibleTo', 'weaknessClassSource', 'lifecycleStatus'],
      properties: {
        severity: { enum: ['low', 'medium', 'high'] },
        residualVerdict: { enum: ['clean', 'dirty'] },
        bugVisibleTo: { enum: ['user', 'admin'] },
        weaknessClassSource: { enum: ['cwe', 'custom'] },
        weaknessClass: { items: { pattern: '^CWE-\\d+$' } },
        cwxRef: { pattern: '^CW-\\d+$' }
      }
    }));
    const rec = {
      key: 'k1', severity: 'low', residualVerdict: 'clean', bugVisibleTo: 'user',
      weaknessClassSource: null, lifecycleStatus: 'active', weaknessClass: ['CWE-79']
    };
    const r = validateLifecycleRecords([rec], { baseDir: dir });
    assert.deepEqual(r, ["lifecycle[0] k1: missing required 'weaknessClassSource'", "lifecycle[0] k1: weaknessClassSource 'null' not in enum", "lifecycle[0] k1: weaknessClass is populated but weaknessClassSource is null (a class with no stated provenance)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports invalid weaknessClass entry pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleRecords-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'lifecycle-record.schema.json'), JSON.stringify({
      required: ['key', 'severity', 'residualVerdict', 'bugVisibleTo', 'weaknessClassSource', 'lifecycleStatus'],
      properties: {
        severity: { enum: ['low', 'medium', 'high'] },
        residualVerdict: { enum: ['clean', 'dirty'] },
        bugVisibleTo: { enum: ['user', 'admin'] },
        weaknessClassSource: { enum: ['cwe', 'custom'] },
        weaknessClass: { items: { pattern: '^CWE-\\d+$' } },
        cwxRef: { pattern: '^CW-\\d+$' }
      }
    }));
    const rec = {
      key: 'k1', severity: 'low', residualVerdict: 'clean', bugVisibleTo: 'user',
      weaknessClassSource: 'cwe', lifecycleStatus: 'active', weaknessClass: ['INVALID']
    };
    const r = validateLifecycleRecords([rec], { baseDir: dir });
    assert.deepEqual(r, ["lifecycle[0] k1: weaknessClass entry 'INVALID' is not a CWE id"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
