// Memory store record, byte and per-adapter receipt counts (lib/memory-store.mjs stats).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stats } from '../memory-store.mjs';
import { open } from '../memory-store.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fakeDb = (rec, rows) => ({ prepare: () => ({ get: () => rec, all: () => rows }) });
const bucket = (o) => ({ total: 0, verified: 0, acceptedUnverified: 0, failed: 0, dryRun: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0, ...o });

test('A missing store file reports an absent store with zero counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stats-'));
  try {
    const r = stats({ path: join(dir, 'nope.db') });
    assert.deepEqual(r, { records: 0, bytes: 0, receipts: 0, adapters: {}, neverObserved: true, storeAbsent: true, uninitialised: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('An empty database file without the memory schema withholds counts as uninitialised', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stats-'));
  try {
    const p = join(dir, 'blank.db');
    writeFileSync(p, '');
    const r = stats({ path: p });
    assert.deepEqual(r, {
      records: null,
      bytes: null,
      receipts: null,
      adapters: {},
      neverObserved: true,
      storeAbsent: false,
      uninitialised: true,
      why: 'a database with no memory schema (0 table(s), none of them memory_record)',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A freshly initialised store reports zero counts and has never been observed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stats-'));
  try {
    const p = join(dir, 'ready.db');
    open({ path: p }).close();
    const r = stats({ path: p });
    assert.deepEqual(r, { records: 0, bytes: 0, receipts: 0, adapters: {}, neverObserved: true, storeAbsent: false, uninitialised: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Records without any receipts are counted but the store is still never observed', () => {
  const r = stats({ db: fakeDb({ n: 7, bytes: 700 }, []) });
  assert.deepEqual(r, { records: 7, bytes: 700, receipts: 0, adapters: {}, neverObserved: true, storeAbsent: false, uninitialised: false });
});

test('A single verified full receipt marks the store as observed', () => {
  const rows = [{ adapter: 'alpha', state: 'verified', stored_form: 'full', n: 1 }];
  const r = stats({ db: fakeDb({ n: 1, bytes: 10 }, rows) });
  assert.deepEqual(r, {
    records: 1,
    bytes: 10,
    receipts: 1,
    adapters: { alpha: bucket({ total: 1, verified: 1, storedFull: 1 }) },
    neverObserved: false,
    storeAbsent: false,
    uninitialised: false,
  });
});

test('Each receipt state and stored form lands in its own counter with unknown forms grouped', () => {
  const rows = [
    { adapter: 'beta', state: 'accepted-unverified', stored_form: 'preview', n: 2 },
    { adapter: 'beta', state: 'failed', stored_form: 'divergent', n: 3 },
    { adapter: 'beta', state: 'dry-run', stored_form: 'other', n: 4 },
    { adapter: 'beta', state: 'pending', stored_form: null, n: 5 },
  ];
  const r = stats({ db: fakeDb({ n: 3, bytes: 45 }, rows) });
  assert.deepEqual(r, {
    records: 3,
    bytes: 45,
    receipts: 14,
    adapters: {
      beta: bucket({ total: 14, acceptedUnverified: 2, failed: 3, dryRun: 4, storedPreview: 2, storedDivergent: 3, storedUnknown: 9 }),
    },
    neverObserved: false,
    storeAbsent: false,
    uninitialised: false,
  });
});

test('Receipts from different adapters are tallied into separate buckets', () => {
  const rows = [
    { adapter: 'a1', state: 'verified', stored_form: 'divergent', n: 2 },
    { adapter: 'a2', state: 'verified', stored_form: 'preview', n: 1 },
    { adapter: 'a1', state: 'dry-run', stored_form: 'full', n: 1 },
  ];
  const r = stats({ db: fakeDb({ n: 2, bytes: 300 }, rows) });
  assert.deepEqual(r, {
    records: 2,
    bytes: 300,
    receipts: 4,
    adapters: {
      a1: bucket({ total: 3, verified: 2, dryRun: 1, storedFull: 1, storedDivergent: 2 }),
      a2: bucket({ total: 1, verified: 1, storedPreview: 1 }),
    },
    neverObserved: false,
    storeAbsent: false,
    uninitialised: false,
  });
});
