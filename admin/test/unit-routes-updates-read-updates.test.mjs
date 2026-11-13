// readUpdates reads the updates report file and returns parsed result or error info (admin/routes/updates.mjs readUpdates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUpdates } from '../routes/updates.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns not-run when updates file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: false,
      state: 'not-run',
      reason: 'no update scan yet \u2014 run `node monitor/update-vulns.mjs --json-out`, or press Refresh on the operator port'
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown not-permitted when file read fails with non-ENOENT error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  mkdirSync(file);
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: false,
      state: 'unknown',
      unknown: true,
      unknownReason: 'not-permitted',
      unknownDetail: `${file} is unreadable (EISDIR) \u2014 what this box can update is UNKNOWN, not nothing`
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown unparseable when file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  writeFileSync(file, '{ not valid json }', 'utf8');
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: false,
      state: 'unknown',
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${file} did not parse (Expected property name or '}' in JSON at position 2 (line 1 column 3)) \u2014 treat as corrupt, never as zero updates`
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown unparseable when JSON parse error spans multiple lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  writeFileSync(file, '{"managers": [', 'utf8');
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: false,
      state: 'unknown',
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${file} did not parse (Unexpected end of JSON input) \u2014 treat as corrupt, never as zero updates`
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown unparseable when JSON is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  writeFileSync(file, 'null', 'utf8');
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: false,
      state: 'unknown',
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${file} carries no managers[] \u2014 the format decides the field, and this is not it`
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown unparseable when JSON has no managers property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  writeFileSync(file, '{"other": "data"}', 'utf8');
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: false,
      state: 'unknown',
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${file} carries no managers[] \u2014 the format decides the field, and this is not it`
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown unparseable when managers is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  writeFileSync(file, '{"managers": {}}', 'utf8');
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: false,
      state: 'unknown',
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${file} carries no managers[] \u2014 the format decides the field, and this is not it`
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with document when JSON has managers array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  writeFileSync(file, '{"managers": [{"name": "npm"}]}', 'utf8');
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: true,
      managers: [{ name: 'npm' }]
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with document when managers array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readUpdates-'));
  const file = join(dir, 'updates.json');
  writeFileSync(file, '{"managers": []}', 'utf8');
  process.env.CW_UPDATES_OUT = file;
  try {
    const result = readUpdates();
    assert.deepEqual(result, {
      ok: true,
      managers: []
    });
  } finally {
    delete process.env.CW_UPDATES_OUT;
    rmSync(dir, { recursive: true, force: true });
  }
});
