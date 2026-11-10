// Reads, parses, and validates a bola manifest file, returning the validated object (bin/bola-run.mjs loadManifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest } from '../bola-run.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadManifest-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function write(dir, name, obj) {
  const p = join(dir, name);
  writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return p;
}

test('returns the manifest object when it is valid', () => withTmp((dir) => {
  const m = { actors: [{ name: 'a', role: 'user' }], objects: { model: 'seed', types: [{ create: { path: '/x' }, idPath: 'id', getPath: '/x/{id}' }] } };
  const p = write(dir, 'm.json', m);
  assert.deepEqual(loadManifest(p), m);
}));

test('unwraps a nested bola block when present', () => withTmp((dir) => {
  const inner = { actors: [{ name: 'a' }], objects: { model: 'seed', types: [{ create: { path: '/x' }, idPath: 'id', getPath: '/x/{id}' }] } };
  const p = write(dir, 'm.json', { bola: inner, extra: 1 });
  assert.deepEqual(loadManifest(p), inner);
}));

test('throws when the file cannot be read', () => withTmp((dir) => {
  const p = join(dir, 'missing.json');
  assert.throws(() => loadManifest(p), (e) => {
    assert.match(e.message, new RegExp(`^cannot read manifest ${p}: `));
    return true;
  });
}));

test('throws when the file is not valid JSON', () => withTmp((dir) => {
  const p = write(dir, 'bad.json', '{not json');
  assert.throws(() => loadManifest(p), (e) => {
    assert.match(e.message, new RegExp(`^manifest ${p} is not valid JSON: `));
    return true;
  });
}));

test('throws when the manifest is invalid', () => withTmp((dir) => {
  const p = write(dir, 'm.json', { actors: [] });
  assert.throws(() => loadManifest(p), (e) => {
    assert.match(e.message, new RegExp(`^manifest ${p} is invalid:`));
    return true;
  });
}));

test('keeps the top-level object when bola is absent', () => withTmp((dir) => {
  const m = { actors: [{ name: 'a' }], objects: { model: 'seed', types: [{ create: { path: '/x' }, idPath: 'id', getPath: '/x/{id}' }] } };
  const p = write(dir, 'm.json', m);
  assert.deepEqual(loadManifest(p), m);
}));

test('does not unwrap when bola is a non-object truthy value', () => withTmp((dir) => {
  const m = { bola: 42, actors: [{ name: 'a' }], objects: { model: 'seed', types: [{ create: { path: '/x' }, idPath: 'id', getPath: '/x/{id}' }] } };
  const p = write(dir, 'm.json', m);
  assert.deepEqual(loadManifest(p), m);
}));

test('does not unwrap when bola is a non-object falsy value', () => withTmp((dir) => {
  const m = { bola: null, actors: [{ name: 'a' }], objects: { model: 'seed', types: [{ create: { path: '/x' }, idPath: 'id', getPath: '/x/{id}' }] } };
  const p = write(dir, 'm.json', m);
  assert.deepEqual(loadManifest(p), m);
}));
