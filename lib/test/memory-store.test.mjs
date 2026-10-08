// lib/test/memory-store.test.mjs — the durable store's floor.
//
// Every test here asserts an EFFECT, never a marker. The module's central claim is "this store
// keeps the whole document", and the only honest way to check that is to write a document larger
// than the thing it is replacing and read every byte back — not to grep the source for a comment
// saying it does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  put, get, byTags, receiptsFor, recordReceipt, stats, open, now, dbPath, storeState, wasUpdateOf,
  ABSENT, UNINITIALISED, READY, UNREADABLE,
} from '../memory-store.mjs';

/** A fresh store per test. Shared trees and shared stores are how this repo's worst bugs travel. */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-memstore-'));
  const path = join(dir, 'test.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path;
}

const rec = (over = {}) => ({
  external_id: 'commitwork:rollup:area:repo',
  content: 'the quick brown fox',
  tags: ['commitwork', 'audit-rollup'],
  memory_type: 'Episodic',
  ...over,
});

// ── The reason this module exists ───────────────────────────────────────────

test('a document far larger than veld\'s ~410-byte preview round-trips byte-for-byte', (t) => {
  const path = scratch(t);
  // 19KB: the size the contract records as the real case — ner_entities held an end_char of 17392
  // into a document veld no longer had anywhere.
  const big = Array.from({ length: 400 }, (_, i) => `line ${i}: ${'payload '.repeat(6)}`).join('\n');
  assert.ok(big.length > 17392, 'fixture must exceed the measured truncation case to be a real test');

  const r = put(rec({ content: big }), { scope: 'test', path });
  assert.equal(r.state, 'verified');
  assert.equal(r.storedForm, 'full');
  assert.equal(r.storedCoverage, 1);

  const back = get(rec().external_id, { path });
  assert.equal(back.content, big, 'every byte, not a preview');
  assert.equal(back.bytes, Buffer.byteLength(big, 'utf8'));
});

test('storedForm is proven by readback, not asserted — the receipt carries both hashes', (t) => {
  const path = scratch(t);
  const r = put(rec(), { scope: 'test', path });
  assert.equal(r.contentSha256, r.storedSha256, 'sent and stored hashes must be compared, and equal');
  assert.ok(r.contentSha256 && r.storedSha256);
});

// ── Identity is external_id, and version tracks CONTENT, not occurrence ─────

test('re-writing identical content is one record at one version — occurrence is not identity', (t) => {
  const path = scratch(t);
  const a = put(rec(), { scope: 'test', path });
  const b = put(rec(), { scope: 'test', path });

  assert.equal(a.version, 1);
  assert.equal(b.version, 1, 'a bump here would make every idempotent re-run look like a change');
  assert.equal(a.wasUpdate, false);
  assert.equal(b.wasUpdate, true, 'the row existed, even though nothing about it changed');
});

test('changed content advances the version — supersession, not a second record', (t) => {
  const path = scratch(t);
  put(rec(), { scope: 'test', path });
  const b = put(rec({ content: 'something else entirely' }), { scope: 'test', path });
  assert.equal(b.version, 2);

  const db = open({ path });
  t.after(() => db.close());
  const n = db.prepare('SELECT COUNT(*) AS n FROM memory_record').get().n;
  assert.equal(n, 1, 'one identity is one row; a second row would mean the key stopped being the key');
});

test('a record with no external_id is refused — it could never be updated or superseded', (t) => {
  const path = scratch(t);
  const r = put({ content: 'orphan' }, { scope: 'test', path });
  assert.equal(r.state, 'failed');
  assert.match(r.reason, /external_id/);
});

test('a record with no writer scope is refused — an unscoped record never comes back', (t) => {
  const path = scratch(t);
  const r = put(rec(), { path });
  assert.equal(r.state, 'failed');
  assert.match(r.reason, /scope/);
});

// ── The gate is the shared one, and it refuses rather than sanitising ───────

test('credential-bearing content is REFUSED, and nothing is written', (t) => {
  const path = scratch(t);
  const r = put(rec({ content: 'api_key: AKIAIOSFODNN7EXAMPLE' }), { scope: 'test', path });
  assert.equal(r.state, 'failed');
  assert.match(r.reason, /redaction gate refused/);
  assert.equal(get(rec().external_id, { path }), null, 'a refused write must leave no row behind');
});

test('scope tags are applied by the store, never asked of the caller', (t) => {
  const path = scratch(t);
  put(rec(), { scope: 'commitwork-sweep', project: 'CommitWork', path });
  const back = get(rec().external_id, { path });
  assert.ok(back.tags.includes('scope:commitwork-sweep'), 'WHO wrote it');
  assert.ok(back.tags.includes('memory-layer-project:commitwork'), 'WHICH project, lowercased');
  assert.equal(back.project, 'commitwork', 'a case split hides a project from its own scoped search');
});

// ── Reads: the half whose absence let the veld trail stay empty ─────────────

test('byTags is STRICT — every requested tag must be present', (t) => {
  const path = scratch(t);
  put(rec({ external_id: 'a', tags: ['x', 'y'] }), { scope: 'test', path });
  put(rec({ external_id: 'b', tags: ['x'] }), { scope: 'test', path });

  assert.equal(byTags(['x'], { path }).length, 2);
  assert.equal(byTags(['x', 'y'], { path }).length, 1, 'a record missing one requested tag must not match');
  assert.equal(byTags(['nowhere'], { path }).length, 0);
});

test('byTags refuses an empty filter rather than returning the whole store', (t) => {
  const path = scratch(t);
  put(rec(), { scope: 'test', path });
  assert.throws(() => byTags([], { path }), /at least one tag/);
});

// ── Receipts: what happened, every time, including to other adapters ────────

test('a remote adapter\'s degraded receipt is recorded with its form on a separate axis', (t) => {
  const path = scratch(t);
  const local = put(rec(), { scope: 'test', path });
  recordReceipt(local, { path });
  recordReceipt({
    ...local, adapter: 'veld', state: 'accepted-unverified',
    storedForm: 'preview', storedCoverage: 0.02, reason: 'veld stored a preview, not the document',
  }, { path });

  const rs = receiptsFor(rec().external_id, { path });
  assert.equal(rs.length, 2);

  const s = stats({ path });
  assert.equal(s.adapters.local.verified, 1);
  assert.equal(s.adapters.veld.acceptedUnverified, 1);
  assert.equal(s.adapters.veld.storedPreview, 1,
    'a previewed write is accepted AND not a copy; folding those into one badge loses the second');
  assert.equal(s.adapters.veld.failed, 0, 'a preview must never be reported as a failure');
  assert.equal(s.adapters.veld.verified, 0, 'nor as a success');
});

test('an empty receipt trail reports neverObserved — grey is not green', (t) => {
  const path = scratch(t);
  put(rec(), { scope: 'test', path });   // a record exists...
  const s = stats({ path });
  assert.equal(s.records, 1);
  assert.equal(s.receipts, 0);
  assert.equal(s.neverObserved, true,
    '...but nobody has observed a write. 0 of 25 rollups carried a receipt and it read as "nothing to report".');
});

// ── House invariants ────────────────────────────────────────────────────────

test('every input path is env-overridable, and the env is read at CALL time', () => {
  const before = process.env.CW_MEMORY_DB;
  try {
    process.env.CW_MEMORY_DB = '/tmp/set-after-import.db';
    assert.equal(dbPath(), '/tmp/set-after-import.db',
      'a const read at module load would silently defeat this, and the test would pass while proving nothing');
  } finally {
    if (before === undefined) delete process.env.CW_MEMORY_DB; else process.env.CW_MEMORY_DB = before;
  }
});

test('CW_NOW makes writes deterministic, and an unparseable value raises rather than silently drifting', () => {
  const before = process.env.CW_NOW;
  try {
    process.env.CW_NOW = '2026-09-07T12:00:00.000Z';
    assert.equal(now(), '2026-09-07T12:00:00.000Z');
    process.env.CW_NOW = 'not-a-date';
    assert.throws(() => now(), /not a parseable date/);
  } finally {
    if (before === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = before;
  }
});

test('a write failure leaves no half-record — the transaction rolls back', (t) => {
  const path = scratch(t);
  put(rec(), { scope: 'test', path });

  // A closed connection is the cheapest real failure to induce mid-write.
  const db = open({ path });
  db.close();
  const r = put(rec({ content: 'this must not land' }), { scope: 'test', db, path });
  assert.equal(r.state, 'failed');
  assert.match(r.reason, /local store write failed/);

  const back = get(rec().external_id, { path });
  assert.equal(back.content, 'the quick brown fox', 'the prior value must survive a failed overwrite');
  assert.equal(back.version, 1);
});

// ── Four store states, because absence and emptiness are not one answer ─────
// Found by a sibling tool's author, whose CLI hit UNINITIALISED on the real default path: it
// resolved to a database holding eight taxonomy_* tables and no memory schema, so every reader
// raised `no such table` — fail-closed and illegible, and the tempting repair is to return 0.

test('an absent store is ABSENT, not empty — nothing has been written yet', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-memstore-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'never-created.db');
  const st = storeState({ path });
  assert.equal(st.state, ABSENT);
  assert.match(st.why, /nothing has been written/);
});

test('a database with no memory schema is UNINITIALISED, never READY and never ABSENT', (t) => {
  const path = scratch(t);
  const db = open({ path });
  db.exec('DROP TABLE memory_record; DROP TABLE memory_receipt;');
  db.exec('CREATE TABLE taxonomy_class (id TEXT PRIMARY KEY);');
  db.close();

  const st = storeState({ path });
  assert.equal(st.state, UNINITIALISED, 'the real default path was exactly this on 2026-09-07');
  assert.match(st.why, /no memory schema/);
});

test('stats WITHHOLDS counts on an uninitialised store rather than reporting zero', (t) => {
  const path = scratch(t);
  const db = open({ path });
  db.exec('DROP TABLE memory_record; DROP TABLE memory_receipt;');
  db.close();

  const s = stats({ path });
  assert.equal(s.uninitialised, true);
  assert.equal(s.records, null, 'zero would claim we looked and found none');
  assert.equal(s.receipts, null);
  assert.equal(s.storeAbsent, false, 'the file exists — this is not absence');
  assert.equal(s.neverObserved, true);
});

test('a written store is READY, and its stats report real counts', (t) => {
  const path = scratch(t);
  put(rec(), { scope: 'test', path });
  assert.equal(storeState({ path }).state, READY);
  const s = stats({ path });
  assert.equal(s.uninitialised, false);
  assert.equal(s.storeAbsent, false);
  assert.equal(s.records, 1);
});

test('storeState never reports UNREADABLE as empty — the fault keeps its own name', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-memstore-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'garbage.db');
  writeFileSync(path, 'this is not a database, it is prose');
  const st = storeState({ path });
  assert.ok([UNREADABLE, UNINITIALISED].includes(st.state),
    'a non-database file is a fault or an unrecognised schema — never an empty store');
  assert.notEqual(st.state, ABSENT, 'the file is right there');
});

// ── The env is an argument, not a global read ──────────────────────────────

test('dbPath takes an INJECTED env — a caller with a fixture env must be able to reach it', () => {
  assert.equal(dbPath({ env: { CW_MEMORY_DB: '/tmp/injected.db' } }), '/tmp/injected.db');
  assert.match(dbPath({ env: {} }), /monitor\/memory\.db$/,
    'its OWN file: monitor/commitwork.db is a projection that --build drops and rebuilds');
});

test('CW_DB is deliberately NOT consulted — moving the projection must not move the record', () => {
  assert.match(dbPath({ env: { CW_DB: '/tmp/taxonomy-projection.db' } }), /monitor\/memory\.db$/,
    'pointing taxonomy-db somewhere else must never silently relocate the system of record');
});

test('now takes an injected env too', () => {
  assert.equal(now({ env: { CW_NOW: '2026-09-07T12:00:00.000Z' } }), '2026-09-07T12:00:00.000Z');
});

// ── The insert/update canary, which was dead on this adapter ───────────────

test('wasUpdate from put() actually PERSISTS — the two spellings must both land', (t) => {
  const path = scratch(t);
  recordReceipt(put({ external_id: 'x', content: 'a' }, { scope: 't', path }), { path });
  recordReceipt(put({ external_id: 'x', content: 'b' }, { scope: 't', path }), { path });

  const rows = receiptsFor('x', { path }).sort((a, b) => a.id - b.id);
  assert.equal(rows[0].was_update, 0, 'the first write is an INSERT');
  assert.equal(rows[1].was_update, 1, 'the second is an UPDATE');
  // Until 2026-09-07 both landed NULL: put() returns `wasUpdate`, this read `was_update`, and a
  // mismatched key returns undefined rather than throwing. null is a legitimate value here, so
  // nothing looked broken — the canary was simply never armed on the local adapter.
});

test('null survives as null — an absent flag must never be coerced to "insert"', () => {
  assert.equal(wasUpdateOf({}), null, 'the backend did not say; reporting false would invent an insert');
  assert.equal(wasUpdateOf({ was_update: null }), null);
  assert.equal(wasUpdateOf({ wasUpdate: false }), 0, 'camel, from put()');
  assert.equal(wasUpdateOf({ was_update: true }), 1, 'snake, from the wire');
  assert.equal(wasUpdateOf({ wasUpdate: true, was_update: false }), 1, 'camel wins — it is the local writer');
});
