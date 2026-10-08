// lib/memory-store.mjs — the DURABLE half of the memory layer. Full content, on this disk, first.
//
// WHY THIS EXISTS. veld is a summarising semantic-recall service: measured 2026-09-02 it keeps a
// ~410-byte PREVIEW in `content` and discards the rest, while metadata.compressed_data and
// ner_entities keep offsets into a document that is no longer anywhere (lib/memory-layer-client.mjs:17-24).
// That is correct behaviour for an INDEX and disqualifying for a SYSTEM OF RECORD. It was being
// asked to be the second.
//
// Measured 2026-09-06, and again as the numbers moved:
//   · 0 of 25 rollups on disk carry a memory-layer-receipts.json — the export path's own designed
//     evidence trail is empty everywhere, so every degraded state since it was written is unrecorded.
//     monitor/export-overwatch.mjs persists receipts precisely BECAUSE the lane exits 0 on every
//     failure; with no receipt, exit-0-always is silent-failure-always.
//   · the spine ledger holds 1,452 rows naming 76 distinct plans; ~/.substrate/tasks.db holds ONE.
//     99.3% of attribution rows point at plans with no referent. Nothing reports it because nothing
//     is asked to — gate-spine checks that the store is READABLE, never that it still contains what
//     the ledger says was filed into it.
//     A COUNT DELTA IS NOT ACTIVITY, and this comment said it was for one draft: the row count moved
//     1,440 -> 1,452 between two readings and was written up as live filing, when the newest row in
//     the file is dated 2026-08-31T03:20 — seven days stale. The delta was the file changing under a
//     shared tree, not sessions filing. Read the timestamps, not the line count.
//
// SO THE ORDER INVERTS. The local write happens FIRST and completes; the remote write is
// best-effort on top of a durable fact. Then veld's truncation stops being data loss and becomes
// what it always was — an index summarising something that still exists.
//
// ZERO DEPENDENCIES. node:sqlite is built in from Node 22; this box measures v24.16.0 (`node --version`,
// 2026-09-07) — NOT the 26 that bin/taxonomy-db.mjs's comment and my own first draft of this header
// asserted. Neither of us had measured it. As in
// bin/taxonomy-db.mjs. No driver, no build step, `npm ls` stays empty — a property several CRA
// controls depend on.
//
// IDENTITY IS external_id, NEVER A ROW ID. A per-run key turns every re-run into a fresh insert
// and destroys supersession, which is the same defect class as keying a finding on a line number
// (CLAUDE.md). `version` therefore advances on CONTENT CHANGE, not on occurrence: writing identical
// content twice is one record at one version, and the receipt says `was_update: false`.

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync } from 'node:fs';

// The SHARED redaction gate, never a second one. A rival redactor drifts from this one's ruleset,
// and the drift shows up as one store holding a credential the other refused.
import { redactionCheck, scopeTags } from './memory-layer-client.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Env read at CALL time, and the env is an ARGUMENT. A `const X = process.env.Y` at module load
 * silently defeats every test that sets the override afterwards — the test then passes while
 * proving nothing (CLAUDE.md). Taking `env` closes the other half: a caller injecting a fixture env
 * could not reach this function while it read the global directly, which forced its own workaround.
 *
 * ITS OWN FILE, not monitor/commitwork.db. That was the first draft's default, on the reasoning
 * that one SQLite file with several namespaces matches bin/taxonomy-db.mjs's idiom. It does — but
 * that file is a PROJECTION: taxonomy-db.mjs --build "drops and rebuilds every taxonomy table" from
 * the registry, and it is a VACUUM or a widened rebuild away from taking a durable store with it.
 * Sharing a file makes the durable half hostage to the disposable half, in the one module whose
 * entire purpose is that the content survives. CW_DB is deliberately NOT consulted for the same
 * reason: pointing the taxonomy projection somewhere must not silently move the system of record.
 */
export const dbPath = ({ env = process.env } = {}) =>
  env.CW_MEMORY_DB || resolve(REPO, 'monitor', 'memory.db');

/** Deterministic clock. Same inputs => byte-identical outputs, honouring CW_NOW like the rest of the repo. */
export const now = ({ env = process.env } = {}) => {
  const o = env.CW_NOW;
  if (!o) return new Date().toISOString();
  const d = new Date(o);
  if (Number.isNaN(d.getTime())) throw new Error(`CW_NOW is not a parseable date: ${o}`);
  return d.toISOString();
};

export const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

// ── Schema ──────────────────────────────────────────────────────────────────
//
// Two tables, and they answer different questions on purpose:
//   memory_record  — WHAT IS TRUE NOW. One row per identity, holding the full content.
//   memory_receipt — WHAT HAPPENED, EVERY TIME. Append-only, one row per write ATTEMPT to any
//                    adapter, including the failures and the dry-runs.
//
// Collapsing them would lose the second, which is the one that was missing: a store with the right
// content in it cannot tell you that four of the last five remote writes were refused.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_record (
  external_id    TEXT PRIMARY KEY,
  content        TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  bytes          INTEGER NOT NULL,
  memory_type    TEXT NOT NULL DEFAULT 'Context',
  tags           TEXT NOT NULL DEFAULT '[]',   -- JSON array, sorted, as SENT
  scope          TEXT NOT NULL,                -- WHO wrote it
  project        TEXT,                         -- WHICH project
  version        INTEGER NOT NULL DEFAULT 1,   -- advances on CONTENT CHANGE, never on occurrence
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_scope   ON memory_record(scope, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_record(project, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_receipt (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id    TEXT NOT NULL,
  adapter        TEXT NOT NULL,                -- 'local' | 'veld' | ... — WHICH backend answered
  at             TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('verified','accepted-unverified','failed','dry-run')),
  reason         TEXT,                         -- REQUIRED whenever state is not 'verified'
  -- storedForm is a SEPARATE AXIS from state, never folded into it: a previewed write is accepted
  -- AND not a durable copy, and one badge loses the second fact.
  stored_form    TEXT NOT NULL CHECK (stored_form IN ('full','preview','divergent','unknown')),
  stored_coverage REAL,
  content_sha256 TEXT,
  stored_sha256  TEXT,
  tags_sent      TEXT NOT NULL DEFAULT '[]',
  tags_stored_count INTEGER,
  truncated      INTEGER NOT NULL DEFAULT 0,
  remote_id      TEXT,
  was_update     INTEGER,
  remote_version INTEGER
);

CREATE INDEX IF NOT EXISTS idx_receipt_identity ON memory_receipt(external_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_adapter  ON memory_receipt(adapter, at DESC);
`;

/**
 * Open the store. A missing PARENT DIRECTORY is created; a corrupt or unreadable database RAISES.
 *
 * Fail closed: only ENOENT is legitimate absence, and here even that is not absence — this module
 * OWNS the file, so "not there yet" means "create it", never "return an empty store". A caller
 * that got `[]` from an unreadable database would render zero records as zero problems.
 */
export function open({ path = dbPath(), readOnly = false } = {}) {
  if (!readOnly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { readOnly });
  if (!readOnly) db.exec(SCHEMA);
  return db;
}

/**
 * ABSENT is a THIRD answer, and only the filesystem may give it.
 *
 * A read-only open of a database that is not there fails with SQLite errcode 14, "unable to open
 * database file" — the SAME error a permission denial produces. Those are opposite facts: one means
 * "nothing has been written yet" and the other means "something is here and you cannot see it".
 * Deciding between them by matching that message is how a locked store gets reported as an empty
 * one, and admin/lib/overwatch-layer-read.mjs:84-90 does exactly that pattern-match today.
 *
 * So the question goes to stat(), which answers it unambiguously: ENOENT is absence and nothing
 * else is. Every other failure — EACCES, a corrupt header, a directory where a file should be —
 * propagates. Fail closed: only ENOENT means legitimately absent (CLAUDE.md).
 *
 * @returns {DatabaseSync|null} null ONLY when the file genuinely does not exist
 */
export function openForRead({ path = dbPath() } = {}) {
  try {
    statSync(path);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;                       // EACCES and friends are faults, never emptiness
  }
  return new DatabaseSync(path, { readOnly: true });
}

/** What a store IS, before anything asks what it holds. Four answers, not two. */
export const ABSENT = 'absent';               // no file — UNKNOWN, nothing has written yet
export const UNINITIALISED = 'uninitialised'; // a database, but no memory schema in it
export const READY = 'ready';                 // the memory tables exist
export const UNREADABLE = 'unreadable';       // present and will not open — a FAULT, never empty

/**
 * Which of the four this store is.
 *
 * WHY THIS IS SEPARATE FROM THE READERS. get() returns null and byTags() returns [] when there is
 * no store, which reads identically to "no such record" and "nothing matched". For an ergonomic
 * reader that is the right shape — but it means the readers alone cannot tell a caller that NOTHING
 * HAS EVER BEEN WRITTEN, which is precisely the state this whole module exists because nobody could
 * see. So the distinction lives here, and a caller that needs it asks before it reads.
 *
 * UNINITIALISED is not hypothetical: measured 2026-09-07, the first draft's default path resolved to
 * a database holding eight taxonomy_* tables and no memory schema at all. Every reader raised
 * `no such table: memory_record`, which is fail-closed and illegible — and the tempting repair is to
 * return 0, which is the same error wearing the safe-looking direction.
 */
export function storeState({ path = dbPath(), env = process.env } = {}) {
  const p = path || dbPath({ env });
  try {
    statSync(p);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { state: ABSENT, why: 'no store file — nothing has been written here yet' };
    return { state: UNREADABLE, why: `store present and not statable: ${e.message}` };
  }
  let db;
  try {
    db = new DatabaseSync(p, { readOnly: true });
    // Ask sqlite_master which tables exist. A STRUCTURAL question, never a matched error string:
    // a locked store and a missing table raise the same kind of text.
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const has = names.includes('memory_record') && names.includes('memory_receipt');
    return has
      ? { state: READY, why: null, tables: names.length }
      : { state: UNINITIALISED, why: `a database with no memory schema (${names.length} table(s), none of them memory_record)`, tables: names.length };
  } catch (e) {
    return { state: UNREADABLE, why: `store present and would not open: ${e && e.message ? e.message : 'error'}` };
  } finally {
    try { if (db) db.close(); } catch { /* the failure above is the story */ }
  }
}

// ── The write ───────────────────────────────────────────────────────────────

/**
 * Store one record durably, in full, and return a receipt in the same shape the remote client uses.
 *
 * The receipt is deliberately shaped like lib/memory-layer-client.mjs's so a reader — and the
 * visualiser — can put a local row and a veld row side by side without a translation layer that
 * would be the first thing to drift.
 *
 * storedForm is MEASURED, not asserted. This store cannot truncate, so `full` is true by
 * construction — which is exactly the kind of claim that quietly stops being true. It is proven by
 * reading the row back and comparing hashes, on every write. A guard that asserts its own effect
 * instead of a marker is the only kind worth having (CLAUDE.md).
 */
export function put(record, { scope, project = null, db = null, path = dbPath(), env = process.env, truncated = false, extraDenied = [] } = {}) {
  const base = {
    external_id: record && record.external_id ? String(record.external_id) : null,
    adapter: 'local',
    at: now(),
    state: 'failed',
    reason: null,
    storedForm: 'unknown',
    storedCoverage: null,
    contentSha256: null,
    storedSha256: null,
    tagsSent: [],
    tagsStoredCount: null,
    truncated: Boolean(truncated),
    version: null,
    wasUpdate: null,
  };

  if (!base.external_id) {
    return { ...base, reason: 'no external_id — identity is external_id, and a record without one can never be updated or superseded' };
  }
  if (!scope) {
    return { ...base, reason: 'no writer scope — an unscoped record is invisible to a scoped search: it does not fail, it never comes back' };
  }

  // Same gate as the remote path, in the same order. Refuses, never sanitises: stripping a secret
  // out of prose and writing the remainder is a guess about where the secret ended.
  const gate = redactionCheck(record, { extraDenied });
  if (!gate.ok) return { ...base, reason: `redaction gate refused: ${gate.reasons.join('; ')}` };

  const tags = scopeTags(record.tags, { scope, project, env });
  const content = record.content;
  const csum = sha256(content);
  const receipt = { ...base, contentSha256: csum, tagsSent: tags };

  const owned = !db;
  const conn = db || open({ path });
  try {
    conn.exec('BEGIN IMMEDIATE');
    const prior = conn.prepare('SELECT content_sha256, version, created_at FROM memory_record WHERE external_id = ?').get(base.external_id);

    // Occurrence is not identity. Identical content re-written is the SAME record at the SAME
    // version — bumping it here would make every idempotent re-run look like a change, which is
    // the canary the remote client watches for (a moving id turns every update into a fresh,
    // perfectly-verifying insert).
    const changed = !prior || prior.content_sha256 !== csum;
    const version = prior ? (changed ? prior.version + 1 : prior.version) : 1;
    const created = prior ? prior.created_at : receipt.at;

    conn.prepare(`
      INSERT INTO memory_record (external_id, content, content_sha256, bytes, memory_type, tags, scope, project, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET
        content = excluded.content, content_sha256 = excluded.content_sha256, bytes = excluded.bytes,
        memory_type = excluded.memory_type, tags = excluded.tags, scope = excluded.scope,
        project = excluded.project, version = excluded.version, updated_at = excluded.updated_at
    `).run(
      base.external_id, content, csum, Buffer.byteLength(content, 'utf8'),
      record.memory_type || 'Context', JSON.stringify(tags), scope,
      project ? String(project).toLowerCase() : null,
      version, created, receipt.at,
    );

    // PROVE the round-trip inside the transaction. Asserting 'full' because this store cannot
    // truncate is the assertion that has no floor — nothing would notice the day it stopped
    // holding. Read it back and compare.
    const back = conn.prepare('SELECT content, version FROM memory_record WHERE external_id = ?').get(base.external_id);
    if (!back || typeof back.content !== 'string') {
      conn.exec('ROLLBACK');
      return { ...receipt, reason: 'readback found no row immediately after the write — the store did not keep it' };
    }
    const ssum = sha256(back.content);
    if (ssum !== csum) {
      conn.exec('ROLLBACK');
      return { ...receipt, storedSha256: ssum, storedForm: 'divergent', storedCoverage: null,
        reason: 'stored content does not match what was written — corruption, not truncation' };
    }
    conn.exec('COMMIT');

    return {
      ...receipt,
      state: 'verified',
      storedSha256: ssum,
      storedForm: 'full',
      storedCoverage: 1,
      tagsStoredCount: tags.length,   // this store keeps exactly what it was given; it mints nothing
      version: back.version,
      wasUpdate: Boolean(prior),
      reason: null,
    };
  } catch (e) {
    try { conn.exec('ROLLBACK'); } catch { /* the failure below is the one worth reporting */ }
    return { ...receipt, reason: `local store write failed: ${e && e.message ? e.message : 'error'}` };
  } finally {
    if (owned) conn.close();
  }
}

/**
 * Normalise the insert/update flag across the two spellings in play — camel from this module, snake
 * from the wire. `null` genuinely means "the backend did not say" and must survive as null, so an
 * absent field can never be coerced to false: that would report every write as an insert.
 */
export const wasUpdateOf = (r) => {
  const v = r && (r.wasUpdate !== undefined ? r.wasUpdate : r.was_update);
  return v === null || v === undefined ? null : (v ? 1 : 0);
};

/** Record one receipt — from ANY adapter, including a remote one that failed or was never sent. */
export function recordReceipt(r, { db = null, path = dbPath() } = {}) {
  const owned = !db;
  const conn = db || open({ path });
  try {
    conn.prepare(`
      INSERT INTO memory_receipt (external_id, adapter, at, state, reason, stored_form, stored_coverage,
        content_sha256, stored_sha256, tags_sent, tags_stored_count, truncated, remote_id, was_update, remote_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(r.external_id ?? ''), String(r.adapter ?? 'unknown'), r.at || now(),
      String(r.state ?? 'failed'), r.reason ?? null,
      String(r.storedForm ?? 'unknown'), r.storedCoverage ?? null,
      r.contentSha256 ?? null, r.storedSha256 ?? null,
      JSON.stringify(r.tagsSent || []), r.tagsStoredCount ?? null,
      r.truncated ? 1 : 0, r.id ?? r.remote_id ?? null,
      // BOTH SPELLINGS, and the reason is a bug this line had until 2026-09-07. put() returns
      // `wasUpdate` (camel, this module's style) while the veld client's receipt carries
      // `was_update` (snake, the server's wire field). This read only the snake form, so EVERY
      // local receipt persisted NULL — and `null` is a legitimate value here ("the backend did not
      // say"), so nothing looked broken. The insert/update pair is the canary tally() calls its
      // identity-regression detector: a moving external_id turns every update into a fresh,
      // perfectly-verifying insert, and the ONLY signal is inserted-vs-updated. It was dead on one
      // of the two adapters, silently, because a mismatched key returns undefined rather than throwing.
      // Found by the author of a reader that tried to render the field.
      wasUpdateOf(r),
      r.version ?? r.remote_version ?? null,
    );
    return { ok: true };
  } catch (e) {
    // A receipt that cannot be written is itself worth reporting — it is the failure this whole
    // module exists to stop being silent.
    return { ok: false, reason: `receipt not recorded: ${e && e.message ? e.message : 'error'}` };
  } finally {
    if (owned) conn.close();
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────
//
// These exist so the store is not write-only. The measured defect on the veld side was that
// recallByTags had ONE non-test caller querying a tag family no writer emits — a write nobody
// reads cannot be missed when it breaks, which is how the empty receipt trail survived.

/** One record by identity. `null` means no such row; an unreadable store RAISES. */
export function get(externalId, { db = null, path = dbPath() } = {}) {
  const owned = !db;
  const conn = db || openForRead({ path });
  if (!conn) return null;                    // no store yet — absence, not a fault
  try {
    const row = conn.prepare('SELECT * FROM memory_record WHERE external_id = ?').get(String(externalId));
    return row ? { ...row, tags: JSON.parse(row.tags || '[]') } : null;
  } finally {
    if (owned) conn.close();
  }
}

/**
 * Records carrying EVERY tag given — strict, like the contract's enumeration endpoint and unlike
 * /api/recall, which accepts a tags filter and silently ignores it (an endpoint that lies is
 * removed from the surface, not documented).
 */
export function byTags(tags, { limit = 50, db = null, path = dbPath() } = {}) {
  const want = [...new Set((tags || []).map(String))];
  if (!want.length) throw new Error('byTags: at least one tag is required — an empty filter would return the whole store as if it had matched');
  const owned = !db;
  const conn = db || openForRead({ path });
  if (!conn) return [];                      // no store yet — nothing written, so nothing matches
  try {
    const rows = conn.prepare('SELECT * FROM memory_record ORDER BY updated_at DESC').all();
    const out = [];
    for (const row of rows) {
      const have = JSON.parse(row.tags || '[]');
      if (want.every((t) => have.includes(t))) out.push({ ...row, tags: have });
      if (out.length >= limit) break;
    }
    return out;
  } finally {
    if (owned) conn.close();
  }
}

/** The write history for one identity, newest first — the visualiser's step-by-step source. */
export function receiptsFor(externalId, { limit = 100, db = null, path = dbPath() } = {}) {
  const owned = !db;
  const conn = db || openForRead({ path });
  if (!conn) return [];                      // no store yet
  try {
    return conn.prepare('SELECT * FROM memory_receipt WHERE external_id = ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(String(externalId), limit);
  } finally {
    if (owned) conn.close();
  }
}

/**
 * Fleet-wide counts, per adapter. Three-valued by construction — a two-state sent/failed tally
 * cannot express "accepted but not read back", which is the state most worth reporting.
 *
 * `neverObserved` is the state this whole exercise turned on: a store with no receipts at all is
 * NOT a clean one, and a caller must be able to tell those apart without counting rows itself.
 */
export function stats({ db = null, path = dbPath() } = {}) {
  const owned = !db;
  const conn = db || openForRead({ path });
  // No store at all is the strongest possible neverObserved, and must not render as a clean fleet.
  if (!conn) return { records: 0, bytes: 0, receipts: 0, adapters: {}, neverObserved: true, storeAbsent: true, uninitialised: false };
  // A database with no memory schema is NOT an empty store. Counts are WITHHELD rather than zeroed:
  // a zero here is a claim that we looked and found none, which is not what happened.
  if (!db) {
    const st = storeState({ path });
    if (st.state === UNINITIALISED) {
      return { records: null, bytes: null, receipts: null, adapters: {}, neverObserved: true, storeAbsent: false, uninitialised: true, why: st.why };
    }
  }
  try {
    const records = conn.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS bytes FROM memory_record').get();
    const rows = conn.prepare('SELECT adapter, state, stored_form, COUNT(*) AS n FROM memory_receipt GROUP BY adapter, state, stored_form').all();
    const adapters = {};
    for (const r of rows) {
      const a = (adapters[r.adapter] ||= { total: 0, verified: 0, acceptedUnverified: 0, failed: 0, dryRun: 0, storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0 });
      a.total += r.n;
      if (r.state === 'verified') a.verified += r.n;
      else if (r.state === 'accepted-unverified') a.acceptedUnverified += r.n;
      else if (r.state === 'failed') a.failed += r.n;
      else if (r.state === 'dry-run') a.dryRun += r.n;
      if (r.stored_form === 'full') a.storedFull += r.n;
      else if (r.stored_form === 'preview') a.storedPreview += r.n;
      else if (r.stored_form === 'divergent') a.storedDivergent += r.n;
      else a.storedUnknown += r.n;
    }
    const receiptTotal = rows.reduce((n, r) => n + r.n, 0);
    return {
      records: records.n,
      bytes: records.bytes,
      receipts: receiptTotal,
      adapters,
      // Grey is neither green nor red. Zero receipts is "nobody has looked", not "all clear".
      neverObserved: receiptTotal === 0,
      storeAbsent: false,
      uninitialised: false,
    };
  } finally {
    if (owned) conn.close();
  }
}
