// Counts core, extension, and proposed guide words in the STPA-HazOP field guide lexicon table (bin/lib/docsite-figures.mjs lexicon).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lexicon } from '../lib/docsite-figures.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an error when the guide file cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicon-'));
  try {
    const result = lexicon({ root: dir, page: 'missing.md' });
    assert.deepEqual(result, { error: "missing.md could not be read (ENOENT)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error when the lexicon heading is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicon-'));
  try {
    writeFileSync(join(dir, 'guide.md'), 'no heading here\n');
    const result = lexicon({ root: dir, page: 'guide.md' });
    assert.deepEqual(result, { error: "guide.md has no \"### The lexicon\" heading, so its guide words cannot be counted" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error when the lexicon table has no guide word rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicon-'));
  try {
    writeFileSync(join(dir, 'guide.md'), '### The lexicon\n| a | b |\n');
    const result = lexicon({ root: dir, page: 'guide.md' });
    assert.deepEqual(result, { error: "guide.md's lexicon table has no core/extension/proposed rows" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a single core row immediately after the heading', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicon-'));
  try {
    writeFileSync(join(dir, 'guide.md'), '### The lexicon\n| core | x |\n');
    const result = lexicon({ root: dir, page: 'guide.md' });
    assert.deepEqual(result, { counts: { core: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts repeated rows of each kind until the next section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicon-'));
  try {
    const rows = [
      '| core | a |',
      '| core | b |',
      '| extension | c |',
      '| proposed | d |',
      '| core | e |',
      '| extension | f |',
    ];
    writeFileSync(join(dir, 'guide.md'), ['### The lexicon', ...rows, '## Next section'].join('\n'));
    const result = lexicon({ root: dir, page: 'guide.md' });
    assert.deepEqual(result, { counts: { core: 3, extension: 2, proposed: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stops counting at a level-3 heading inside the lexicon section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicon-'));
  try {
    writeFileSync(join(dir, 'guide.md'), ['### The lexicon', '| core | a |', '### Sub', '| core | b |'].join('\n'));
    const result = lexicon({ root: dir, page: 'guide.md' });
    assert.deepEqual(result, { counts: { core: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('continues counting past a level-2 heading inside the lexicon section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicon-'));
  try {
    writeFileSync(join(dir, 'guide.md'), ['### The lexicon', '| core | a |', '## Mid', '| core | b |'].join('\n'));
    const result = lexicon({ root: dir, page: 'guide.md' });
    assert.deepEqual(result, { counts: { core: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts rows with padded whitespace around the kind cell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lexicon-'));
  try {
    writeFileSync(join(dir, 'guide.md'), ['### The lexicon', '|  core  | x |', '| extension | y |'].join('\n'));
    const result = lexicon({ root: dir, page: 'guide.md' });
    assert.deepEqual(result, { counts: { core: 1, extension: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
