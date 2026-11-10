// Writes a note file under the launchlist notes directory and returns its relative path (lib/launchlist.mjs spillNote).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spillNote } from '../launchlist.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the relative path for a simple note', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spillNote-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    const r = spillNote('proj', 'item1', 'hello');
    assert.equal(r, "notes/proj/item1-2cf24dba5fb0.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_LAUNCHLIST_DIR;
  }
});

test('appends a newline when the note does not end with one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spillNote-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    const r = spillNote('proj', 'item1', 'no-newline');
    assert.equal(readFileSync(join(dir, r), 'utf8'), "no-newline\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_LAUNCHLIST_DIR;
  }
});

test('preserves the trailing newline when the note already ends with one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spillNote-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    const r = spillNote('proj', 'item1', 'with-newline\n');
    assert.equal(readFileSync(join(dir, r), 'utf8'), "with-newline\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_LAUNCHLIST_DIR;
  }
});

test('uses the first 12 hex characters of the sha256 digest in the filename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spillNote-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    const r = spillNote('proj', 'item1', 'digest-check');
    assert.equal(r, "notes/proj/item1-f73e9cdf3e53.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_LAUNCHLIST_DIR;
  }
});

test('throws when the project slug contains a dot-dot sequence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spillNote-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    assert.throws(() => spillNote('a..b', 'item1', 'note'), { name: "Error", message: "launchlist: not a project slug: \"a..b\"" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_LAUNCHLIST_DIR;
  }
});

test('throws when the project slug starts with a hyphen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spillNote-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    assert.throws(() => spillNote('-bad', 'item1', 'note'), { name: "Error", message: "launchlist: not a project slug: \"-bad\"" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_LAUNCHLIST_DIR;
  }
});

test('throws when the item id is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spillNote-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    assert.throws(() => spillNote('proj', '', 'note'), { name: "Error", message: "launchlist: not a project slug: \"\"" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_LAUNCHLIST_DIR;
  }
});

test('creates nested directories when the launchlist directory does not exist yet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spillNote-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'deep', 'nested');
    const r = spillNote('proj', 'item1', 'nested');
    assert.equal(r, "notes/proj/item1-233562de1a02.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_LAUNCHLIST_DIR;
  }
});
