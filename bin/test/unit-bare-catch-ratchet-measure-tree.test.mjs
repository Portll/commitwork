// Computes per-file bare-catch site counts and sorted site list (bin/bare-catch-ratchet.mjs measureTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureTree } from '../bare-catch-ratchet.mjs';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup(files) {
  const dir = mkdtempSync(join(tmpdir(), 'measureTree-'));
  for (const [rel, src] of Object.entries(files)) writeFileSync(join(dir, rel), src);
  return dir;
}

test('returns empty counts and sites when no files are provided', () => {
  const dir = setup({});
  try {
    const r = measureTree({ root: dir, files: [] });
    assert.deepEqual(r, { counts: {}, sites: [], files: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('counts a single bare catch in a function scope', () => {
  const dir = setup({ 'a.mjs': 'function f() { try { } catch { } }' });
  try {
    const r = measureTree({ root: dir, files: ['a.mjs'] });
    assert.deepEqual(r.counts, { 'a.mjs::f': 1 });
    assert.deepEqual(r.sites, [{ key: 'a.mjs::f', file: 'a.mjs', symbol: 'f', line: 1 }]);
    assert.deepEqual(r.files, ['a.mjs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('accumulates count for repeated identical catch sites', () => {
  const src = 'function f() { try { } catch { } try { } catch { } }';
  const dir = setup({ 'a.mjs': src });
  try {
    const r = measureTree({ root: dir, files: ['a.mjs'] });
    assert.deepEqual(r.counts, { 'a.mjs::f': 2 });
    assert.equal(r.sites.length, 2);
    assert.deepEqual(r.sites[0], { key: 'a.mjs::f', file: 'a.mjs', symbol: 'f', line: 1 });
    assert.deepEqual(r.sites[1], { key: 'a.mjs::f', file: 'a.mjs', symbol: 'f', line: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('skips files that vanish between walk and read', () => {
  const dir = setup({ 'a.mjs': 'function f() { try { } catch { } }' });
  try {
    const r = measureTree({ root: dir, files: ['a.mjs', 'gone.mjs'] });
    assert.deepEqual(r.counts, { 'a.mjs::f': 1 });
    assert.equal(r.sites.length, 1);
    assert.deepEqual(r.files, ['a.mjs', 'gone.mjs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('throws a descriptive error for permission-denied files', () => {
  const dir = setup({ 'a.mjs': 'function f() { try { } catch { } }' });
  try {
    chmodSync(join(dir, 'a.mjs'), 0o000);
    assert.throws(() => measureTree({ root: dir, files: ['a.mjs'] }),
      /a\.mjs: unreadable \(EACCES\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sorts sites by key then by line for equal keys', () => {
  const src = 'function f() { try { } catch { } try { } catch { } }\nfunction g() { try { } catch { } }';
  const dir = setup({ 'a.mjs': src });
  try {
    const r = measureTree({ root: dir, files: ['a.mjs'] });
    assert.deepEqual(r.counts, { 'a.mjs::f': 2, 'a.mjs::g': 1 });
    assert.deepEqual(r.sites.map(s => s.symbol), ['f', 'f', 'g']);
    assert.deepEqual(r.sites.map(s => s.line), [1, 1, 2]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sorts sites across files by key order', () => {
  const dir = setup({
    'b.mjs': 'function f() { try { } catch { } }',
    'a.mjs': 'function f() { try { } catch { } }',
  });
  try {
    const r = measureTree({ root: dir, files: ['b.mjs', 'a.mjs'] });
    assert.deepEqual(r.sites.map(s => s.file), ['a.mjs', 'b.mjs']);
    assert.deepEqual(r.sites.map(s => s.key), ['a.mjs::f', 'b.mjs::f']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns module symbol for top-level bare catch', () => {
  const dir = setup({ 'a.mjs': 'try { } catch { }' });
  try {
    const r = measureTree({ root: dir, files: ['a.mjs'] });
    assert.deepEqual(r.counts, { 'a.mjs::<module>': 1 });
    assert.deepEqual(r.sites, [{ key: 'a.mjs::<module>', file: 'a.mjs', symbol: '<module>', line: 1 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
