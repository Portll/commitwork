// Picks the memory database path from env overrides or the default (bin/memory-query.mjs localDbPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { localDbPath } from '../memory-query.mjs';

test('returns CW_MEMORY_DB when both CW_MEMORY_DB and CW_DB are set', () => {
  const r = localDbPath({ env: { CW_MEMORY_DB: '/mem.db', CW_DB: '/db.db' } });
  assert.equal(r, '/mem.db');
});

test('returns CW_DB when CW_MEMORY_DB is empty and CW_DB is set', () => {
  const r = localDbPath({ env: { CW_MEMORY_DB: '', CW_DB: '/db.db' } });
  assert.equal(r, '/db.db');
});

test('returns CW_MEMORY_DB when it is set and CW_DB is empty', () => {
  const r = localDbPath({ env: { CW_MEMORY_DB: '/mem.db', CW_DB: '' } });
  assert.equal(r, '/mem.db');
});

test('returns CW_MEMORY_DB when it is set and CW_DB is undefined', () => {
  const r = localDbPath({ env: { CW_MEMORY_DB: '/mem.db' } });
  assert.equal(r, '/mem.db');
});

test('returns CW_DB when CW_MEMORY_DB is undefined and CW_DB is set', () => {
  const r = localDbPath({ env: { CW_DB: '/db.db' } });
  assert.equal(r, '/db.db');
});

test('falls back to the default memory.db path when neither variable is defined', () => {
  const r = localDbPath({ env: {} });
  assert.equal(path.basename(r), 'memory.db');
});

test('falls back to the default memory.db path when both variables are empty strings', () => {
  const r = localDbPath({ env: { CW_MEMORY_DB: '', CW_DB: '' } });
  assert.equal(path.basename(r), 'memory.db');
});

test('returns CW_MEMORY_DB when it is a single space and CW_DB is set', () => {
  const r = localDbPath({ env: { CW_MEMORY_DB: ' ', CW_DB: '/db.db' } });
  assert.equal(r, ' ');
});
