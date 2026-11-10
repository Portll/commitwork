// getAllRules computes the per-table rule rows for every declared sweep rule table (monitor/settings.mjs getAllRules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAllRules } from '../settings.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('getAllRules returns an object with one entry per declared rule table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'getAllRules-'));
  try {
    const r = getAllRules();
    assert.deepEqual(r, { hang: { ok: true, rows: [], error: null }, kill: { ok: true, rows: [], error: null }, cadence: { ok: true, rows: [], error: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getAllRules returns empty rows arrays when the settings store is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'getAllRules-'));
  try {
    const r = getAllRules();
    assert.deepEqual(r, { hang: { ok: true, rows: [], error: null }, kill: { ok: true, rows: [], error: null }, cadence: { ok: true, rows: [], error: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getAllRules returns empty rows arrays when the store has no rules field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'getAllRules-'));
  try {
    const r = getAllRules();
    assert.deepEqual(r, { hang: { ok: true, rows: [], error: null }, kill: { ok: true, rows: [], error: null }, cadence: { ok: true, rows: [], error: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getAllRules returns empty rows arrays when rules is an object with no table keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'getAllRules-'));
  try {
    const r = getAllRules();
    assert.deepEqual(r, { hang: { ok: true, rows: [], error: null }, kill: { ok: true, rows: [], error: null }, cadence: { ok: true, rows: [], error: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getAllRules returns empty rows arrays when a table key holds a non-array value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'getAllRules-'));
  try {
    const r = getAllRules();
    assert.deepEqual(r, { hang: { ok: true, rows: [], error: null }, kill: { ok: true, rows: [], error: null }, cadence: { ok: true, rows: [], error: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getAllRules returns the stored rows for tables that have arrays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'getAllRules-'));
  try {
    const r = getAllRules();
    assert.deepEqual(r, { hang: { ok: true, rows: [], error: null }, kill: { ok: true, rows: [], error: null }, cadence: { ok: true, rows: [], error: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getAllRules returns empty rows arrays when the store file is unparseable JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'getAllRules-'));
  try {
    const r = getAllRules();
    assert.deepEqual(r, { hang: { ok: true, rows: [], error: null }, kill: { ok: true, rows: [], error: null }, cadence: { ok: true, rows: [], error: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getAllRules returns empty rows arrays when the store root is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'getAllRules-'));
  try {
    const r = getAllRules();
    assert.deepEqual(r, { hang: { ok: true, rows: [], error: null }, kill: { ok: true, rows: [], error: null }, cadence: { ok: true, rows: [], error: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
