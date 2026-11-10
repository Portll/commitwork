// Counts authz findings from a runtime file (monitor/lane-roster.mjs _authzTestCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _authzTestCounts } from '../lane-roster.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_authzTestCounts-'));
  try {
    const r = _authzTestCounts(dir, 'missing.json');
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object with ran true when file has invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_authzTestCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not valid json');
    const r = _authzTestCounts(dir, 'bad.json');
    assert.deepEqual(r, { total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object with ran true when file has empty content', () => {
  const dir = mkdtempSync(join(tmpdir(), '_authzTestCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), '');
    const r = _authzTestCounts(dir, 'empty.json');
    assert.deepEqual(r, { total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns findings object with ran true when file has valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_authzTestCounts-'));
  try {
    writeFileSync(join(dir, 'good.json'), '{"ok":true}');
    const r = _authzTestCounts(dir, 'good.json');
    assert.deepEqual(r, { total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when file exists but is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), '_authzTestCounts-'));
  try {
    const sub = join(dir, 'adir');
    mkdtempSync(sub);
    const r = _authzTestCounts(dir, 'adir');
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when file contains only whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), '_authzTestCounts-'));
  try {
    writeFileSync(join(dir, 'ws.json'), '   \n\t  ');
    const r = _authzTestCounts(dir, 'ws.json');
    assert.deepEqual(r, { total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
