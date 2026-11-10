// Counts npm audit findings for a lane roster (monitor/lane-roster.mjs _npmAuditCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _npmAuditCounts } from '../lane-roster.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_npmAuditCounts-'));
  try {
    const r = _npmAuditCounts(dir, 'missing.json');
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when file exists but parse fails', () => {
  const dir = mkdtempSync(join(tmpdir(), '_npmAuditCounts-'));
  try {
    writeFileSync(join(dir, 'audit.json'), 'not valid json');
    const r = _npmAuditCounts(dir, 'audit.json');
    assert.deepEqual(r, { total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns findings object when file exists and parses successfully', () => {
  const dir = mkdtempSync(join(tmpdir(), '_npmAuditCounts-'));
  try {
    writeFileSync(join(dir, 'audit.json'), JSON.stringify({ vulnerabilities: { moderate: { count: 2 } } }));
    const r = _npmAuditCounts(dir, 'audit.json');
    assert.deepEqual(r, { total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when file path is empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), '_npmAuditCounts-'));
  try {
    const r = _npmAuditCounts(dir, '');
    assert.deepEqual(r, { total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when file exists with empty content', () => {
  const dir = mkdtempSync(join(tmpdir(), '_npmAuditCounts-'));
  try {
    writeFileSync(join(dir, 'audit.json'), '');
    const r = _npmAuditCounts(dir, 'audit.json');
    assert.deepEqual(r, { total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
