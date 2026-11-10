// Maps a check id to its appliesIfSourceExt array from the baseline manifest (monitor/codeql-coverage.mjs laneSourceExts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneSourceExts } from '../codeql-coverage.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the manifest path does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneSourceExts-'));
  try {
    const r = laneSourceExts('js:audit', { path: join(dir, 'missing.json') });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the manifest is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneSourceExts-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const r = laneSourceExts('js:audit', { path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the appliesIfSourceExt array for a known check id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneSourceExts-'));
  try {
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({ checks: [{ id: 'js:audit', appliesIfSourceExt: ['.js', '.mjs'] }] }));
    const r = laneSourceExts('js:audit', { path: p });
    assert.deepEqual(r, [".js", ".mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for a check id absent from the manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneSourceExts-'));
  try {
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({ checks: [{ id: 'js:audit', appliesIfSourceExt: ['.js'] }] }));
    const r = laneSourceExts('py:audit', { path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the known check has no appliesIfSourceExt property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneSourceExts-'));
  try {
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({ checks: [{ id: 'js:audit' }] }));
    const r = laneSourceExts('js:audit', { path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the manifest has no checks property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneSourceExts-'));
  try {
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({}));
    const r = laneSourceExts('js:audit', { path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when a check entry is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneSourceExts-'));
  try {
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({ checks: [null] }));
    const r = laneSourceExts('js:audit', { path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when a check entry has no id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneSourceExts-'));
  try {
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({ checks: [{ appliesIfSourceExt: ['.js'] }] }));
    const r = laneSourceExts('js:audit', { path: p });
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
