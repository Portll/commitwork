// Loads the velocity allowlist JSON, returning its entries or an unreadable marker (bin/commit-velocity.mjs loadAllowlist).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAllowlist } from '../commit-velocity.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty entries when the allowlist file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAllowlist-'));
  try {
    const missing = join(dir, 'nope.json');
    const out = loadAllowlist({ CW_VELOCITY_ALLOWLIST: missing });
    assert.deepEqual(out, { entries: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unreadable marker naming the file when its content is a bare non-JSON token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAllowlist-'));
  try {
    const p = join(dir, 'secret.json');
    writeFileSync(p, 'x');
    const out = loadAllowlist({ CW_VELOCITY_ALLOWLIST: p, CW_VELOCITY_ALLOWLIST_SCHEMA: join(dir, 'schema.json') });
    assert.equal(typeof out.unreadable, 'string');
    assert.ok(out.unreadable.includes(p));
    assert.deepEqual(out.entries, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable marker when the allowlist is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAllowlist-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    const out = loadAllowlist({ CW_VELOCITY_ALLOWLIST: p, CW_VELOCITY_ALLOWLIST_SCHEMA: join(dir, 'schema.json') });
    assert.equal(out.unreadable, `${p}: not JSON`);
    assert.deepEqual(out.entries, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable marker when the allowlist fails the schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAllowlist-'));
  try {
    const p = join(dir, 'doc.json');
    writeFileSync(p, JSON.stringify({ allow: 'not-an-array' }));
    const schema = join(dir, 'schema.json');
    writeFileSync(schema, JSON.stringify({ type: 'object', properties: { allow: { type: 'array' } }, required: ['allow'] }));
    const out = loadAllowlist({ CW_VELOCITY_ALLOWLIST: p, CW_VELOCITY_ALLOWLIST_SCHEMA: schema });
    assert.equal(typeof out.unreadable, 'string');
    assert.ok(out.unreadable.includes('fails schema'));
    assert.deepEqual(out.entries, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the allow entries when the allowlist is valid and passes the schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAllowlist-'));
  try {
    const p = join(dir, 'doc.json');
    const entries = [{ name: 'alice' }, { name: 'bob' }];
    writeFileSync(p, JSON.stringify({ allow: entries }));
    const schema = join(dir, 'schema.json');
    writeFileSync(schema, JSON.stringify({ type: 'object', properties: { allow: { type: 'array' } }, required: ['allow'] }));
    const out = loadAllowlist({ CW_VELOCITY_ALLOWLIST: p, CW_VELOCITY_ALLOWLIST_SCHEMA: schema });
    assert.deepEqual(out, { entries });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty entries when the allowlist is valid JSON with an empty allow array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAllowlist-'));
  try {
    const p = join(dir, 'doc.json');
    writeFileSync(p, JSON.stringify({ allow: [] }));
    const schema = join(dir, 'schema.json');
    writeFileSync(schema, JSON.stringify({ type: 'object', properties: { allow: { type: 'array' } }, required: ['allow'] }));
    const out = loadAllowlist({ CW_VELOCITY_ALLOWLIST: p, CW_VELOCITY_ALLOWLIST_SCHEMA: schema });
    assert.deepEqual(out, { entries: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
