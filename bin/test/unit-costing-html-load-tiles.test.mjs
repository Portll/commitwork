// Reads a JSON file of tiles and normalizes each to value, label and boolean emphasis (bin/costing-html.mjs loadTiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTiles } from '../costing-html.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when file is null or an empty string', () => {
  assert.deepEqual(loadTiles(null), []);
  assert.deepEqual(loadTiles(''), []);
});

test('parses a valid tile array and keeps emphasis only when it is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadTiles-'));
  try {
    const f = join(dir, 'tiles.json');
    writeFileSync(f, JSON.stringify([
      { value: 'a', label: 'A', emphasis: true },
      { value: 'b', label: 'B', emphasis: false },
      { value: 'c', label: 'C' }
    ]));
    assert.deepEqual(loadTiles(f), [
      { value: 'a', label: 'A', emphasis: true },
      { value: 'b', label: 'B', emphasis: false },
      { value: 'c', label: 'C', emphasis: false }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array for a file holding an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadTiles-'));
  try {
    const f = join(dir, 'empty.json');
    writeFileSync(f, '[]');
    assert.deepEqual(loadTiles(f), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file does not parse as JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadTiles-'));
  try {
    const f = join(dir, 'bad.json');
    writeFileSync(f, 'not json');
    let parseMsg = '';
    try { JSON.parse('not json'); } catch (e) { parseMsg = e.message; }
    assert.throws(() => loadTiles(f), {
      name: 'Error',
      message: `costing-html: ${f} does not parse (${parseMsg})`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed JSON is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadTiles-'));
  try {
    const f = join(dir, 'obj.json');
    writeFileSync(f, JSON.stringify({ value: 'x', label: 'X' }));
    assert.throws(() => loadTiles(f), {
      name: 'Error',
      message: `costing-html: ${f} must hold an array of tiles`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when a tile is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadTiles-'));
  try {
    const f = join(dir, 'null-tile.json');
    writeFileSync(f, JSON.stringify([null]));
    assert.throws(() => loadTiles(f), {
      name: 'Error',
      message: `costing-html: tile 0 in ${f} needs a string value and label`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when a tile value is not a string even though its label is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadTiles-'));
  try {
    const f = join(dir, 'bad-value.json');
    writeFileSync(f, JSON.stringify([{ value: 42, label: 'L' }]));
    assert.throws(() => loadTiles(f), {
      name: 'Error',
      message: `costing-html: tile 0 in ${f} needs a string value and label`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws naming the index of the second tile when its label is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadTiles-'));
  try {
    const f = join(dir, 'bad-label.json');
    writeFileSync(f, JSON.stringify([{ value: 'ok', label: 'OK' }, { value: 'V', label: 7 }]));
    assert.throws(() => loadTiles(f), {
      name: 'Error',
      message: `costing-html: tile 1 in ${f} needs a string value and label`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets emphasis to false when emphasis is truthy but not strictly true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadTiles-'));
  try {
    const f = join(dir, 'emph.json');
    writeFileSync(f, JSON.stringify([
      { value: 'x', label: 'X', emphasis: 1 },
      { value: 'y', label: 'Y', emphasis: 'true' }
    ]));
    assert.deepEqual(loadTiles(f), [
      { value: 'x', label: 'X', emphasis: false },
      { value: 'y', label: 'Y', emphasis: false }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
