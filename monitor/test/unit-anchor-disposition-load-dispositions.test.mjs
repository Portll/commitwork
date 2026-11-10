// Loads the dispositions JSON document from a file path (monitor/anchor-disposition.mjs loadDispositions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDispositions } from '../anchor-disposition.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EMPTY_NOTE = 'Human rulings on drifted audit anchors \u2014 whether the finding was FIXED or merely moved. '
  + 'Append-only; each ruling carries the evidence digest it was made against and goes stale '
  + 'when that evidence changes. Written by the panel; never edit by hand.';

test('returns empty dispositions doc when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDispositions-'));
  try {
    const p = join(dir, 'missing.json');
    assert.equal(existsSync(p), false);
    const r = loadDispositions(p);
    assert.deepEqual(r, { note: EMPTY_NOTE, version: 1, rulings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed doc when file contains valid rulings array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDispositions-'));
  try {
    const p = join(dir, 'valid.json');
    const doc = { version: 1, rulings: [{ id: 'a1' }] };
    writeFileSync(p, JSON.stringify(doc), 'utf8');
    const r = loadDispositions(p);
    assert.deepEqual(r, { version: 1, rulings: [{ id: 'a1' }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file is unreadable due to permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDispositions-'));
  try {
    const p = join(dir, 'noperm.json');
    writeFileSync(p, '{}', { mode: 0o000 });
    assert.throws(() => loadDispositions(p), {
      name: 'Error',
      message: `dispositions unreadable at ${p}: EACCES`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file contains unparseable JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDispositions-'));
  try {
    const p = join(dir, 'corrupt.json');
    writeFileSync(p, '{not valid json', 'utf8');
    assert.throws(() => loadDispositions(p), {
      name: 'Error',
      message: `dispositions at ${p} is corrupt (unparseable JSON)`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when doc is null after parsing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDispositions-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null', 'utf8');
    assert.throws(() => loadDispositions(p), {
      name: 'Error',
      message: `dispositions at ${p} has no rulings[] \u2014 unrecognised shape`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when doc has no rulings property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDispositions-'));
  try {
    const p = join(dir, 'norulings.json');
    writeFileSync(p, '{"version":1}', 'utf8');
    assert.throws(() => loadDispositions(p), {
      name: 'Error',
      message: `dispositions at ${p} has no rulings[] \u2014 unrecognised shape`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when rulings is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDispositions-'));
  try {
    const p = join(dir, 'badrulings.json');
    writeFileSync(p, '{"rulings":"notarray"}', 'utf8');
    assert.throws(() => loadDispositions(p), {
      name: 'Error',
      message: `dispositions at ${p} has no rulings[] \u2014 unrecognised shape`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns doc with empty rulings array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDispositions-'));
  try {
    const p = join(dir, 'emptyrulings.json');
    writeFileSync(p, '{"rulings":[]}', 'utf8');
    const r = loadDispositions(p);
    assert.deepEqual(r, { rulings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
