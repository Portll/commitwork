// Resolves a session query to roster rows by name, ref, id, or id prefix (bin/session-roster.mjs resolve).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../session-roster.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array for empty query', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  try {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, '');
    const r = resolve('', { path: p });
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array for null query', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  try {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, '');
    const r = resolve(null, { path: p });
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches row by name with commitwork prefix stripped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  try {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, JSON.stringify({ name: 'alpha', ref: 'main', id: 'a1b2c3d4e5f6' }) + '\n');
    const r = resolve('commitwork-alpha', { path: p });
    assert.deepEqual(r, [{ name: "alpha", ref: "main", id: "a1b2c3d4e5f6" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches row by ref', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  try {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, JSON.stringify({ name: 'beta', ref: 'feature-x', id: 'b2c3d4e5f6a7' }) + '\n');
    const r = resolve('feature-x', { path: p });
    assert.deepEqual(r, [{ name: "beta", ref: "feature-x", id: "b2c3d4e5f6a7" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches row by full id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  try {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, JSON.stringify({ name: 'gamma', ref: 'main', id: 'c3d4e5f6a7b8' }) + '\n');
    const r = resolve('c3d4e5f6a7b8', { path: p });
    assert.deepEqual(r, [{ name: "gamma", ref: "main", id: "c3d4e5f6a7b8" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches row by 8 char id prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  try {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, JSON.stringify({ name: 'delta', ref: 'main', id: 'd4e5f6a7b8c9' }) + '\n');
    const r = resolve('d4e5f6a7', { path: p });
    assert.deepEqual(r, [{ name: "delta", ref: "main", id: "d4e5f6a7b8c9" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when no row matches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  try {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, JSON.stringify({ name: 'epsilon', ref: 'main', id: 'e5f6a7b8c9d0' }) + '\n');
    const r = resolve('zzzzzzzz', { path: p });
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches row by name with cw prefix stripped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  try {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, JSON.stringify({ name: 'zeta', ref: 'main', id: 'f6a7b8c9d0e1' }) + '\n');
    const r = resolve('cw-zeta', { path: p });
    assert.deepEqual(r, [{ name: "zeta", ref: "main", id: "f6a7b8c9d0e1" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
