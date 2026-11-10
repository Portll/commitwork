// Whether a check result is storable (bin/lib/lane-reuse.mjs storable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storable } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns false when result is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storable-'));
  try {
    const check = { report: { file: 'r.sarif' } };
    const r = storable(check, null, dir);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when result status is fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storable-'));
  try {
    const check = { report: { file: 'r.sarif' } };
    const result = { status: 'fail' };
    const r = storable(check, result, dir);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when check has no report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storable-'));
  try {
    const check = {};
    const result = { status: 'pass' };
    const r = storable(check, result, dir);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when report file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storable-'));
  try {
    const check = { report: { file: 'r.sarif' } };
    const result = { status: 'pass' };
    const r = storable(check, result, dir);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when report file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storable-'));
  try {
    const check = { report: { file: 'r.sarif' } };
    const result = { status: 'pass' };
    writeFileSync(join(dir, 'r.sarif'), '');
    const r = storable(check, result, dir);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when report exists and exit file is 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storable-'));
  try {
    const check = { report: { file: 'r.sarif' } };
    const result = { status: 'pass' };
    writeFileSync(join(dir, 'r.sarif'), 'x');
    writeFileSync(join(dir, 'r.sarif.exit'), '0');
    const r = storable(check, result, dir);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when exit file is 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storable-'));
  try {
    const check = { report: { file: 'r.sarif' } };
    const result = { status: 'pass' };
    writeFileSync(join(dir, 'r.sarif'), 'x');
    writeFileSync(join(dir, 'r.sarif.exit'), '1');
    const r = storable(check, result, dir);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when exit file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storable-'));
  try {
    const check = { report: { file: 'r.sarif' } };
    const result = { status: 'pass' };
    writeFileSync(join(dir, 'r.sarif'), 'x');
    const r = storable(check, result, dir);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
