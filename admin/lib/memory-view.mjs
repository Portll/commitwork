// admin/lib/memory-view.mjs — HOW A MEMORY RECORD WAS ACTUALLY STORED, step by step.
//
// This is a RECEIPT RENDERER, not a telemetry source. Every field it shows already exists:
// lib/memory-store.mjs's two tables (memory_record = what is true now, memory_receipt = what
// happened every time) and the receipt payloads monitor/export-overwatch.mjs:208-225 writes beside
// a rollup. Nothing here measures anything the write path did not already measure — where a fact
// was never recorded, the step says so and stays GREY rather than inventing a value.
//
// THE THREE RULES THIS FILE EXISTS TO HOLD
//
// 1. GREY IS NEITHER GREEN NOR RED. Measured 2026-09-07: 0 of 25 rollups on disk carry a
//    memory-layer-receipts.json, so this view opens on nothing on the box it was written for. An
//    empty table under a calm header would report "nothing wrong" about a lane nobody has ever
//    observed. The empty case therefore gets its OWN state and its own sentence, and the three
//    empties are kept apart because they are different facts:
//      store-absent    no database exists — nothing has ever been written here
//      never-observed  the database exists and holds ZERO receipts — nobody has looked
//      unreadable      the store or the rollup population could not be read — the answer is unknown
//    stats() already hands back neverObserved and storeAbsent separately; collapsing them here
//    would throw away the distinction the store went to the trouble of making.
//
// 2. STATE AND storedForm ARE TWO AXES AND RENDER AS TWO COLUMNS. lib/memory-layer-client.mjs:26-35
//    is the reason the second axis exists at all: veld keeps a ~410-byte preview and discards the
//    rest, so a write can be ACCEPTED and NOT A DURABLE COPY at the same time. One badge can only
//    say one of those, and the one it drops is the one that matters.
//
// 3. FAIL CLOSED. Only ENOENT is absence. A parse failure, an EACCES, a corrupt database — each is
//    reported as itself. This file never turns a fault into an empty list, and never decides
//    absence by pattern-matching an error message (the anti-pattern still live at
//    admin/lib/overwatch-layer-read.mjs:84-90); it asks stat() and reads e.code.
//
// Env is read at CALL time inside functions, never at module load. No record CONTENT is ever put in
// the model or the page — bytes, hashes, tags and field NAMES only. The gate's own reasons name
// fields, not values.

import { esc } from '../../lib/html-escape.mjs';
import { houseCss, houseTokens, houseSwitchCss } from '../../lib/house-css.mjs';
import { followerScript } from '../../lib/theme-follower.mjs';
import { themeSwitchInline } from './theme-head.mjs';
import { createHash } from 'node:crypto';
import { statSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openForRead, receiptsFor, get, stats, dbPath, now } from '../../lib/memory-store.mjs';
import {
  CREDENTIAL_FIELDS, redactionCheck, classifyStored,
  PREVIEW_TOLERANCE, CONTAINMENT_FLOOR,
  STORED_FULL, STORED_PREVIEW, STORED_DIVERGENT, STORED_UNKNOWN,
  VERIFIED, ACCEPTED_UNVERIFIED, FAILED, NOT_ATTEMPTED,
} from '../../lib/memory-layer-client.mjs';
import { loadRegistry } from '../../monitor/registry.mjs';
import { reportsRootDir, outDirFor } from '../../monitor/area.mjs';
import { classifyReceipts, summariseExports, EXPORT_MEANING } from '../../monitor/memory-export-health.mjs';

export const RECEIPTS_FILE = 'memory-layer-receipts.json';
export const ROLLUP_FILE = 'rollup.json';

// ── Tone. Grey is a tone of its own, and `alarm` outranks `warn` so corruption can never render
// at the same volume as a preview. summarise() in the client makes the same ordering in words.
export const TONE_RANK = Object.freeze({ ok: 0, grey: 1, warn: 2, alarm: 3 });
export const louder = (a, b) => (TONE_RANK[a] ?? 1) >= (TONE_RANK[b] ?? 1) ? a : b;

/** The receipt state axis: did the write happen? */
export function stateTone(state) {
  if (state === VERIFIED) return 'ok';
  if (state === ACCEPTED_UNVERIFIED) return 'warn';
  if (state === FAILED) return 'alarm';
  if (state === NOT_ATTEMPTED) return 'grey';
  return 'grey';                       // an UNDECLARED state announces itself; it never inherits one
}

/** The storedForm axis: is what the backend holds a durable copy? Separate question, separate tone. */
export function formTone(form) {
  if (form === STORED_FULL) return 'ok';
  if (form === STORED_PREVIEW) return 'warn';
  if (form === STORED_DIVERGENT) return 'alarm';
  return 'grey';
}

export const stateMeaning = (s) => ({
  [VERIFIED]: 'read back and the hashes matched',
  [ACCEPTED_UNVERIFIED]: 'the backend accepted it and we did NOT confirm it — neither a pass nor a failure',
  [FAILED]: 'the write did not happen, or what is stored is not what was sent',
  [NOT_ATTEMPTED]: 'NOT ATTEMPTED (dry run) — nothing was written and nothing was lost',
}[s] || 'a state this panel does not declare — counted on its own axis, never binned into failed');

export const formMeaning = (f) => ({
  [STORED_FULL]: 'the backend holds what was sent',
  [STORED_PREVIEW]: 'NOT A DURABLE COPY — the backend kept a subset and discarded the rest',
  [STORED_DIVERGENT]: 'CORRUPTION — the stored text is not derived from the source at all',
  [STORED_UNKNOWN]: 'could not be determined — never read as either a pass or a loss',
}[f] || 'no stored form was recorded');

// ── Small helpers ───────────────────────────────────────────────────────────

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const short = (h) => (typeof h === 'string' && h.length > 16 ? `${h.slice(0, 12)}…${h.slice(-4)}` : h);

/** A field that WAS observed. */
const seen = (label, value, { note = null, tone = 'ok' } = {}) => ({ label, state: 'observed', value, note, tone, reason: null });
/** A field that could not be observed. It carries the REASON and never a blank. */
const unseen = (label, reason) => ({ label, state: 'grey', value: null, note: null, tone: 'grey', reason });

/** A step is grey unless at least one of its fields was observed — and it says which. */
function step(n, key, title, fields, { forceGrey = null } = {}) {
  const observed = fields.filter((f) => f.state === 'observed').length;
  const state = forceGrey ? 'grey' : (observed ? 'observed' : 'grey');
  const tone = state === 'grey' ? 'grey' : fields.reduce((t, f) => louder(t, f.tone), 'ok');
  return {
    n, key, title, state, tone, fields,
    reason: state === 'grey'
      ? (forceGrey || 'nothing in this step was observable from the evidence on this box')
      : null,
    observedFields: observed,
    totalFields: fields.length,
  };
}

/** JSON tags, from either receipt shape. A parse failure is reported, never silently []. */
function parseTags(v) {
  if (Array.isArray(v)) return { tags: v.map(String), reason: null };
  if (v === null || v === undefined) return { tags: null, reason: 'no tags recorded on this receipt' };
  try {
    const p = JSON.parse(String(v));
    return Array.isArray(p) ? { tags: p.map(String), reason: null } : { tags: null, reason: 'tags column is not a JSON array' };
  } catch (e) {
    return { tags: null, reason: `tags column is not parseable JSON: ${e.message}` };
  }
}

/**
 * One receipt, from EITHER shape: the memory_receipt row (snake_case) or the client/disk receipt
 * (camelCase). Two shapes, one reader — a translation layer per call site is the first thing to
 * drift, and lib/memory-store.mjs deliberately emits the client's shape so they can sit side by side.
 */
export function normaliseReceipt(r) {
  if (!r || typeof r !== 'object') return null;
  const t = parseTags(r.tagsSent ?? r.tags_sent);
  const wu = r.was_update ?? r.wasUpdate;
  return {
    external_id: r.external_id ?? null,
    adapter: r.adapter ?? null,
    at: r.at ?? null,
    state: r.state ?? null,
    reason: r.reason ?? null,
    storedForm: r.storedForm ?? r.stored_form ?? null,
    storedCoverage: r.storedCoverage ?? r.stored_coverage ?? null,
    contentSha256: r.contentSha256 ?? r.content_sha256 ?? null,
    storedSha256: r.storedSha256 ?? r.stored_sha256 ?? null,
    tagsSent: t.tags,
    tagsSentReason: t.reason,
    tagsStoredCount: r.tagsStoredCount ?? r.tags_stored_count ?? null,
    truncated: (r.truncated === 1 || r.truncated === true),
    remoteId: r.id ?? r.remote_id ?? null,
    wasUpdate: wu === null || wu === undefined ? null : Boolean(wu),
    remoteVersion: r.version ?? r.remote_version ?? null,
  };
}

// ── Declared adapter capabilities ───────────────────────────────────────────
//
// One row per backend, so "SQLite: full / veld: preview" reads as a PROPERTY OF THE BACKEND rather
// than a per-record surprise. Every claim below cites where it was measured; a capability row with
// no provenance is an opinion, and this panel's whole product is claims that survive being checked.
export const ADAPTERS = Object.freeze([
  Object.freeze({
    adapter: 'local',
    label: 'local SQLite — lib/memory-store.mjs',
    durability: 'full',
    expectedStoredForm: STORED_FULL,
    holds: 'the whole content, in one row keyed on external_id',
    verification: 'reads the row back INSIDE the write transaction and compares hashes; a mismatch rolls back',
    mintsTags: false,
    tagsNote: 'stores exactly the tags it was given and mints nothing (lib/memory-store.mjs:256)',
    truncates: false,
    identity: 'external_id is the PRIMARY KEY; version advances on content change, never on occurrence',
    source: 'lib/memory-store.mjs:75-116, 237-259',
  }),
  Object.freeze({
    adapter: 'veld',
    label: 'veld / memory-layer — lib/memory-layer-client.mjs',
    durability: 'preview',
    expectedStoredForm: STORED_PREVIEW,
    holds: 'a ~410-byte PREVIEW in `content`; the rest is discarded on store, and metadata.compressed_data decompresses to that same preview plus a NER table',
    verification: 'HTTP readback by the id the backend returned; best-effort, and a timeout is accepted-unverified rather than failed',
    mintsTags: true,
    tagsNote: 'mints tags from content, so tags stored may EXCEED tags sent — asserted as a superset, never an equality',
    truncates: true,
    identity: 'external_id is sent; the backend answers with an id of its own',
    source: 'lib/memory-layer-client.mjs:26-42, 249-307',
  }),
]);

export const adapterRow = (name) => ADAPTERS.find((a) => a.adapter === name) || null;

/**
 * The comparison table: declared capability joined to what was OBSERVED.
 *
 * Two asymmetries are deliberate. A declared adapter with no receipts is `never-observed`, not a
 * clean zero. An adapter that appears in the store but declares nothing here is `undeclared` and
 * says why that matters — its stored form can then only be read as a per-record surprise.
 */
export function adapterComparison(observedAdapters) {
  const obs = observedAdapters && typeof observedAdapters === 'object' ? observedAdapters : null;
  const rows = ADAPTERS.map((a) => {
    const o = obs ? obs[a.adapter] : undefined;
    return {
      ...a,
      declared: true,
      observation: obs === null ? 'unknown' : (o ? 'observed' : 'never-observed'),
      observationReason: obs === null
        ? 'the receipt store could not be read, so nothing is known about this backend on this box'
        : (o ? null : 'no receipt from this backend has ever been recorded here — that is nobody having looked, not a clean run'),
      counts: o || null,
    };
  });
  for (const name of Object.keys(obs || {})) {
    if (rows.some((r) => r.adapter === name)) continue;
    rows.push({
      adapter: name, label: `${name} — undeclared`, declared: false,
      durability: null, expectedStoredForm: null,
      holds: null, verification: null, mintsTags: null, tagsNote: null, truncates: null, identity: null,
      source: null,
      observation: 'observed',
      observationReason: 'this backend has written receipts here but declares no capability row, so its stored form cannot be read as a property of the backend — only as a per-record surprise',
      counts: obs[name],
    });
  }
  return rows;
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * stats(), with the fault kept as a fault — and with a FOURTH state the store itself cannot report.
 *
 * Measured on this box 2026-09-07: the default path (monitor/commitwork.db) EXISTS and holds none
 * of the memory tables, because nothing has ever written through lib/memory-store.mjs here. stats()
 * raises ERR_SQLITE_ERROR on it, and reporting that as UNREADABLE would publish a red fault about a
 * store that is merely empty of this schema — the grey-as-RED half of the house invariant, in the
 * page written to enforce it.
 *
 * The distinction is made AUTHORITATIVELY, by asking sqlite_master which tables exist, never by
 * pattern-matching the error text (admin/lib/overwatch-layer-read.mjs:84-90 is the anti-pattern).
 * Four states, four different facts:
 *   absent        no file (ENOENT, from stat()) — nothing has ever been written
 *   schema-absent the file is there and the memory tables are not — nothing has been written HERE
 *   unreadable    a fault: EACCES, corruption, a half-built schema — the answer is unknown
 *   present       the tables exist and stats() answered
 */
export function storeSnapshot({ path = null } = {}) {
  const p = path || dbPath();
  const blank = { records: null, bytes: null, receipts: null, adapters: null, neverObserved: null, storeAbsent: null };
  let db;
  try { db = openForRead({ path: p }); }
  catch (e) {
    return { path: p, state: 'unreadable', reason: `memory store unreadable: ${(e && e.code) || (e && e.message) || 'error'}`, ...blank };
  }
  if (!db) return { path: p, state: 'absent', reason: 'ENOENT — no database file has ever been created here', records: 0, bytes: 0, receipts: 0, adapters: {}, neverObserved: true, storeAbsent: true };
  let tables;
  try {
    tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memory_record','memory_receipt')").all().map((r) => r.name);
  } catch (e) {
    try { db.close(); } catch { /* the failure below is the one worth reporting */ }
    return { path: p, state: 'unreadable', reason: `the database could not be interrogated for its tables: ${(e && e.code) || e.message}`, ...blank };
  } finally { try { db.close(); } catch { /* already closed */ } }

  if (tables.length === 0) {
    return {
      path: p, state: 'schema-absent',
      reason: 'the database file exists and carries neither memory table — nothing has ever been written through lib/memory-store.mjs at this path',
      ...blank, records: 0, bytes: 0, receipts: 0, adapters: {}, neverObserved: true, storeAbsent: false,
    };
  }
  if (tables.length === 1) {
    return { path: p, state: 'unreadable', reason: `only one of the two memory tables exists (${tables[0]}) — a half-built schema is a fault, not an empty store`, ...blank };
  }
  try {
    const s = stats({ path: p });
    return { path: p, state: s.storeAbsent ? 'absent' : 'present', reason: null, ...s };
  } catch (e) {
    return { path: p, state: 'unreadable', reason: `memory store unreadable: ${(e && e.code) || (e && e.message) || 'error'}`, ...blank };
  }
}

/**
 * A query against a table that was never created is the schema-absent case reaching a reader, not a
 * fault. Decided on the SQLite error CODE plus the table name it names — and the authoritative
 * sqlite_master check in storeSnapshot() is what the page actually reports; this only keeps a
 * listing from turning that same fact into a red one.
 */
const missingTable = (e) => Boolean(e && /no such table: memory_(record|receipt)/.test(String(e.message || '')));

/** Identities that have a record row, newest first. Own query — memory-store is not edited for this. */
export function listRecords({ path = null, limit = 25 } = {}) {
  const p = path || dbPath();
  let db;
  try { db = openForRead({ path: p }); }
  catch (e) { return { state: 'unreadable', reason: `${(e && e.code) || 'error'}`, rows: null }; }
  if (!db) return { state: 'absent', reason: 'no memory store exists at this path', rows: null };
  try {
    const rows = db.prepare(
      `SELECT external_id, content_sha256, bytes, memory_type, tags, scope, project, version, created_at, updated_at
       FROM memory_record ORDER BY updated_at DESC, external_id ASC LIMIT ?`,
    ).all(limit);
    return { state: 'ok', reason: null, rows: rows.map((r) => ({ ...r, tags: parseTags(r.tags).tags })) };
  } catch (e) {
    return { state: missingTable(e) ? 'schema-absent' : 'unreadable', reason: `${(e && e.message) || 'error'}`, rows: null };
  } finally { db.close(); }
}

/** Identities that have RECEIPTS, newest first — including ids with no record row on this box. */
export function listReceiptIdentities({ path = null, limit = 25 } = {}) {
  const p = path || dbPath();
  let db;
  try { db = openForRead({ path: p }); }
  catch (e) { return { state: 'unreadable', reason: `${(e && e.code) || 'error'}`, rows: null }; }
  if (!db) return { state: 'absent', reason: 'no memory store exists at this path', rows: null };
  try {
    const rows = db.prepare(
      `SELECT external_id, COUNT(*) AS receipts, MAX(at) AS last_at
       FROM memory_receipt GROUP BY external_id ORDER BY last_at DESC, external_id ASC LIMIT ?`,
    ).all(limit);
    return { state: 'ok', reason: null, rows };
  } catch (e) {
    return { state: missingTable(e) ? 'schema-absent' : 'unreadable', reason: `${(e && e.message) || 'error'}`, rows: null };
  } finally { db.close(); }
}

// ── The rollup population ───────────────────────────────────────────────────

/** stat() decides absence, never a regex over an error message. */
function statOrState(p) {
  try {
    const st = statSync(p);
    return { state: 'present', bytes: st.size, mtime: st.mtime.toISOString(), reason: null };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { state: 'absent', bytes: null, mtime: null, reason: 'ENOENT — legitimately not there' };
    return { state: 'unreadable', bytes: null, mtime: null, reason: `${(e && e.code) || 'error'} — a fault, not an absence` };
  }
}

/**
 * Every declared report directory, and whether it carries a rollup and the export path's own
 * receipt file beside it (monitor/export-overwatch.mjs:208-225).
 *
 * A registry that cannot be read yields state 'unreadable' and a NULL population — never 0, which
 * would let "the fleet has no rollups" stand in for "this page could not find out".
 */
export function rollupSurvey({ root = null, reg = null } = {}) {
  const override = root || process.env.CW_MEMORY_VIEW_ROOT || null;   // env at CALL time
  let dirs = [];
  let base = override;
  if (override) {
    try {
      base = resolve(override);
      dirs = [base, ...readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => join(base, d.name))];
    } catch (e) {
      return { state: 'unreadable', root: base, reason: `report root unreadable: ${(e && e.code) || 'error'}`, sites: [], rollups: null, withReceipts: null, receipts: null };
    }
  } else {
    try {
      const r = reg || loadRegistry({ quiet: true });
      base = reportsRootDir(r);
      dirs = (r.areas || []).map((a) => outDirFor(a.slug, r, { env: false }));
    } catch (e) {
      return { state: 'unreadable', root: null, reason: `the area registry could not be read (${(e && e.message) || 'error'}), so the rollup population is UNKNOWN — not zero`, sites: [], rollups: null, withReceipts: null, receipts: null };
    }
  }

  const sites = [];
  for (const dir of [...new Set(dirs)]) {
    const rollup = statOrState(join(dir, ROLLUP_FILE));
    if (rollup.state === 'absent') continue;                 // a dir with no rollup is not a site
    const receiptsPath = join(dir, RECEIPTS_FILE);
    const rec = statOrState(receiptsPath);
    const site = { dir, rollupPath: join(dir, ROLLUP_FILE), rollup, receiptsPath, receipts: rec, payload: null, payloadReason: null, count: null, health: null };
    if (rec.state === 'present') {
      try {
        const p = JSON.parse(readFileSync(receiptsPath, 'utf8'));
        site.payload = p;
        site.count = Array.isArray(p.receipts) ? p.receipts.length : null;
        if (site.count === null) site.payloadReason = 'the receipts file carries no `receipts` array';
        // THE PRESENCE OF THE FILE IS NOT THE OUTCOME OF THE EXPORT. Before this, a site whose 22
        // writes all failed rendered identically to one whose 2 verified — `N receipts`, in an ok
        // pill. The classifier is the sweep's own, so the page and the verdict cannot disagree.
        site.health = { ...classifyReceipts(p), area: p.area || dir.split('/').pop() || null };
      } catch (e) {
        // A parse failure is never an empty file (CLAUDE.md, fail closed).
        site.receipts = { state: 'unreadable', bytes: rec.bytes, mtime: rec.mtime, reason: `unparseable: ${e.message}` };
        site.payloadReason = `unparseable: ${e.message}`;
        site.health = { state: 'unreadable', rank: 3, kind: 'broken', counts: null, failedReasons: [],
          reason: `unparseable: ${e.message}`, area: dir.split('/').pop() || null };
      }
    } else if (rec.state === 'absent') {
      site.health = { state: 'absent', rank: 2, kind: 'behind', counts: null, failedReasons: [],
        reason: EXPORT_MEANING.absent, area: dir.split('/').pop() || null };
    } else {
      site.health = { state: 'unreadable', rank: 3, kind: 'broken', counts: null, failedReasons: [],
        reason: rec.reason, area: dir.split('/').pop() || null };
    }
    sites.push(site);
  }
  sites.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  const withReceipts = sites.filter((s) => s.receipts.state === 'present').length;
  const unreadable = sites.filter((s) => s.receipts.state === 'unreadable').length;
  return {
    state: 'ok', root: base, reason: null, sites,
    rollups: sites.length,
    withReceipts,
    unreadable,
    receipts: sites.reduce((n, s) => n + (s.count || 0), 0),
    exports: summariseExports(sites.map((s) => s.health)),
  };
}

/** external_id -> the rollup that a receipts file on disk says it came from. A RECORDED join. */
export function diskReceiptIndex(survey) {
  const idx = new Map();
  for (const s of survey.sites || []) {
    const rs = (s.payload && Array.isArray(s.payload.receipts)) ? s.payload.receipts : [];
    for (const r of rs) {
      if (!r || !r.external_id) continue;
      const list = idx.get(r.external_id) || [];
      list.push({ receipt: r, site: s });
      idx.set(r.external_id, list);
    }
  }
  return idx;
}

// ── Observation state — the empty case, said out loud ───────────────────────

/**
 * TWO BACKENDS, TWO SENTENCES — the same rule this file already holds for state vs storedForm.
 *
 * The local SQLite store and the memory-layer export are different backends measured from different
 * evidence, and one headline can only be about one of them. Measured on this box 2026-10-03: the
 * local store is ABSENT (grey, nothing has ever been written through it) while 42 of the 390
 * receipts on disk record a write that FAILED. Collapsing those into one sentence published the
 * grey one, under a calm header, about a lane with six broken areas — and the page written to
 * refuse exactly that was doing it.
 *
 * `state`, `headline` and `detail` stay the LOCAL store's, unchanged, so nothing that reads this
 * for the store's own condition shifts underneath. `tone` is the louder of the two, and `exports`
 * carries the remote sentence for the renderer to print beside it.
 */
export function observationState(store, survey) {
  const local = localObservation(store, survey);
  const exports = exportObservation(survey);
  return { ...local, tone: louder(local.tone, exports.tone), local, exports };
}

/** The memory-layer export's own sentence, from the receipts on disk. Never the local store's. */
export function exportObservation(survey) {
  if (survey.state !== 'ok' || !survey.exports) {
    return { state: 'unknown', tone: 'grey',
      headline: 'the export\'s outcome is UNKNOWN — the rollup population could not be read',
      detail: `Nothing here is a reading: ${survey.reason || 'no survey was supplied'}.` };
  }
  const x = survey.exports;
  if (x.areasCounted === 0) {
    return { state: 'never-observed', tone: 'grey',
      headline: 'no report directory carries an export receipt — the export has never been observed here',
      detail: `The lane exits 0 on every outcome (monitor/export-overwatch.mjs), so with no ${RECEIPTS_FILE} anywhere, exit-0-always is silent-failure-always.` };
  }
  // TONE AND KIND ARE NOT THE SAME QUESTION, and this is where over-reporting gets in. `absent`
  // and `stale` are areas NOBODY HAS MEASURED; they rank as work to do (kind `behind`, so the
  // fleet page lists them) and they are GREY here, because an unmeasured export must not be
  // published as a pass and must not be published as a finding either. Grading them amber was a
  // live regression against this page's own two grey tests.
  const measured = x.byState.degraded;
  const faults = x.byState.unreadable;
  const unmeasured = x.byState.absent + x.byState.stale;
  if (x.failedReceipts > 0) {
    return { state: 'failed', tone: 'alarm',
      headline: `${x.failedReceipts} export write${x.failedReceipts === 1 ? '' : 's'} FAILED across ${x.byState.failed} of ${x.areasCounted} area${x.areasCounted === 1 ? '' : 's'} — those records are not in the backend`,
      detail: `${x.receipts} receipt${x.receipts === 1 ? '' : 's'} sit in ${RECEIPTS_FILE} files on disk, so the lane is writing evidence; ${x.failedReceipts} of them record a write that did NOT happen and ${x.unverifiedReceipts} more were accepted and never read back. A count of receipts is not a count of stored records.` };
  }
  if (faults > 0) {
    return { state: 'unreadable', tone: 'alarm',
      headline: `${faults} of ${x.areasCounted} area${x.areasCounted === 1 ? '' : 's'} have receipts this page could not read — their export outcome is UNKNOWN`,
      detail: 'A parse failure or a permission error is a fault, not an empty result. No claim about those areas is a reading.' };
  }
  if (measured > 0) {
    return { state: 'degraded', tone: 'warn',
      headline: `${measured} of ${x.areasCounted} area${x.areasCounted === 1 ? '' : 's'} report a degraded export — ${x.unverifiedReceipts} write${x.unverifiedReceipts === 1 ? '' : 's'} accepted and never read back`,
      detail: `No write failed outright. Accepted-unverified is neither a pass nor a failure and is counted on its own axis rather than folded into either.${unmeasured ? ` A further ${unmeasured} area(s) have no current receipt at all and are unmeasured, not clean.` : ''}` };
  }
  if (unmeasured > 0 && unmeasured === x.areasCounted) {
    return { state: 'never-observed', tone: 'grey',
      headline: `no export has been observed for any of the ${x.areasCounted} area${x.areasCounted === 1 ? '' : 's'} on disk — ${x.byState.absent} wrote no receipt, ${x.byState.stale} carry one older than their own rollup`,
      detail: `The lane exits 0 on every outcome (monitor/export-overwatch.mjs), so absence of a ${RECEIPTS_FILE} is silence rather than a pass. It is also not a finding: nothing here measured a failure.` };
  }
  if (unmeasured > 0) {
    return { state: 'partly-observed', tone: 'grey',
      headline: `${x.areasCounted - unmeasured} of ${x.areasCounted} area${x.areasCounted === 1 ? '' : 's'} report a clean export; the other ${unmeasured} were not measured`,
      detail: `${x.byState.absent} area(s) wrote no receipt and ${x.byState.stale} carry one older than their own rollup. Those are unobserved, which is neither a pass nor a failure, and they are excluded from the clean count rather than added to it.` };
  }
  return { state: 'verified', tone: 'ok',
    headline: `every export on disk reports a clean write — ${x.receipts} receipt${x.receipts === 1 ? '' : 's'} across ${x.areasCounted} area${x.areasCounted === 1 ? '' : 's'}, none failed`,
    detail: `${x.byState.verified} area(s) fully verified, ${x.byState['not-attempted']} dry-run, ${x.byState.skipped} switched off.` };
}

function localObservation(store, survey) {
  const pop = survey.state === 'ok'
    ? `${survey.rollups} rollup${survey.rollups === 1 ? '' : 's'}`
    : 'a rollup population this page could not read';
  if (store.state === 'unreadable') {
    return { state: 'unreadable', tone: 'alarm',
      headline: `the memory store could not be read — ${store.reason}`,
      detail: 'This page cannot say whether anything was written. An unreadable store is a fault, not an empty one.' };
  }
  if (store.state === 'schema-absent') {
    return { state: 'schema-absent', tone: 'grey',
      headline: `no write has ever been observed here: the database at ${store.path} exists but carries neither memory table`,
      detail: `The file is present; lib/memory-store.mjs has never created its schema at this path, so there are no records and no receipts to show. That is ABSENCE OF WRITING, not a fault and not a clean run. ${survey.state === 'ok' ? `${survey.withReceipts} of ${survey.rollups} rollups on disk carry a ${RECEIPTS_FILE}.` : `The rollup population is unknown: ${survey.reason}`}` };
  }
  if (store.state === 'absent') {
    return { state: 'store-absent', tone: 'grey',
      headline: `no memory store exists at ${store.path} — the database has never been created, so no write has ever been recorded here`,
      detail: `Scanned ${pop} for the export path's own receipt file (${RECEIPTS_FILE}); ${survey.state === 'ok' ? `${survey.withReceipts} carry one` : 'the scan itself did not complete'}. This is ABSENCE, and it is a different fact from a store that exists and holds nothing.` };
  }
  if (store.receipts === 0) {
    return { state: 'never-observed', tone: 'grey',
      headline: `no write has ever been observed here: 0 receipts across ${pop}`,
      detail: `The store at ${store.path} EXISTS and holds ${store.records} record${store.records === 1 ? '' : 's'}, and not one write attempt has been recorded against it. ${survey.state === 'ok' ? `${survey.withReceipts} of ${survey.rollups} rollups on disk carry a ${RECEIPTS_FILE}.` : `The rollup population is unknown: ${survey.reason}`} Absence of evidence is its own state; it is not a clean run.` };
  }
  return { state: 'observed', tone: survey.state === 'ok' && survey.withReceipts === 0 ? 'warn' : 'ok',
    headline: `${store.receipts} receipt${store.receipts === 1 ? '' : 's'} recorded across ${store.records} record${store.records === 1 ? '' : 's'}`,
    detail: survey.state === 'ok' && survey.withReceipts === 0
      ? `The store has receipts, but 0 of ${survey.rollups} rollups on disk carry a ${RECEIPTS_FILE} — the export path's own evidence trail is still empty everywhere.`
      : `${survey.state === 'ok' ? `${survey.withReceipts} of ${survey.rollups} rollups carry a ${RECEIPTS_FILE}.` : `The rollup population is unknown: ${survey.reason}`}` };
}

// ── The eight steps ─────────────────────────────────────────────────────────

/** 1 SOURCE — the artefact on disk. Hashed here, and only here; the survey only stats. */
export function sourceStep(sourcePath) {
  if (!sourcePath) {
    return step(1, 'source', 'SOURCE', [
      unseen('artefact', 'no receipt on this box names a source artefact for this record — memory_receipt has no source column, and no receipts file on disk mentions this identity'),
      unseen('bytes', 'no artefact to measure'),
      unseen('sha256', 'no artefact to hash'),
      unseen('mtime', 'no artefact to stat'),
    ]);
  }
  const st = statOrState(sourcePath);
  if (st.state !== 'present') {
    return step(1, 'source', 'SOURCE', [
      seen('artefact', sourcePath, { tone: st.state === 'absent' ? 'grey' : 'alarm' }),
      unseen('bytes', st.reason), unseen('sha256', st.reason), unseen('mtime', st.reason),
    ], { forceGrey: st.state === 'absent'
      ? 'the receipt names an artefact that is no longer on disk (ENOENT) — the write is recorded, its source is gone'
      : `the named artefact could not be read: ${st.reason}` });
  }
  let hash = null; let hashReason = null;
  try { hash = sha256(readFileSync(sourcePath)); }
  catch (e) { hashReason = `could not be hashed: ${(e && e.code) || e.message}`; }
  return step(1, 'source', 'SOURCE', [
    seen('artefact', sourcePath),
    seen('bytes', st.bytes),
    hash ? seen('sha256', hash, { note: short(hash) }) : unseen('sha256', hashReason),
    seen('mtime', st.mtime),
  ]);
}

/**
 * 2 REDACT — allow-listed fields kept, deny-listed refused, and the GATE VERDICT.
 *
 * The verdict comes from the receipt when the receipt recorded one (a refusal states itself in
 * `reason`), and otherwise from re-running the SAME gate over the stored row. With neither, it is
 * grey — a gate whose verdict nobody recorded did not pass.
 */
export function redactStep(receipt, record) {
  const fields = [
    seen('mechanism', 'ALLOW-LIST — rows are constructed from a declared field list, never spread from a source object'),
    seen('deny-list', `${CREDENTIAL_FIELDS.length} credential-bearing field names refused outright`, { note: CREDENTIAL_FIELDS.join(', ') }),
    seen('on failure', 'REFUSE and report — never sanitise-and-write, which is a guess about where the secret ended'),
  ];
  const refused = receipt && typeof receipt.reason === 'string' && /^redaction gate refused/i.test(receipt.reason);
  if (refused) {
    fields.push(seen('kept fields', 'none — the write was refused before any field was kept', { tone: 'alarm' }));
    fields.push(seen('verdict', 'REFUSED', { note: receipt.reason, tone: 'alarm' }));
    return step(2, 'redact', 'REDACT', fields);
  }
  if (record && typeof record.content === 'string') {
    const g = redactionCheck({ content: record.content, tags: record.tags, external_id: record.external_id, memory_type: record.memory_type });
    fields.push(seen('kept fields', ['external_id', 'content', 'memory_type', 'tags'].join(', '),
      { note: 'the declared field list this record was built from' }));
    fields.push(g.ok
      ? seen('verdict', 'KEPT — the same gate, re-run against the stored row just now, still passes')
      : seen('verdict', 'WOULD BE REFUSED NOW', { note: g.reasons.join('; '), tone: 'alarm' }));
    return step(2, 'redact', 'REDACT', fields);
  }
  fields.push(unseen('kept fields', 'no stored row on this box, so the field list that survived the gate is not recoverable'));
  fields.push(unseen('verdict', 'no receipt recorded a gate verdict and there is no stored content to re-run the gate against — the gate is UNWITNESSED for this record, which is not the same as having passed'));
  return step(2, 'redact', 'REDACT', fields);
}

/** 3 LOCAL — the durable write. */
export function localStep(record, localReceipt, storeState) {
  if (!record) {
    const why = (storeState === 'absent' || storeState === 'schema-absent')
      ? 'no durable local row exists on this box (the store is absent, or carries no memory tables) — the remote write, if any, stands alone'
      : storeState === 'unreadable'
        ? 'the memory store could not be read, so whether a durable local row exists is UNKNOWN'
        : 'no memory_record row carries this external_id — this identity is known only from a receipt';
    return step(3, 'local', 'LOCAL (durable write)', [
      unseen('external_id', why), unseen('content bytes', why), unseen('row version', why),
    ], { forceGrey: why });
  }
  return step(3, 'local', 'LOCAL (durable write)', [
    seen('external_id', record.external_id, { note: 'identity is external_id, never a row id' }),
    seen('content bytes', record.bytes, { note: 'the FULL content, held on this disk' }),
    seen('content sha256', record.content_sha256, { note: short(record.content_sha256) }),
    seen('row version', record.version, { note: 'advances on CONTENT CHANGE, never on occurrence' }),
    seen('scope / project', `${record.scope}${record.project ? ` / ${record.project}` : ' / (no project)'}`),
    seen('updated', record.updated_at),
    localReceipt
      ? seen('local receipt', `${localReceipt.state} · ${localReceipt.storedForm}`, { tone: louder(stateTone(localReceipt.state), formTone(localReceipt.storedForm)) })
      : unseen('local receipt', 'the row exists but no receipt was recorded for the local write — the row is here, the event is not'),
  ]);
}

/** 4 SEND — bytes sent, tags sent, the adapter and its declared capability row. */
export function sendStep(receipt, record) {
  const cap = adapterRow(receipt.adapter);
  const bytesKnown = record && record.content_sha256 && receipt.contentSha256 && record.content_sha256 === receipt.contentSha256;
  return step(4, 'send', 'SEND', [
    seen('adapter', receipt.adapter || '(unnamed)', { tone: cap ? 'ok' : 'grey' }),
    cap
      ? seen('declared capability', `${cap.durability} — ${cap.holds}`, { note: cap.source, tone: cap.durability === 'full' ? 'ok' : 'warn' })
      : unseen('declared capability', 'this adapter declares no capability row, so what it does with a payload is not a known property of the backend'),
    bytesKnown
      ? seen('bytes sent', record.bytes, { note: 'derived: the stored row carries the same content hash as this receipt, so its byte count is the payload’s' })
      : unseen('bytes sent', 'memory_receipt records a content HASH and no byte count, and no local row with a matching hash is here to supply one'),
    receipt.contentSha256 ? seen('content sha256 sent', receipt.contentSha256, { note: short(receipt.contentSha256) }) : unseen('content sha256 sent', 'no content hash on this receipt'),
    receipt.tagsSent
      ? seen('tags sent', `${receipt.tagsSent.length}`, { note: receipt.tagsSent.join(', ') })
      : unseen('tags sent', receipt.tagsSentReason || 'no tags recorded'),
    seen('truncated at source', receipt.truncated ? 'YES — the caller shortened the content before sending' : 'no', { tone: receipt.truncated ? 'warn' : 'ok' }),
  ]);
}

/** 5 ACCEPT — what the backend said back. Each unknown is its own grey, with its own reason. */
export function acceptStep(receipt) {
  return step(5, 'accept', 'ACCEPT', [
    receipt.remoteId ? seen('id returned', receipt.remoteId) : unseen('id returned', 'the response carried no id — there is nothing to read back, which is why this cannot be verified'),
    receipt.wasUpdate === null
      ? unseen('was_update', 'the backend did not say whether this was an update; an unknown is NOT an insert')
      : seen('was_update', receipt.wasUpdate ? 'true — superseded an existing record' : 'false — a new record', { note: 'a moving id turns every update into a fresh, perfectly-verifying insert; this is the canary' }),
    receipt.remoteVersion === null || receipt.remoteVersion === undefined
      ? unseen('version returned', 'the backend returned no version')
      : seen('version returned', receipt.remoteVersion),
    receipt.at ? seen('at', receipt.at) : unseen('at', 'the receipt carries no timestamp'),
  ]);
}

/** 6 READBACK — what the backend actually holds. */
export function readbackStep(receipt) {
  const sent = receipt.tagsSent ? receipt.tagsSent.length : null;
  const stored = receipt.tagsStoredCount;
  let tagsField;
  if (stored === null || stored === undefined) {
    tagsField = unseen('tags stored', 'no tag count came back — the readback did not happen, or carried no tags');
  } else if (sent === null) {
    tagsField = seen('tags stored', stored, { note: 'the sent tags were not recorded, so minted extras cannot be counted' });
  } else if (stored >= sent) {
    tagsField = seen('tags stored', `${stored} (${stored - sent} minted by the backend)`, { note: 'tags are asserted as a SUPERSET: a backend that mints tags from content legitimately stores more than it was sent' });
  } else {
    tagsField = seen('tags stored', `${stored} — ${sent - stored} SENT TAG(S) DROPPED`, { tone: 'warn', note: 'the record is not scoped as intended; a dropped scope tag makes it invisible to its own scoped search' });
  }
  return step(6, 'readback', 'READBACK', [
    receipt.storedSha256 ? seen('stored sha256', receipt.storedSha256, { note: short(receipt.storedSha256) })
      : unseen('stored sha256', 'nothing was read back — the stored bytes were never hashed, so what the backend holds is unknown'),
    unseen('stored bytes', 'memory_receipt has no stored-bytes column: the readback recorded a HASH and a coverage fraction, never a length'),
    tagsField,
  ]);
}

/**
 * 7 COMPARE — the two hashes, then THREE separate witnesses.
 *
 * coverage and containment are different questions and get different bars: a preview is high
 * containment and low coverage, corruption is low on both, and one bar cannot say which. lengthRatio
 * is the independent witness for coverage, which inflates on repetitive text.
 *
 * Two of the three are NOT PERSISTED. lib/memory-store.mjs's SCHEMA keeps stored_coverage and
 * nothing else, so containment and lengthRatio — measured at write time by classifyStored() — are
 * gone by the time this page loads. They render grey with that reason rather than as zero, which is
 * the number a reader would act on. Pass `classification` (a classifyStored() result) to fill them.
 */
export function compareStep(receipt, { classification = null } = {}) {
  const bars = [];
  const bothHashes = Boolean(receipt.contentSha256 && receipt.storedSha256);
  const equal = bothHashes && receipt.contentSha256 === receipt.storedSha256;

  const bar = (label, value, reason, note) => (value === null || value === undefined
    ? { label, state: 'grey', value: null, pct: null, reason, note: null }
    : { label, state: 'observed', value, pct: Math.max(0, Math.min(1, value)), reason: null, note });

  const NOT_KEPT = 'not persisted: lib/memory-store.mjs SCHEMA records stored_coverage only, so this witness was measured at write time and discarded';
  if (classification) {
    bars.push(bar('coverage — how much of the SOURCE is present in what was stored', classification.coverage, 'not measured', 'measured now by classifyStored()'));
    bars.push(bar('containment — how much of what was STORED comes from the source', classification.containment, 'not measured', 'measured now by classifyStored()'));
    bars.push(bar('length ratio — the independent witness for coverage', classification.lengthRatio, 'not measured', 'measured now by classifyStored()'));
  } else if (equal) {
    const note = 'derived from hash equality: identical hashes mean the stored text IS the source text';
    bars.push(bar('coverage — how much of the SOURCE is present in what was stored', 1, null, note));
    bars.push(bar('containment — how much of what was STORED comes from the source', 1, null, note));
    bars.push(bar('length ratio — the independent witness for coverage', 1, null, note));
  } else {
    bars.push(bar('coverage — how much of the SOURCE is present in what was stored', receipt.storedCoverage,
      receipt.storedCoverage === null ? 'no coverage was recorded on this receipt' : null,
      'stored_coverage, as recorded at write time'));
    bars.push(bar('containment — how much of what was STORED comes from the source', null, NOT_KEPT));
    bars.push(bar('length ratio — the independent witness for coverage', null, NOT_KEPT));
  }

  const fields = [
    receipt.contentSha256 ? seen('sent (content) sha256', receipt.contentSha256, { note: short(receipt.contentSha256) }) : unseen('sent (content) sha256', 'no content hash on this receipt'),
    receipt.storedSha256 ? seen('stored sha256', receipt.storedSha256, { note: short(receipt.storedSha256) }) : unseen('stored sha256', 'nothing was read back, so there is no stored hash to set beside the sent one'),
    bothHashes
      ? seen('hashes', equal ? 'IDENTICAL' : 'DIFFER', { tone: equal ? 'ok' : 'warn', note: equal ? null : 'differing hashes are truncation OR corruption — the bars below are what tells them apart' })
      : unseen('hashes', 'only one side of the comparison exists, so no comparison was made — that is not a match'),
  ];
  const s = step(7, 'compare', 'COMPARE', fields);
  s.bars = bars;
  s.tolerance = { preview: PREVIEW_TOLERANCE, containmentFloor: CONTAINMENT_FLOOR };
  if (bars.every((b) => b.state === 'grey')) s.tone = 'grey';
  return s;
}

/**
 * 8 VERDICT — TWO AXES, TWO COLUMNS, NEVER ONE BADGE.
 *
 * A previewed write is `accepted-unverified` AND `preview`: it happened, and it is not a durable
 * copy. Folding those into one pill drops whichever half the fold did not choose, and the half it
 * drops is the one nobody would otherwise learn.
 */
export function verdictStep(receipt) {
  const st = receipt.state || null;
  const fm = receipt.storedForm || null;
  const axes = [
    {
      axis: 'state', question: 'Did the write happen?',
      value: st, tone: st ? stateTone(st) : 'grey',
      meaning: st ? stateMeaning(st) : null,
      reason: st ? null : 'this receipt carries no state — the outcome of the write was never recorded',
      declared: [VERIFIED, ACCEPTED_UNVERIFIED, FAILED, NOT_ATTEMPTED].includes(st),
    },
    {
      axis: 'storedForm', question: 'Is what the backend holds a durable copy?',
      value: fm, tone: fm ? formTone(fm) : 'grey',
      meaning: fm ? formMeaning(fm) : null,
      reason: fm ? null : 'this receipt carries no stored form — whether the backend holds a copy was never determined',
      declared: [STORED_FULL, STORED_PREVIEW, STORED_DIVERGENT, STORED_UNKNOWN].includes(fm),
    },
  ];
  const notes = [];
  if (st === ACCEPTED_UNVERIFIED && fm === STORED_PREVIEW) {
    notes.push('BOTH FACTS AT ONCE: the write was ACCEPTED and the stored record is NOT A DURABLE COPY. Neither half may be dropped.');
  }
  if (fm === STORED_DIVERGENT) {
    notes.push('DIVERGENT is the loudest form here: the stored text is not derived from the source at all. This is corruption, not truncation, and it keeps its own name so preview-detection can never swallow it.');
  }
  if (st === NOT_ATTEMPTED) {
    notes.push('A dry run wrote nothing and lost nothing. It is never folded into failed.');
  }
  if (receipt.reason) notes.push(`reason recorded: ${receipt.reason}`);
  if (st && st !== VERIFIED && !receipt.reason) {
    notes.push('A degraded state with NO stated reason — the contract requires one, and its absence is itself the finding.');
  }
  const s = step(8, 'verdict', 'VERDICT', axes.map((a) => (a.value
    ? seen(a.axis, a.value, { note: a.meaning, tone: a.tone })
    : unseen(a.axis, a.reason))));
  s.axes = axes;
  s.notes = notes;
  s.tone = axes.reduce((t, a) => louder(t, a.tone), 'ok');
  return s;
}

/** The eight steps for ONE receipt. */
export function stepsForReceipt(rawReceipt, { record = null, sourcePath = null, classification = null, storeState = 'present', localReceipt = null } = {}) {
  const r = normaliseReceipt(rawReceipt);
  return {
    receipt: r,
    adapter: r.adapter,
    capability: adapterRow(r.adapter),
    steps: [
      sourceStep(sourcePath),
      redactStep(r, record),
      localStep(record, localReceipt || (r.adapter === 'local' ? r : null), storeState),
      sendStep(r, record),
      acceptStep(r),
      readbackStep(r),
      compareStep(r, { classification }),
      verdictStep(r),
    ],
  };
}

/** Every trail for one identity: the record row, its receipts (newest first), and the disk join. */
export function recordView(externalId, { path = null, survey = null, limit = 20 } = {}) {
  const p = path || dbPath();
  const store = storeSnapshot({ path: p });
  const sv = survey || rollupSurvey({});
  const idx = diskReceiptIndex(sv);
  const fromDisk = idx.get(externalId) || [];

  let record = null; let recordReason = null;
  try { record = get(externalId, { path: p }); }
  catch (e) { recordReason = `the record row could not be read: ${(e && e.code) || e.message}`; }
  if (!record && !recordReason) {
    recordReason = store.state === 'absent' ? 'no memory store exists on this box'
      : store.state === 'schema-absent' ? 'the database exists but carries no memory_record table'
        : 'no memory_record row carries this external_id';
  }

  let receipts = []; let receiptsReason = null;
  try { receipts = receiptsFor(externalId, { path: p, limit }); }
  catch (e) { receiptsReason = `receipts could not be read: ${(e && e.code) || e.message}`; }

  const local = receipts.map(normaliseReceipt).find((r) => r.adapter === 'local') || null;
  const trails = [];
  for (const raw of receipts) {
    const n = normaliseReceipt(raw);
    const disk = fromDisk.find((d) => d.receipt.adapter === n.adapter) || fromDisk[0] || null;
    trails.push(stepsForReceipt(raw, {
      record, localReceipt: local, storeState: store.state,
      sourcePath: disk ? (disk.site.payload && disk.site.payload.rollup ? resolve(disk.site.payload.rollup) : disk.site.rollupPath) : null,
    }));
  }
  for (const d of fromDisk) {
    if (trails.some((t) => t.receipt.adapter === d.receipt.adapter && t.receipt.at === d.receipt.at)) continue;
    trails.push(stepsForReceipt(d.receipt, {
      record, localReceipt: local, storeState: store.state,
      sourcePath: d.site.payload && d.site.payload.rollup ? resolve(d.site.payload.rollup) : d.site.rollupPath,
      origin: 'disk',
    }));
  }
  return {
    externalId, record, recordReason,
    receiptsReason,
    trails,
    trailsReason: trails.length ? null
      : `no write has ever been observed for this identity: 0 receipts in the store and 0 in any ${RECEIPTS_FILE} on disk`,
    store, survey: sv,
  };
}

/** The whole model the page renders. Deterministic under CW_NOW. */
export function buildModel({ path = null, root = null, id = null, limit = 12 } = {}) {
  const p = path || dbPath();
  const store = storeSnapshot({ path: p });
  const survey = rollupSurvey({ root });
  const observation = observationState(store, survey);
  const adapters = adapterComparison(store.adapters);

  const model = {
    generatedAt: now(),
    dbPath: p,
    store, survey, observation, adapters,
    records: null, recordsReason: null,
    identities: null, identitiesReason: null,
    record: null,
  };
  const recs = listRecords({ path: p, limit });
  if (recs.state === 'ok') model.records = recs.rows;
  else model.recordsReason = recs.state === 'absent' ? 'no memory store exists on this box'
    : recs.state === 'schema-absent' ? 'the database carries no memory_record table — nothing has ever been written here'
      : `the record table could not be read: ${recs.reason}`;

  const ids = listReceiptIdentities({ path: p, limit });
  if (ids.state === 'ok') model.identities = ids.rows;
  else model.identitiesReason = ids.state === 'absent' ? 'no memory store exists on this box'
    : ids.state === 'schema-absent' ? 'the database carries no memory_receipt table — no write attempt has ever been recorded here'
      : `the receipt table could not be read: ${ids.reason}`;

  if (id) model.record = recordView(id, { path: p, survey });
  else {
    const first = (ids.rows && ids.rows[0] && ids.rows[0].external_id)
      || (recs.rows && recs.rows[0] && recs.rows[0].external_id) || null;
    if (first) model.record = recordView(first, { path: p, survey });
  }
  return model;
}

// ── Rendering ───────────────────────────────────────────────────────────────
//
// Self-contained and file:// safe: one document, data inlined, NO stylesheet link, NO external
// script, NO CDN, NO external font. The house tokens and the theme switch are inlined, and the
// panel's CSP hashes each <style> block it sends. Opened from disk, the page follows the OS theme.

export { esc };

const tone = (token) => ({ fg: `var(--${token})`, bg: `color-mix(in srgb,var(--${token}) 12%,transparent)`,
  bd: `color-mix(in srgb,var(--${token}) 28%,transparent)` });
const COLOUR = { ok: tone('live'), warn: tone('part'), alarm: tone('crit'), grey: tone('plan') };
const c = (tone) => COLOUR[tone] || COLOUR.grey;

const S = {
  body: 'margin:0;padding:1.5rem;background:var(--bg);color:var(--ink);font:.875rem/1.5 var(--sans)',
  wrap: 'max-width:68.75rem;margin:0 auto',
  h1: 'font-size:1.25rem;margin:0 0 .25rem;color:var(--head)',
  sub: 'color:var(--mut);margin:0 0 1.25rem;font-size:.8125rem',
  card: 'background:var(--panel);border:1px solid var(--line);border-radius:.5rem;padding:.875rem 1rem;margin:0 0 .875rem',
  h2: 'font-size:.9375rem;margin:0 0 .625rem;letter-spacing:.02em;color:var(--head)',
  table: 'width:100%;border-collapse:collapse;font-size:.8125rem',
  th: 'text-align:left;padding:.375rem .5rem;border-bottom:2px solid var(--line2);font-weight:600;vertical-align:top;color:var(--head)',
  td: 'padding:.375rem .5rem;border-bottom:1px solid var(--line);vertical-align:top',
  key: 'padding:.375rem .5rem;border-bottom:1px solid var(--line);vertical-align:top;color:var(--mut);width:13.125rem',
  mono: 'font-family:var(--mono);font-size:.75rem;word-break:break-all',
  reason: 'color:var(--mut);font-style:italic',
  note: 'color:var(--mut);font-size:.75rem',
  stepno: 'display:inline-block;min-width:1.375rem;height:1.375rem;line-height:1.375rem;text-align:center;border-radius:.6875rem;background:var(--head);color:var(--bg);font-size:.75rem;margin-right:.5rem',
  barTrack: 'position:relative;height:.875rem;background:var(--panel2);border-radius:.4375rem;overflow:hidden;margin:2px 0 2px',
  barGrey: 'position:relative;height:.875rem;background:repeating-linear-gradient(45deg,var(--panel2),var(--panel2) 6px,var(--line2) 6px,var(--line2) 12px);border-radius:.4375rem;margin:2px 0',
};

const pill = (tone, text, extra = '') => {
  const t = c(tone);
  return `<span data-tone="${esc(tone)}"${extra} style="display:inline-block;padding:1px .5rem;border-radius:.625rem;background:${t.bg};color:${t.fg};border:1px solid ${t.bd};font-size:.75rem;font-weight:600">${esc(text)}</span>`;
};

function fieldRow(f) {
  if (f.state === 'grey') {
    return `<tr><td style="${S.key}">${esc(f.label)}</td><td style="${S.td}" data-state="grey">${pill('grey', 'not observed')} <span style="${S.reason}">${esc(f.reason)}</span></td></tr>`;
  }
  const note = f.note ? `<div style="${S.note}">${esc(f.note)}</div>` : '';
  const val = f.tone && f.tone !== 'ok' ? pill(f.tone, String(f.value)) : `<span style="${S.mono}">${esc(f.value)}</span>`;
  return `<tr><td style="${S.key}">${esc(f.label)}</td><td style="${S.td}" data-state="observed">${val}${note}</td></tr>`;
}

function barBlock(b) {
  if (b.state === 'grey') {
    return `<div data-bar="${esc(b.label.split(' —')[0])}" data-state="grey" style="margin:0 0 .625rem">`
      + `<div style="font-size:.75rem;color:var(--ink)">${esc(b.label)} ${pill('grey', 'not observed')}</div>`
      + `<div style="${S.barGrey}"></div>`
      + `<div style="${S.reason};font-size:.75rem">${esc(b.reason)}</div></div>`;
  }
  const pct = Math.round(b.pct * 1000) / 10;
  const tone = b.pct >= PREVIEW_TOLERANCE ? 'ok' : b.pct >= CONTAINMENT_FLOOR ? 'warn' : 'alarm';
  const t = c(tone);
  return `<div data-bar="${esc(b.label.split(' —')[0])}" data-state="observed" style="margin:0 0 .625rem">`
    + `<div style="font-size:.75rem;color:var(--ink)">${esc(b.label)} <strong>${pct}%</strong></div>`
    + `<div style="${S.barTrack}"><div style="width:${pct}%;height:100%;background:${t.fg}"></div></div>`
    + (b.note ? `<div style="${S.note}">${esc(b.note)}</div>` : '') + '</div>';
}

function stepBlock(s) {
  const head = `<div style="margin:0 0 .5rem"><span style="${S.stepno}">${s.n}</span>`
    + `<strong>${esc(s.title)}</strong> ${pill(s.state === 'grey' ? 'grey' : s.tone, s.state === 'grey' ? 'NOT OBSERVED' : 'observed')}`
    + `<span style="${S.note}"> ${s.observedFields}/${s.totalFields} fields observed</span></div>`;
  const why = s.state === 'grey' ? `<div style="${S.reason};margin:0 0 .5rem">${esc(s.reason)}</div>` : '';
  const rows = `<table style="${S.table}"><tbody>${s.fields.map(fieldRow).join('')}</tbody></table>`;
  const bars = s.bars ? `<div style="margin-top:.625rem">${s.bars.map(barBlock).join('')}</div>` : '';
  const axes = s.axes ? axesBlock(s) : '';
  return `<section data-step="${esc(s.key)}" data-state="${esc(s.state)}" data-tone="${esc(s.tone)}" style="${S.card}">${head}${why}${rows}${bars}${axes}</section>`;
}

/** The two-column verdict. state and storedForm sit in SEPARATE cells, always. */
function axesBlock(s) {
  const cell = (a) => `<td style="${S.td};width:50%" data-axis="${esc(a.axis)}" data-tone="${esc(a.tone)}">`
    + (a.value ? `${pill(a.tone, a.value)}<div style="${S.note}">${esc(a.meaning)}</div>`
      : `${pill('grey', 'not recorded')}<div style="${S.reason};font-size:.75rem">${esc(a.reason)}</div>`)
    + '</td>';
  const notes = s.notes.length
    ? `<ul style="margin:.625rem 0 0;padding-left:1.125rem;font-size:.8125rem">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';
  return `<table style="${S.table};margin-top:.625rem"><thead><tr>`
    + `<th style="${S.th}">state — ${esc(s.axes[0].question)}</th>`
    + `<th style="${S.th}">storedForm — ${esc(s.axes[1].question)}</th>`
    + `</tr></thead><tbody><tr>${cell(s.axes[0])}${cell(s.axes[1])}</tr></tbody></table>${notes}`;
}

function adapterTable(rows) {
  const head = ['backend', 'holds', 'expected storedForm', 'verification', 'mints tags', 'observed here']
    .map((h) => `<th style="${S.th}">${esc(h)}</th>`).join('');
  const body = rows.map((r) => {
    const obs = r.observation === 'observed'
      ? `${pill('ok', 'observed')}<div style="${S.note}">${esc(JSON.stringify(r.counts))}</div>`
      : `${pill('grey', r.observation)}<div style="${S.reason};font-size:.75rem">${esc(r.observationReason)}</div>`;
    const dur = r.durability
      ? pill(r.durability === 'full' ? 'ok' : 'warn', `${r.durability}`)
      : pill('grey', 'undeclared');
    return `<tr data-adapter="${esc(r.adapter)}" data-declared="${r.declared}">`
      + `<td style="${S.td}"><strong>${esc(r.adapter)}</strong><div style="${S.note}">${esc(r.label)}</div></td>`
      + `<td style="${S.td}">${r.holds ? esc(r.holds) : `<span style="${S.reason}">${esc(r.observationReason)}</span>`}</td>`
      + `<td style="${S.td}" data-expected-form="${esc(r.expectedStoredForm || 'undeclared')}">${dur}${r.expectedStoredForm ? `<div style="${S.note}">${esc(r.expectedStoredForm)}</div>` : ''}</td>`
      + `<td style="${S.td}">${r.verification ? esc(r.verification) : '—'}</td>`
      + `<td style="${S.td}">${r.mintsTags === null ? '—' : (r.mintsTags ? 'yes' : 'no')}${r.tagsNote ? `<div style="${S.note}">${esc(r.tagsNote)}</div>` : ''}</td>`
      + `<td style="${S.td}">${obs}</td></tr>`;
  }).join('');
  return `<table style="${S.table}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function surveyBlock(sv) {
  if (sv.state !== 'ok') {
    return `<div data-survey="unreadable" style="${S.card}"><h2 style="${S.h2}">Rollups on disk ${pill('alarm', 'UNREADABLE')}</h2>`
      + `<div style="${S.reason}">${esc(sv.reason)}</div>`
      + '<div style="font-size:.8125rem">The population is UNKNOWN, which is not the same as zero — no count on this page may be read as a denominator.</div></div>';
  }
  // Worst first: an operator reading a 34-row table top-down must not have to reach row 29 to find
  // the area whose every write failed.
  const ordered = [...sv.sites].sort((a, b) => (b.health?.rank ?? 3) - (a.health?.rank ?? 3)
    || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  const rows = ordered.map((s) => {
    const st = s.receipts.state;
    const h = s.health || { state: 'unreadable', kind: 'broken', counts: null, failedReasons: [], reason: 'no outcome was classified for this site' };
    // THE FILE'S PRESENCE AND THE EXPORT'S OUTCOME ARE TWO COLUMNS. The first says the lane spoke;
    // the second says what it said, and only the second is the health of the export.
    const outcomeTone = h.kind === 'ok' ? (h.state === 'verified' ? 'ok' : 'grey')
      : h.kind === 'behind' ? 'warn' : 'alarm';
    const cts = h.counts;
    const split = cts
      ? `${cts.verified}/${cts.total} verified`
        + (cts.failed ? ` · <strong>${cts.failed} FAILED</strong>` : '')
        + (cts.acceptedUnverified ? ` · ${cts.acceptedUnverified} unverified` : '')
        + (cts.notAttempted ? ` · ${cts.notAttempted} dry-run` : '')
        + (cts.unknownState ? ` · ${cts.unknownState} undeclared-state` : '')
      : '';
    const why = h.failedReasons.length
      ? `<div style="${S.note}">${h.failedReasons.map((r) => `${esc(r.reason)} (×${r.count})`).join('<br>')}</div>`
      : '';
    return `<tr data-export-state="${esc(h.state)}" data-export-kind="${esc(h.kind)}">`
      + `<td style="${S.td};${S.mono}">${esc(s.dir)}</td>`
      + `<td style="${S.td}">${pill(st === 'present' ? 'ok' : st === 'absent' ? 'grey' : 'alarm', st === 'present' ? `${s.count === null ? '?' : s.count} receipts` : st)}`
      + (st === 'present' ? '' : `<div style="${S.reason};font-size:.75rem">${esc(s.receipts.reason)}</div>`) + '</td>'
      + `<td style="${S.td}">${pill(outcomeTone, h.state)}`
      + (split ? `<div style="${S.note}">${split}</div>` : '')
      + (h.reason ? `<div style="${S.reason};font-size:.75rem">${esc(h.reason)}</div>` : '') + why + '</td></tr>';
  }).join('');
  // Absent on a model that predates the export axis: the summary line then says so instead of
  // being computed from undefined.
  const x = sv.exports;
  const banner = !x
    ? `<div style="${S.reason}">This survey carries no export outcome, so the column beside each receipt file is the only reading here.</div>`
    : sv.withReceipts === 0
    ? `<div style="${S.reason}">Not one rollup carries a ${esc(RECEIPTS_FILE)}. The export path writes one on every non-dry run (monitor/export-overwatch.mjs), and the lane exits 0 on failure — so with no receipt, exit-0-always is silent-failure-always.</div>`
    : `<div style="font-size:.8125rem;margin:0 0 .5rem">${pill(x.failedReceipts ? 'alarm' : x.needsAttention ? 'warn' : 'ok',
      `${x.failedReceipts} failed · ${x.unverifiedReceipts} unverified · ${x.receipts} total`)}`
      + ` <span style="${S.note}">across ${x.areasCounted} area(s): ${Object.entries(x.byState).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}</span></div>`;
  return `<div data-survey="ok" data-exports="${esc(!x ? 'unsupplied' : x.failedReceipts ? 'failed' : x.needsAttention ? 'degraded' : 'clean')}" style="${S.card}">`
    + `<h2 style="${S.h2}">The export, per report directory — ${sv.withReceipts} of ${sv.rollups} carry a receipt file, and a receipt file is not a clean export`
    + ` ${pill(sv.withReceipts === 0 ? 'grey' : 'ok', `${sv.withReceipts}/${sv.rollups}`)}</h2>${banner}`
    + (rows ? `<table style="${S.table}"><thead><tr><th style="${S.th}">report directory</th><th style="${S.th}">${esc(RECEIPTS_FILE)}</th><th style="${S.th}">export outcome</th></tr></thead><tbody>${rows}</tbody></table>` : `<div style="${S.reason}">No rollup.json was found in any declared report directory under ${esc(sv.root)}.</div>`)
    + '</div>';
}

function storeBlock(store) {
  const rows = [];
  rows.push(['store file', store.state === 'present'
    ? `${pill('ok', 'present')} <span style="${S.mono}">${esc(store.path)}</span>`
    : store.state === 'unreadable'
      ? `${pill('alarm', 'UNREADABLE')} <span style="${S.mono}">${esc(store.path)}</span> <span style="${S.reason}">${esc(store.reason)}</span>`
      : `${pill('grey', store.state === 'absent' ? 'ABSENT' : 'NO SCHEMA')} <span style="${S.mono}">${esc(store.path)}</span> <span style="${S.reason}">${esc(store.reason)}</span>`]);
  // storeAbsent and neverObserved are rendered on SEPARATE rows, because stats() reports them
  // separately and they answer different questions.
  rows.push(['any write observed?', store.state === 'unreadable'
    ? `${pill('grey', 'unknown')} <span style="${S.reason}">the store could not be read</span>`
    : store.neverObserved
      ? `${pill('grey', 'NEVER OBSERVED')} <span style="${S.reason}">zero receipts — nobody has looked, which is not the same as all clear</span>`
      : pill('ok', `${store.receipts} receipts`)]);
  rows.push(['records held', store.records === null ? `${pill('grey', 'unknown')}` : `${store.records} (${store.bytes} bytes)`]);
  return `<div data-store="${esc(store.state)}" style="${S.card}"><h2 style="${S.h2}">The durable store</h2>`
    + `<table style="${S.table}"><tbody>${rows.map(([k, v]) => `<tr><td style="${S.key}">${esc(k)}</td><td style="${S.td}">${v}</td></tr>`).join('')}</tbody></table></div>`;
}

function trailBlock(t) {
  const r = t.receipt;
  return `<div data-trail="${esc(r.adapter || 'unnamed')}" style="margin:0 0 .5rem">`
    + `<h2 style="${S.h2}">${esc(r.adapter || '(unnamed adapter)')} · ${esc(r.at || 'no timestamp')} `
    + `${pill(stateTone(r.state), r.state || 'no state')} ${pill(formTone(r.storedForm), r.storedForm || 'no stored form')}</h2>`
    + t.steps.map(stepBlock).join('') + '</div>';
}

function recordBlock(rv) {
  if (!rv) return '';
  const head = `<div style="${S.card}"><h2 style="${S.h2}">Record <span style="${S.mono}">${esc(rv.externalId)}</span></h2>`
    + (rv.record
      ? `<div style="${S.note}">version ${esc(rv.record.version)} · ${esc(rv.record.bytes)} bytes held locally · updated ${esc(rv.record.updated_at)}</div>`
      : `<div>${pill('grey', 'no local row')} <span style="${S.reason}">${esc(rv.recordReason)}</span></div>`)
    + (rv.receiptsReason ? `<div>${pill('alarm', 'receipts unreadable')} <span style="${S.reason}">${esc(rv.receiptsReason)}</span></div>` : '')
    + '</div>';
  if (!rv.trails.length) {
    return head + `<div data-trails="none" style="${S.card}">${pill('grey', 'NO WRITE OBSERVED')} `
      + `<span style="${S.reason}">${esc(rv.trailsReason)}</span>`
      + '<div style="font-size:.8125rem;margin-top:.375rem">There is nothing to draw a step trail from. This panel will not render eight empty steps as eight passed ones.</div></div>';
  }
  return head + rv.trails.map(trailBlock).join('');
}

/** The 503 document: the house sheet, no font, following the panel's theme. The failure is drawn as
 *  an unknown (THEME.md Rule 7), dashed and without a state colour: it is not an empty store, and it
 *  is not a fault the store reported either. */
export function renderUnavailable(why) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>Memory visualiser — unavailable</title>${followerScript()}`
    + `<style>${houseCss({ fonts: 'none' })}\n`
    + '.unavail{max-width:48rem;margin:1.5rem auto;padding:1rem 1.25rem;background:var(--panel);border:1px dashed var(--line2);border-radius:.5rem}\n'
    + '.unavail h1{font-size:1.125rem;margin:0 0 .5rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}\n'
    + '.unavail p{margin:0}.unavail .note{margin-top:.5rem;font-size:.8125rem;color:var(--mut)}</style></head>'
    + '<body><div class="unavail"><h1>The memory view could not be assembled <span class="pill unk">unknown</span></h1>'
    + `<p>${esc(why)}</p>`
    + '<p class="note">This is an UNKNOWN, not an empty store. Nothing below this line should be read as evidence that no write happened.</p>'
    + '</div></body></html>';
}

/** The page. One document, no link, no script, no CDN. */
export function renderPage(model) {
  const o = model.observation;
  const t = c(o.tone);
  // Both sentences, loudest first. The two backends are measured from different evidence and the
  // banner's own tone is the louder of them, so the quiet one can never be the only one shown.
  //
  // A model built before the export axis existed carries neither half. The renderer SAYS that
  // rather than throwing: a page that dies on an older payload is the empty-page inversion this
  // file was written to refuse, and it would take the seven blocks below it down too.
  const unsupplied = (what) => ({ state: 'unknown', tone: 'grey',
    headline: `the ${what} half of this reading was not supplied`,
    detail: 'This model predates the two-axis observation, so nothing here is a claim about it.' });
  const local = o.local || unsupplied('local store');
  const x = o.exports || unsupplied('memory-layer export');
  const sentence = (s, kind) => {
    const st = c(s.tone);
    return `<div data-${kind}="${esc(s.state)}" data-tone="${esc(s.tone)}" style="padding:.25rem 0">`
      + `<div style="font-weight:700;font-size:.9375rem;color:${st.fg}">${s.state === 'observed' ? '' : `${esc(s.state.toUpperCase())} — `}${esc(s.headline)}</div>`
      + `<div style="margin-top:.25rem;font-size:.8125rem">${esc(s.detail)}</div></div>`;
  };
  const ordered = TONE_RANK[x.tone] > TONE_RANK[local.tone]
    ? [sentence(x, 'export-observation'), sentence(local, 'observation')]
    : [sentence(local, 'observation'), sentence(x, 'export-observation')];
  const banner = `<div data-banner-tone="${esc(o.tone)}" data-observation="${esc(o.state)}" style="${S.card};background:${t.bg};border-color:${t.bd};color:${t.fg}">`
    + ordered.join(`<hr style="border:0;border-top:1px solid ${t.bd};margin:.5rem 0">`) + '</div>';

  const identities = model.identities === null
    ? `<div style="${S.card}">${pill('grey', 'identities unknown')} <span style="${S.reason}">${esc(model.identitiesReason)}</span></div>`
    : model.identities.length === 0
      ? `<div data-identities="none" style="${S.card}">${pill('grey', 'NO IDENTITY HAS A RECEIPT')} <span style="${S.reason}">the receipt table is empty, so no write trail exists to render</span></div>`
      : `<div style="${S.card}"><h2 style="${S.h2}">Identities with receipts</h2><table style="${S.table}"><thead><tr><th style="${S.th}">external_id</th><th style="${S.th}">receipts</th><th style="${S.th}">last</th></tr></thead><tbody>`
        + model.identities.map((r) => `<tr><td style="${S.td};${S.mono}">${esc(r.external_id)}</td><td style="${S.td}">${esc(r.receipts)}</td><td style="${S.td}">${esc(r.last_at)}</td></tr>`).join('')
        + '</tbody></table></div>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Memory visualiser — how a record was actually stored</title>`
    + `<style>${houseTokens()}\n${houseSwitchCss()}\n.theme-switch{position:fixed;top:.75rem;right:.75rem}</style>`
    + `${themeSwitchInline()}</head>`
    + `<body style="${S.body}"><div data-theme-switch></div><div style="${S.wrap}">`
    + `<h1 style="${S.h1}">Memory visualiser</h1>`
    + `<p style="${S.sub}">Eight steps, one receipt each. Every value below was recorded by the write path; nothing here is measured for the first time. Generated ${esc(model.generatedAt)} from <span style="${S.mono}">${esc(model.dbPath)}</span>.</p>`
    + banner
    + storeBlock(model.store)
    + `<div style="${S.card}"><h2 style="${S.h2}">Adapters — what each backend does with a payload, as a property of the backend</h2>${adapterTable(model.adapters)}</div>`
    + surveyBlock(model.survey)
    + identities
    + recordBlock(model.record)
    + `<p style="${S.sub};margin-top:1.125rem">Grey is neither green nor red: a step that could not be observed is not a step that passed. state and storedForm are two axes and never one badge — a previewed write is accepted AND not a durable copy.</p>`
    + '</div></body></html>';
}
