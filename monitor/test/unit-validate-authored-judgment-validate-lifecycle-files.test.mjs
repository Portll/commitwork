// Validates lifecycle.json files under a reports root (monitor/validate-authored-judgment.mjs validateLifecycleFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLifecycleFiles } from '../validate-authored-judgment.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when reports root does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const r = validateLifecycleFiles(join(dir, 'no-such-root'));
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when reports root has no subdirectories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(root, { recursive: true });
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips subdirectory without lifecycle.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(join(root, 'proj-a'), { recursive: true });
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports unreadable lifecycle.json with parse error message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(join(root, 'proj-bad'), { recursive: true });
    writeFileSync(join(root, 'proj-bad', 'lifecycle.json'), '{invalid json');
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, ["proj-bad/lifecycle.json: unreadable (Expected property name or '}' in JSON at position 1 (line 1 column 2))"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when lifecycle.json has no records property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(join(root, 'proj-norec'), { recursive: true });
    writeFileSync(join(root, 'proj-norec', 'lifecycle.json'), JSON.stringify({ foo: 'bar' }));
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when lifecycle.json records is empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(join(root, 'proj-empty'), { recursive: true });
    writeFileSync(join(root, 'proj-empty', 'lifecycle.json'), JSON.stringify({ records: [] }));
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports violation for record with missing required field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(join(root, 'proj-missing'), { recursive: true });
    const rec = { key: 'k1', severity: 'high', residualVerdict: 'open', bugVisibleTo: 'user', weaknessClassSource: 'manual', weaknessClass: ['CWE-79'], cweIds: ['CWE-79'], cwxRef: 'CWX-001', lifecycleStatus: 'open', scanProvenance: { ran: true, at: '2024-01-01T00:00:00Z' } };
    delete rec.severity;
    writeFileSync(join(root, 'proj-missing', 'lifecycle.json'), JSON.stringify({ records: [rec] }));
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, ["proj-missing/lifecycle.json[0] k1: missing required 'primaryId'", "proj-missing/lifecycle.json[0] k1: missing required 'repo'", "proj-missing/lifecycle.json[0] k1: missing required 'severity'", "proj-missing/lifecycle.json[0] k1: residualVerdict 'open' not in enum", "proj-missing/lifecycle.json[0] k1: bugVisibleTo 'user' not in enum", "proj-missing/lifecycle.json[0] k1: weaknessClassSource 'manual' not in enum", "proj-missing/lifecycle.json[0] k1: cwxRef 'CWX-001' malformed"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports violation for record with invalid severity enum value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(join(root, 'proj-badsev'), { recursive: true });
    const rec = { key: 'k2', severity: 'not-a-sev', residualVerdict: 'open', bugVisibleTo: 'user', weaknessClassSource: 'manual', weaknessClass: ['CWE-79'], cweIds: ['CWE-79'], cwxRef: 'CWX-001', lifecycleStatus: 'open', scanProvenance: { ran: true, at: '2024-01-01T00:00:00Z' } };
    writeFileSync(join(root, 'proj-badsev', 'lifecycle.json'), JSON.stringify({ records: [rec] }));
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, ["proj-badsev/lifecycle.json[0] k2: missing required 'primaryId'", "proj-badsev/lifecycle.json[0] k2: missing required 'repo'", "proj-badsev/lifecycle.json[0] k2: severity 'not-a-sev' not in enum", "proj-badsev/lifecycle.json[0] k2: residualVerdict 'open' not in enum", "proj-badsev/lifecycle.json[0] k2: bugVisibleTo 'user' not in enum", "proj-badsev/lifecycle.json[0] k2: weaknessClassSource 'manual' not in enum", "proj-badsev/lifecycle.json[0] k2: cwxRef 'CWX-001' malformed"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports violation when scanProvenance.ran is false but lifecycleStatus is not unknown-not-scanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(join(root, 'proj-ranfalse'), { recursive: true });
    const rec = { key: 'k3', severity: 'low', residualVerdict: 'open', bugVisibleTo: 'user', weaknessClassSource: 'manual', weaknessClass: ['CWE-79'], cweIds: ['CWE-79'], cwxRef: 'CWX-001', lifecycleStatus: 'open', scanProvenance: { ran: false, at: '2024-01-01T00:00:00Z' } };
    writeFileSync(join(root, 'proj-ranfalse', 'lifecycle.json'), JSON.stringify({ records: [rec] }));
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, ["proj-ranfalse/lifecycle.json[0] k3: missing required 'primaryId'", "proj-ranfalse/lifecycle.json[0] k3: missing required 'repo'", "proj-ranfalse/lifecycle.json[0] k3: residualVerdict 'open' not in enum", "proj-ranfalse/lifecycle.json[0] k3: bugVisibleTo 'user' not in enum", "proj-ranfalse/lifecycle.json[0] k3: weaknessClassSource 'manual' not in enum", "proj-ranfalse/lifecycle.json[0] k3: cwxRef 'CWX-001' malformed", "proj-ranfalse/lifecycle.json[0] k3: scanProvenance.ran=false but lifecycleStatus='open' (must be unknown-not-scanned \u2014 never imply clean)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports violation when weaknessClass is populated but weaknessClassSource is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateLifecycleFiles-'));
  try {
    const root = join(dir, 'reports');
    mkdirSync(join(root, 'proj-nullsrc'), { recursive: true });
    const rec = { key: 'k4', severity: 'low', residualVerdict: 'open', bugVisibleTo: 'user', weaknessClassSource: null, weaknessClass: ['CWE-79'], cweIds: ['CWE-79'], cwxRef: 'CWX-001', lifecycleStatus: 'open', scanProvenance: { ran: true, at: '2024-01-01T00:00:00Z' } };
    writeFileSync(join(root, 'proj-nullsrc', 'lifecycle.json'), JSON.stringify({ records: [rec] }));
    const r = validateLifecycleFiles(root);
    assert.deepEqual(r, ["proj-nullsrc/lifecycle.json[0] k4: missing required 'primaryId'", "proj-nullsrc/lifecycle.json[0] k4: missing required 'repo'", "proj-nullsrc/lifecycle.json[0] k4: residualVerdict 'open' not in enum", "proj-nullsrc/lifecycle.json[0] k4: bugVisibleTo 'user' not in enum", "proj-nullsrc/lifecycle.json[0] k4: weaknessClass is populated but weaknessClassSource is null (a class with no stated provenance)", "proj-nullsrc/lifecycle.json[0] k4: cwxRef 'CWX-001' malformed"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
