// Appends a validated disregard record to a register file, refusing duplicates (monitor/disregarded-warnings.mjs appendDisregard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendDisregard } from '../disregarded-warnings.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns validation error when source is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const res = appendDisregard(join(dir, 'reg', 'disregards.json'), {
      code: 'C', subject: 's', why: 'w', who: 'u', at: '2024-01-01T00:00:00Z'
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /source must be a token/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns validation error when code is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const res = appendDisregard(join(dir, 'reg', 'disregards.json'), {
      source: 'S', subject: 's', why: 'w', who: 'u', at: '2024-01-01T00:00:00Z'
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /code must be a token/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns validation error when subject is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const res = appendDisregard(join(dir, 'reg', 'disregards.json'), {
      source: 'S', code: 'C', why: 'w', who: 'u', at: '2024-01-01T00:00:00Z'
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /subject is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns validation error when why is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const res = appendDisregard(join(dir, 'reg', 'disregards.json'), {
      source: 'S', code: 'C', subject: 's', why: '   ', who: 'u', at: '2024-01-01T00:00:00Z'
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /why is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns validation error when who is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const res = appendDisregard(join(dir, 'reg', 'disregards.json'), {
      source: 'S', code: 'C', subject: 's', why: 'w', at: '2024-01-01T00:00:00Z'
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /who is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns validation error when at is not a valid ISO timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const res = appendDisregard(join(dir, 'reg', 'disregards.json'), {
      source: 'S', code: 'C', subject: 's', why: 'w', who: 'u', at: 'not-a-date'
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /at must be an ISO timestamp/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns validation error when line is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const res = appendDisregard(join(dir, 'reg', 'disregards.json'), {
      source: 'S', code: 'C', subject: 's', why: 'w', who: 'u', at: '2024-01-01T00:00:00Z', line: 5
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /line is not part of a warning/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns error when register directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    const res = appendDisregard(join(dir, 'nonexistent', 'disregards.json'), {
      source: 'S', code: 'C', subject: 's', why: 'w', who: 'u', at: '2024-01-01T00:00:00Z'
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /unavailable \(ENOENT\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appends record to empty register and returns appended true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const regPath = join(dir, 'reg', 'disregards.json');
    writeFileSync(regPath, JSON.stringify({ disregarded: [] }, null, 2) + '\n');
    const rec = {
      source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js',
      why: 'legacy code', who: 'alice', at: '2024-01-01T00:00:00Z'
    };
    const res = appendDisregard(regPath, rec);
    assert.equal(res.ok, true);
    assert.equal(res.appended, true);
    assert.equal(res.key, 'eslint:no-unused-vars|src/app.js');
    assert.equal(res.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns appended false when duplicate record exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendDisregard-'));
  try {
    mkdirSync(join(dir, 'reg'), { recursive: true });
    const regPath = join(dir, 'reg', 'disregards.json');
    const existing = {
      source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js',
      why: 'legacy code', who: 'alice', at: '2024-01-01T00:00:00.000Z'
    };
    writeFileSync(regPath, JSON.stringify({ disregarded: [existing] }, null, 2) + '\n');
    const rec = {
      source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js',
      why: 'legacy code', who: 'alice', at: '2024-01-01T00:00:00Z'
    };
    const res = appendDisregard(regPath, rec);
    assert.equal(res.ok, true);
    assert.equal(res.appended, false);
    assert.equal(res.key, 'eslint:no-unused-vars|src/app.js');
    assert.equal(res.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
