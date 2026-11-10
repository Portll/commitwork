// Parsed launchlist state, or an empty default when the file is absent or null (lib/launchlist.mjs loadState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from '../launchlist.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadState-'));
  const prev = process.env.CW_LAUNCHLIST_DIR;
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    const path = join(dir, 'state.json');
    if (content !== undefined) writeFileSync(path, content);
    fn(path);
  } finally {
    if (prev === undefined) delete process.env.CW_LAUNCHLIST_DIR;
    else process.env.CW_LAUNCHLIST_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const missing = (path) => ({ name: 'Error', message: `launchlist: ${path} is missing ticks/items/log` });

test('returns the empty state when the state file does not exist', () => {
  withDir(undefined, () => {
    assert.deepEqual(loadState(), { version: 1, ticks: {}, items: {}, log: [] });
  });
});

test('returns the parsed object unchanged when ticks, items and log are all valid', () => {
  const state = { version: 1, ticks: { a: 1 }, items: { b: 2 }, log: [1, 2] };
  withDir(JSON.stringify(state), () => {
    assert.deepEqual(loadState(), { version: 1, ticks: { a: 1 }, items: { b: 2 }, log: [1, 2] });
  });
});

test('returns the stored object rather than a default when its fields are empty but present', () => {
  const state = { version: 7, ticks: {}, items: {}, log: [] };
  withDir(JSON.stringify(state), () => {
    assert.deepEqual(loadState(), { version: 7, ticks: {}, items: {}, log: [] });
  });
});

test('returns the empty state when the state file contains JSON null', () => {
  withDir('null', () => {
    assert.deepEqual(loadState(), { version: 1, ticks: {}, items: {}, log: [] });
  });
});

test('throws when ticks is missing even though items and log are valid', () => {
  withDir(JSON.stringify({ version: 1, items: { y: 1 }, log: [] }), (path) => {
    assert.throws(() => loadState(), missing(path));
  });
});

test('throws when items is missing even though ticks and log are valid', () => {
  withDir(JSON.stringify({ version: 1, ticks: { x: 1 }, log: [] }), (path) => {
    assert.throws(() => loadState(), missing(path));
  });
});

test('throws when log is a string instead of an array', () => {
  withDir(JSON.stringify({ version: 1, ticks: {}, items: {}, log: 'nope' }), (path) => {
    assert.throws(() => loadState(), missing(path));
  });
});

test('throws when both ticks and items are null', () => {
  withDir(JSON.stringify({ version: 1, ticks: null, items: null, log: [] }), (path) => {
    assert.throws(() => loadState(), missing(path));
  });
});

test('throws a not valid JSON error when the state file cannot be parsed', () => {
  const raw = '{"ticks":';
  let parseMsg = '';
  try { JSON.parse(raw); } catch (e) { parseMsg = e.message; }
  withDir(raw, (path) => {
    assert.throws(() => loadState(), { name: 'Error', message: `launchlist: ${path} is not valid JSON: ${parseMsg}` });
  });
});
