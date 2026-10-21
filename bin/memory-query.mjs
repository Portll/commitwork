#!/usr/bin/env node
// bin/memory-query.mjs — THE READ SURFACE over the memory records commitwork writes.
//
// WHY THIS EXISTS, measured 2026-09-07.
//
// `recallByTags` in lib/memory-layer-client.mjs has EXACTLY ONE non-test caller —
// admin/lib/memory-layer-sync.mjs:111 — and it queries only `spine-session:<id>` tags.
// monitor/export-overwatch.mjs writes `commitwork`, `audit-rollup`, `sweep-summary`,
// `project:<repo>`, `worst:<sev>`, `remediation-ledger`, `tier:<n>`. Those two sets are DISJOINT.
// Every rollup and every remediation-ledger memory ever written is therefore unread by anything.
//
// That is not merely wasteful, it is the MECHANISM that hid a real failure: 0 of 25 rollups on disk
// carry a memory-layer-receipts.json, and nobody noticed for months, because A WRITE NOBODY READS
// CANNOT BE MISSED WHEN IT BREAKS. The lane exits 0 on every failure by design, so the receipt was
// the only evidence, and the receipt was the thing that was absent. A missing detector cannot
// report its own absence. This tool is the second witness that makes the other repairs verifiable
// rather than merely plumbed (CLAUDE.md: a guard needs a second witness that cannot share its
// failure mode).
//
// TWO BACKENDS, NEVER ONE NUMBER. The local durable store (lib/memory-store.mjs) is the system of
// record; veld is a summarising index on top of it. Under the write ordering those modules now
// implement — local first and complete, remote best-effort — A RECORD PRESENT LOCALLY AND ABSENT
// REMOTELY IS THE NORMAL AND CORRECT STATE. A merged count would hide exactly the fact worth
// seeing, so local / remote / both are reported separately and are never summed.
//
// THREE-VALUED REMOTE RESULTS, and this is the whole discipline of the file. recallByTags returns
// `memories: null` on failure and `[]` on a genuine empty answer; that distinction is deliberate
// upstream and MUST survive to the output. These are four different facts and none of them may
// render like another:
//   ok             — asked, answered, N matches (N may legitimately be 0)
//   unreachable    — did not ask successfully; observed NOTHING. Not zero. Grey.
//   no-credential  — a CONFIGURATION FAULT ON THIS BOX, not the remote being down. Grey.
//   not-queryable  — the remote surface has no endpoint for this question at all. Grey.
// Grey is neither green nor red (CLAUDE.md). An unreachable veld is not a clean fleet and it is
// also not a finding — today it is simply this box's normal operating condition: 127.0.0.1:3030
// answers 000 and there is no ~/.commitwork/secrets.json.
//
// CONTENT IS WITHHELD BY DEFAULT, including in --json. Content is the entire reason the redaction
// gate in lib/memory-layer-client.mjs exists; a query tool that dumps record bodies to a terminal,
// a pipe, or a CI log re-opens the exact channel that gate closes, downstream of it and out of its
// sight. Ids, tags, hashes, sizes and states answer every question this tool is for. `--content` is
// the explicit, deliberate act of asking for the bodies.
//
// ZERO DEPENDENCIES. Env is read at CALL time everywhere — a `const X = process.env.Y` at module
// load silently defeats any test that sets the override afterwards, so the test passes while
// proving nothing (CLAUDE.md).

import { statSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';

import {
  get as storeGet,
  byTags as storeByTags,
  receiptsFor as storeReceiptsFor,
  stats as storeStats,
  openForRead,
  dbPath,
} from '../lib/memory-store.mjs';

import {
  recallByTags,
  health,
  credential,
  config,
  safeUrl,
} from '../lib/memory-layer-client.mjs';

// ── Vocabulary ──────────────────────────────────────────────────────────────
// Named constants rather than bare strings so a typo is a crash instead of a fifth, silent state.

export const REMOTE_OK = 'ok';                       // asked and answered; `matches` is real
export const REMOTE_UNREACHABLE = 'unreachable';     // did not ask successfully; observed nothing
export const REMOTE_NO_CREDENTIAL = 'no-credential'; // config fault HERE, not the remote being down
export const REMOTE_NOT_QUERYABLE = 'not-queryable'; // no endpoint exists for this question

export const LOCAL_OK = 'ok';
export const LOCAL_ABSENT = 'absent';                // the database file does not exist yet
/**
 * The file is there and the memory schema is NOT — a third state, and it is the one this box is
 * actually in. Measured 2026-09-07: dbPath()'s default resolves to monitor/commitwork.db, which
 * exists (266KB, last written 2026-08-30) and holds eight `taxonomy_*` tables and no memory table
 * of any kind. So the local half of the local-first write ordering has never once run here, and
 * two unrelated schemas are pointed at one filename.
 *
 * Before this state existed, that produced an unhandled `no such table: memory_record` and exit 2 —
 * fail-closed, correctly, but illegible: a reader cannot act on a stack trace, and "the query
 * crashed" is not the same fact as "nothing has ever been written". Detected by asking sqlite_master
 * what tables exist, which is a structural check; never by matching the error text, because a
 * locked store and a missing table raise the same kind of string.
 */
export const LOCAL_UNINITIALISED = 'uninitialised';

/** One line of prose per state, so every renderer says the same thing about the same fact. */
export const REMOTE_LEGEND = Object.freeze({
  [REMOTE_OK]: 'reachable and answered',
  [REMOTE_UNREACHABLE]: 'UNREACHABLE — nothing was observed. This is not zero matches.',
  [REMOTE_NO_CREDENTIAL]: 'NO CREDENTIAL — a configuration fault on this box, not the remote being down.',
  [REMOTE_NOT_QUERYABLE]: 'NOT QUERYABLE — the remote exposes no endpoint that answers this question.',
});

// ── Env, read at call time ──────────────────────────────────────────────────

/**
 * Where the durable store lives, honouring an injected env.
 *
 * lib/memory-store.mjs's dbPath() reads process.env directly and takes no env argument, so an
 * injected env object cannot reach it. Resolved here instead and passed down as an explicit
 * `path`, which every store read accepts. (Gap noted in the report; not fixed in that module.)
 */
export function localDbPath({ env = process.env } = {}) {
  return env.CW_MEMORY_DB || env.CW_DB || dbPath();
}

/**
 * ABSENT is a third answer and only the filesystem may give it.
 *
 * lib/memory-store.mjs's byTags/get/receiptsFor return [] or null when the database file does not
 * exist — which is correct for those callers but collapses "no store has ever been written" into
 * "the store holds no match". Those are opposite facts and a reader must not have to guess. So the
 * question goes to stat(), which answers it unambiguously: ENOENT is absence and NOTHING ELSE IS.
 * EACCES, a corrupt header, a directory where a file should be — all propagate. Fail closed: a
 * permission error is never an empty store (CLAUDE.md), and it is never decided by matching an
 * error string, because a locked store and a missing one raise the same SQLite text.
 */
export function localState({ env = process.env, path = null } = {}) {
  const p = path || localDbPath({ env });
  let st;
  try {
    st = statSync(p);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { state: LOCAL_ABSENT, path: p, bytes: null, reason: 'no store file — nothing has ever been written here, which is not the same as an empty store' };
    throw e; // a fault, never emptiness
  }

  // The file exists. Does the memory schema? Asked of sqlite_master rather than inferred from a
  // failed query's message. openForRead is memory-store's own fail-closed open, reused rather than
  // rebuilt so a change to its rules reaches this check too.
  const conn = openForRead({ path: p });
  if (!conn) return { state: LOCAL_ABSENT, path: p, bytes: null, reason: 'store vanished between stat and open' };
  try {
    const t = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('memory_record','memory_receipt')").all();
    const have = new Set(t.map((r) => r.name));
    if (!have.has('memory_record')) {
      return {
        state: LOCAL_UNINITIALISED,
        path: p,
        bytes: st.size,
        reason: `the file exists but holds no memory_record table — the memory store has never been written at this path. Check that CW_MEMORY_DB/CW_DB point where the writer writes; monitor/commitwork.db is the taxonomy database and shares this default filename.`,
      };
    }
    return { state: LOCAL_OK, path: p, bytes: st.size, receiptsTable: have.has('memory_receipt'), reason: null };
  } finally {
    conn.close();
  }
}

/** Anything but LOCAL_OK means the store cannot answer — and each reason must reach the reader intact. */
const localAnswerable = (loc) => loc.state === LOCAL_OK;

// ── Remote helpers ──────────────────────────────────────────────────────────

/**
 * An external_id off a remote memory, or null.
 *
 * A remote record WITHOUT one cannot be correlated with anything local — identity is external_id
 * and never a row id (lib/memory-store.mjs). Counting such a record as "remote-only" would be a
 * fabricated discrepancy, so they are tallied under `unidentified` and left out of the comparison.
 */
export function remoteExternalId(m) {
  if (!m || typeof m !== 'object') return null;
  const v = m.external_id ?? m.experience?.external_id ?? m.metadata?.external_id ?? null;
  return typeof v === 'string' && v.length ? v : null;
}

/**
 * Ask veld for records carrying every one of `tags`, and return a state, never a bare list.
 *
 * `credentialImpl` is injected so tests never touch the real keychain — resolveInto() would shell
 * out to `security` and can block on an ACL prompt, which is not a thing a test may do. It is also
 * called with report:false so the CLI owns its own reporting: reportMissing() writes a multi-line
 * block to stderr, and a query tool must put that fact in its OUTPUT where a reader will see it,
 * not in a side channel that a pipe discards.
 */
export async function remoteByTags(tags, { limit = 50, env = process.env, fetchImpl = fetch, credentialImpl = credential } = {}) {
  const cred = credentialImpl({ env, report: false });
  if (!cred.ok) {
    return {
      state: REMOTE_NO_CREDENTIAL,
      matches: null,
      ids: null,
      unidentified: null,
      reason: 'VELD_API_KEY unresolvable — a configuration failure on this box, not the remote being down',
    };
  }
  let r;
  try {
    r = await recallByTags(tags, { limit, env, key: cred.key, fetchImpl });
  } catch (e) {
    // recallByTags catches its own transport errors, but a caller must never assume a callee's
    // catch is total — an injected fetch, or a future change, can throw past it.
    return { state: REMOTE_UNREACHABLE, matches: null, ids: null, unidentified: null, reason: e && e.message ? e.message : 'tag recall threw' };
  }
  // `memories: null` is the failure signal and `[]` is a genuine empty answer. Never fold them.
  if (!r || r.ok !== true || r.memories == null) {
    return { state: REMOTE_UNREACHABLE, matches: null, ids: null, unidentified: null, reason: (r && r.reason) || 'tag recall failed' };
  }
  const list = Array.isArray(r.memories) ? r.memories : [];
  const ids = [];
  let unidentified = 0;
  for (const m of list) {
    const id = remoteExternalId(m);
    if (id) ids.push(id);
    else unidentified += 1;
  }
  return {
    state: REMOTE_OK,
    matches: list.length,
    ids: [...new Set(ids)].sort(),   // deterministic ordering; the wire order is not stable
    unidentified,
    reason: null,
  };
}

/** Reachability + configuration, with the URL always passed through safeUrl so userinfo never prints. */
export async function remoteAdapter({ env = process.env, fetchImpl = fetch, credentialImpl = credential } = {}) {
  const cfg = config({ env });
  const cred = credentialImpl({ env, report: false });
  let h;
  try {
    h = await health({ env, fetchImpl });
  } catch (e) {
    h = { ok: false, reason: e && e.message ? e.message : 'health threw' };
  }

  // Two independent axes. A reachable veld with no credential is not "up" for any useful purpose,
  // and an unreachable veld with a valid credential is not a credential problem. Collapsing them
  // sends the operator to fix the wrong box.
  let state;
  if (!cred.ok) state = REMOTE_NO_CREDENTIAL;
  else if (!h.ok) state = REMOTE_UNREACHABLE;
  else state = REMOTE_OK;

  return {
    state,
    url: safeUrl(cfg.url),                    // never the raw URL — it can carry userinfo
    userId: cfg.userId,
    project: cfg.project,
    projectSource: cfg.projectSource,          // 'default' in a repo that never set CW_VELD_PROJECT
    credential: cred.ok ? { present: true, source: cred.source } : { present: false, source: null },
    reachable: h.ok === true,
    reason: !cred.ok
      ? 'VELD_API_KEY unresolvable — a configuration failure on this box, not the remote being down'
      : (h.ok ? null : `health check failed: ${h.reason}`),
  };
}

// ── Subcommands ─────────────────────────────────────────────────────────────

/**
 * --tags: the one question BOTH backends can answer, and therefore the only one that yields a
 * real correlation.
 *
 * The correlation is UNDETERMINED unless the remote actually answered. This is the single most
 * important line in the file: when veld is unreachable, every local record would look "local-only",
 * which reads as a discrepancy — a fleet of failed remote writes — when in fact nothing was
 * observed at all. Publishing that as a finding is the grey-rendered-as-RED failure this repo
 * measured across four lanes on 2026-08-22. So the comparison is simply not computed, and says so.
 */
export async function queryTags(tags, { limit = 50, env = process.env, fetchImpl = fetch, credentialImpl = credential } = {}) {
  const want = [...new Set((tags || []).map(String).filter(Boolean))];
  if (!want.length) throw new Error('--tags needs at least one tag — an empty filter would return the whole store as if it had matched');
  const wantSorted = [...want].sort();

  const loc = localState({ env });
  const answerable = localAnswerable(loc);
  const rows = answerable ? storeByTags(wantSorted, { limit, path: loc.path }) : [];
  // Deterministic: newest first, external_id breaking every tie. Same inputs => same bytes.
  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : (a.external_id < b.external_id ? -1 : a.external_id > b.external_id ? 1 : 0)));

  const remote = await remoteByTags(wantSorted, { limit, env, fetchImpl, credentialImpl });

  const localIds = rows.map((r) => r.external_id);
  // A store that cannot be read has not matched zero records — it has observed nothing, exactly as
  // an unreachable remote has. The same rule has to bind both halves or the tool enforces its own
  // invariant in one direction only, which is how "grey is not red" was policed for months while
  // "grey is not green" went unwatched (CLAUDE.md).
  const localCount = answerable ? new Set(localIds).size : null;
  let correlation;
  if (remote.state === REMOTE_OK && answerable) {
    const rset = new Set(remote.ids);
    const lset = new Set(localIds);
    correlation = {
      determined: true,
      local: localCount,
      remote: rset.size,
      both: [...lset].filter((id) => rset.has(id)).sort(),
      localOnly: [...lset].filter((id) => !rset.has(id)).sort(),
      remoteOnly: [...rset].filter((id) => !lset.has(id)).sort(),
      // Not correlatable in either direction, and deliberately not counted as remote-only.
      remoteUnidentified: remote.unidentified,
      note: 'local-only is the NORMAL state under local-first write ordering; it is not a discrepancy.',
    };
  } else {
    const why = [];
    if (!answerable) why.push(`the local store is ${loc.state}`);
    if (remote.state !== REMOTE_OK) why.push(`the remote did not answer (${remote.state})`);
    correlation = {
      determined: false,
      local: localCount,
      remote: null,
      both: null,
      localOnly: null,
      remoteOnly: null,
      remoteUnidentified: null,
      reason: `${why.join(' and ')} — nothing was observed there, so no comparison exists to make`,
    };
  }

  return { subcommand: 'tags', tags: wantSorted, limit, local: { ...loc, matches: answerable ? rows.length : null, records: rows }, remote, correlation };
}

/**
 * --id: identity lookup.
 *
 * The remote has NO endpoint that takes an external_id. GET /api/memory/{id} takes veld's OWN id,
 * and POST /api/recall/tags is enumeration by tag — and a tag is not an identity, because veld
 * mints tags from content (lib/memory-layer-contract.json#tagsAreNotIdentity). So the honest remote
 * answer is not-queryable.
 *
 * What CAN be said is what the local receipt ledger RECORDS about past remote writes for this
 * identity. That is evidence, and it is second-hand: it says what a writer was told at some past
 * moment, never what veld holds now. It is kept in its own `remoteLedger` field, never merged into
 * `remote`, precisely so a ledger claim can never be read as a live observation.
 */
export function queryId(externalId, { env = process.env } = {}) {
  const id = String(externalId || '');
  if (!id) throw new Error('--id needs an external_id');

  const loc = localState({ env });
  const record = localAnswerable(loc) ? storeGet(id, { path: loc.path }) : null;
  const receipts = localAnswerable(loc) ? storeReceiptsFor(id, { path: loc.path }) : [];

  const remoteReceipts = receipts.filter((r) => r.adapter && r.adapter !== 'local');
  const latest = remoteReceipts[0] || null;   // receiptsFor is already newest-first, at DESC, id DESC

  return {
    subcommand: 'id',
    external_id: id,
    local: { ...loc, found: Boolean(record), record },
    remote: {
      state: REMOTE_NOT_QUERYABLE,
      matches: null,
      reason: 'veld exposes no lookup by external_id: GET /api/memory/{id} takes veld\'s own id, and tag recall is enumeration — a tag is not an identity',
    },
    remoteLedger: latest
      ? {
        source: 'local receipt ledger — what a past write was TOLD, never what the remote holds now',
        adapter: latest.adapter,
        at: latest.at,
        state: latest.state,
        storedForm: latest.stored_form,
        storedCoverage: latest.stored_coverage,
        remoteId: latest.remote_id,
        reason: latest.reason,
        attempts: remoteReceipts.length,
      }
      : {
        source: 'local receipt ledger',
        // Grey, loudly. Zero receipts is "nobody has looked", never "all clear" — this is the exact
        // shape of the failure that went unnoticed for months.
        state: 'never-observed',
        attempts: 0,
        reason: 'no remote receipt has ever been recorded for this identity — that is unknown, not clean',
      },
  };
}

/**
 * --receipts: the write history for one identity.
 *
 * Local by construction. The receipt ledger is a LOCAL artefact about every adapter, including
 * remote ones; the contract exposes no receipt surface on veld at all, so there is nothing there
 * to ask.
 */
export function queryReceipts(externalId, { limit = 100, env = process.env } = {}) {
  const id = String(externalId || '');
  if (!id) throw new Error('--receipts needs an external_id');

  const loc = localState({ env });
  const rows = localAnswerable(loc) ? storeReceiptsFor(id, { limit, path: loc.path }) : [];

  const byAdapter = {};
  for (const r of rows) {
    const a = (byAdapter[r.adapter] ||= { total: 0, verified: 0, acceptedUnverified: 0, failed: 0, dryRun: 0, unknownState: 0 });
    a.total += 1;
    if (r.state === 'verified') a.verified += 1;
    else if (r.state === 'accepted-unverified') a.acceptedUnverified += 1;
    else if (r.state === 'failed') a.failed += 1;
    else if (r.state === 'dry-run') a.dryRun += 1;
    // An undeclared state is a fact about the WRITER, not the store. An unguarded `else failed++`
    // is how dry-run was reported as data loss for as long as both existed.
    else a.unknownState += 1;
  }

  return {
    subcommand: 'receipts',
    external_id: id,
    local: { ...loc, count: localAnswerable(loc) ? rows.length : null, receipts: rows, byAdapter },
    // Zero receipts is grey, not green. A record can be perfectly present and never once observed.
    // But an unreadable store has not observed zero receipts either — it has observed nothing, so
    // the claim is withheld rather than defaulted to true.
    neverObserved: localAnswerable(loc) ? rows.length === 0 : null,
    remote: {
      state: REMOTE_NOT_QUERYABLE,
      reason: 'receipts are a local ledger; the memory-layer contract exposes no receipt surface',
    },
  };
}

/** --stats: fleet counts. Local is real; the remote has no aggregate endpoint, so it reports reachability only. */
export async function queryStats({ env = process.env, fetchImpl = fetch, credentialImpl = credential } = {}) {
  const loc = localState({ env });
  const s = localAnswerable(loc)
    ? storeStats({ path: loc.path })
    // storeStats would raise on a file with no memory schema. Absence of the schema is its own
    // state, and every count is withheld rather than reported as zero.
    : { records: null, bytes: null, receipts: null, adapters: {}, neverObserved: true, storeAbsent: loc.state === LOCAL_ABSENT };
  const adapter = await remoteAdapter({ env, fetchImpl, credentialImpl });

  return {
    subcommand: 'stats',
    local: { ...loc, ...s },
    remote: {
      state: adapter.state === REMOTE_OK ? REMOTE_NOT_QUERYABLE : adapter.state,
      matches: null,
      reason: adapter.state === REMOTE_OK
        ? 'veld exposes no aggregate/count endpoint — the numbers below are LOCAL receipts about the veld adapter, not veld\'s own totals'
        : adapter.reason,
      adapter,
    },
  };
}

/** --adapters: is each backend usable at all, and configured how. */
export async function queryAdapters({ env = process.env, fetchImpl = fetch, credentialImpl = credential } = {}) {
  const loc = localState({ env });
  const s = localAnswerable(loc) ? storeStats({ path: loc.path }) : null;
  const remote = await remoteAdapter({ env, fetchImpl, credentialImpl });
  return {
    subcommand: 'adapters',
    local: {
      ...loc,
      records: s ? s.records : null,
      receipts: s ? s.receipts : null,
      neverObserved: s ? s.neverObserved : null,
    },
    remote,
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

const short = (h) => (typeof h === 'string' && h.length >= 12 ? h.slice(0, 12) : (h ?? '—'));

/**
 * Strip record/receipt CONTENT unless it was explicitly asked for.
 *
 * Applied to the JSON path too, and that is the point: --json is piped into logs and CI artefacts
 * far more often than the human view is read, so withholding only from the pretty renderer would
 * leave the wider channel open. The redaction gate runs on WRITE; it cannot see a read.
 */
export function withhold(node, showContent) {
  if (showContent) return node;
  if (Array.isArray(node)) return node.map((n) => withhold(n, false));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'content') { out.content_withheld = true; continue; }
      out[k] = withhold(v, false);
    }
    return out;
  }
  return node;
}

/**
 * One rendering for "the local store cannot answer", shared by every subcommand so the three
 * unavailable states cannot drift apart into three differently-worded near-synonyms.
 */
function renderLocalUnavailable(loc) {
  const L = [];
  if (loc.state === LOCAL_ABSENT) {
    L.push(`  store ABSENT at ${loc.path}`);
    L.push('  Nothing has ever been written here. That is not an empty result and not a clean one;');
    L.push('  it is unknown.');
  } else {
    L.push(`  store UNINITIALISED at ${loc.path}`);
    L.push('  The file exists and holds no memory schema, so no count from it would mean anything.');
    L.push('  Reported as unknown rather than as zero records.');
  }
  if (loc.reason) L.push(`  reason: ${loc.reason}`);
  return L;
}

function renderRemote(remote, indent = '  ') {
  const lines = [];
  const legend = REMOTE_LEGEND[remote.state] || 'state not declared by this tool';
  lines.push(`${indent}veld: ${remote.state} — ${legend}`);
  if (remote.state === REMOTE_OK && remote.matches != null) {
    lines.push(`${indent}  ${remote.matches} match${remote.matches === 1 ? '' : 'es'} returned${remote.unidentified ? `, ${remote.unidentified} carrying no external_id (not correlatable)` : ''}`);
    if (remote.matches === 0) lines.push(`${indent}  (asked and answered zero — this IS an observation, unlike the states above)`);
  }
  if (remote.reason) lines.push(`${indent}  reason: ${remote.reason}`);
  return lines;
}

export function render(result, { content = false } = {}) {
  const L = [];
  const loc = result.local;

  if (result.subcommand === 'tags') {
    L.push(`memory-query --tags ${result.tags.join(',')}  (strict AND, limit ${result.limit})`);
    L.push('');
    L.push('LOCAL (lib/memory-store.mjs — the system of record)');
    if (loc.state !== LOCAL_OK) {
      L.push(...renderLocalUnavailable(loc));
    } else {
      L.push(`  ${loc.matches} record${loc.matches === 1 ? '' : 's'} in ${loc.path}`);
      for (const r of loc.records) {
        L.push(`    ${r.external_id}`);
        L.push(`      v${r.version}  ${r.bytes}B  sha ${short(r.content_sha256)}  updated ${r.updated_at}`);
        L.push(`      scope ${r.scope}  project ${r.project ?? '—'}`);
        L.push(`      tags ${[...r.tags].sort().join(', ')}`);
        if (content) L.push(`      content: ${JSON.stringify(r.content)}`);
      }
      // Say that content was withheld, rather than merely omitting it. Silence is ambiguous: a
      // reader cannot tell a withheld body from a record that never had one, and the second reading
      // is the one that makes an empty store look accounted for.
      if (loc.matches && !content) L.push('    content withheld — pass --content to print record bodies');
    }
    L.push('');
    L.push('REMOTE (veld — a summarising index, never the record)');
    L.push(...renderRemote(result.remote));
    L.push('');
    L.push('CORRELATION');
    const c = result.correlation;
    if (!c.determined) {
      L.push(`  UNDETERMINED — ${c.reason}`);
      if (c.local == null) {
        L.push('  The local half is unknown too, so there is no count to report on either side.');
      } else {
        L.push(`  ${c.local} local record${c.local === 1 ? '' : 's'} matched. They are NOT reported as`);
        L.push('  local-only: that would publish an unanswered question as a discrepancy.');
      }
    } else {
      L.push(`  local ${c.local}   remote ${c.remote}   both ${c.both.length}`);
      L.push(`  local-only ${c.localOnly.length}   remote-only ${c.remoteOnly.length}`);
      if (c.remoteUnidentified) L.push(`  remote records with no external_id ${c.remoteUnidentified} (uncorrelatable, counted nowhere above)`);
      L.push(`  ${c.note}`);
      for (const id of c.localOnly) L.push(`    local-only  ${id}`);
      for (const id of c.remoteOnly) L.push(`    remote-only ${id}`);
    }
  } else if (result.subcommand === 'id') {
    L.push(`memory-query --id ${result.external_id}`);
    L.push('');
    L.push('LOCAL');
    if (loc.state !== LOCAL_OK) {
      L.push(...renderLocalUnavailable(loc));
    } else if (!loc.found) {
      L.push(`  no record with that external_id in ${loc.path}`);
    } else {
      const r = loc.record;
      L.push(`  ${r.external_id}`);
      L.push(`    v${r.version}  ${r.bytes}B  sha ${short(r.content_sha256)}`);
      L.push(`    created ${r.created_at}  updated ${r.updated_at}`);
      L.push(`    scope ${r.scope}  project ${r.project ?? '—'}  type ${r.memory_type}`);
      L.push(`    tags ${[...r.tags].sort().join(', ')}`);
      if (content) L.push(`    content: ${JSON.stringify(r.content)}`);
      else L.push('    content withheld — pass --content to print record bodies');
    }
    L.push('');
    L.push('REMOTE');
    L.push(...renderRemote(result.remote));
    L.push('');
    L.push('REMOTE LEDGER (local evidence ABOUT the remote — second-hand, never a live read)');
    const g = result.remoteLedger;
    if (g.attempts === 0) {
      L.push(`  never-observed — ${g.reason}`);
    } else {
      L.push(`  ${g.adapter}: ${g.state}  storedForm ${g.storedForm}  at ${g.at}`);
      L.push(`  remote id ${g.remoteId ?? '—'}  coverage ${g.storedCoverage ?? '—'}  attempts ${g.attempts}`);
      if (g.reason) L.push(`  reason: ${g.reason}`);
      L.push(`  ${g.source}`);
    }
  } else if (result.subcommand === 'receipts') {
    L.push(`memory-query --receipts ${result.external_id}`);
    L.push('');
    if (loc.state !== LOCAL_OK) {
      L.push(...renderLocalUnavailable(loc));
    } else if (result.neverObserved) {
      L.push('  NEVER OBSERVED — no receipt of any adapter has ever been recorded for this identity.');
      L.push('  Zero receipts is not a clean write history; it is the absence of one. A write nobody');
      L.push('  reads cannot be missed when it breaks.');
    } else {
      L.push(`  ${result.local.count} receipt${result.local.count === 1 ? '' : 's'} in ${loc.path}`);
      for (const [a, t] of Object.entries(loc.byAdapter).sort()) {
        L.push(`    ${a}: ${t.total} total — ${t.verified} verified, ${t.acceptedUnverified} accepted-unverified, ${t.failed} failed, ${t.dryRun} not attempted (dry run)${t.unknownState ? `, ${t.unknownState} carrying a state this tool does not declare` : ''}`);
      }
      L.push('');
      for (const r of loc.receipts) {
        L.push(`    ${r.at}  ${r.adapter.padEnd(6)} ${r.state.padEnd(20)} storedForm ${r.stored_form}`);
        if (r.reason) L.push(`      reason: ${r.reason}`);
      }
    }
    L.push('');
    L.push(...renderRemote(result.remote));
  } else if (result.subcommand === 'stats') {
    L.push('memory-query --stats');
    L.push('');
    L.push('LOCAL');
    if (loc.state !== LOCAL_OK) {
      L.push(...renderLocalUnavailable(loc));
      L.push('  This is the strongest possible never-observed: no receipt can be missing from a');
      L.push('  ledger that does not exist yet.');
    } else {
      L.push(`  ${loc.records} record${loc.records === 1 ? '' : 's'}, ${loc.bytes} bytes of content, ${loc.receipts} receipt${loc.receipts === 1 ? '' : 's'}`);
      if (loc.neverObserved) L.push('  NEVER OBSERVED — zero receipts. Not a clean store; an unwatched one.');
      for (const [a, t] of Object.entries(loc.adapters).sort()) {
        L.push(`    ${a}: ${t.total} — ${t.verified} verified, ${t.acceptedUnverified} accepted-unverified, ${t.failed} failed, ${t.dryRun} not attempted`);
        L.push(`      stored: ${t.storedFull} full, ${t.storedPreview} preview, ${t.storedDivergent} DIVERGENT, ${t.storedUnknown} unknown`);
      }
    }
    L.push('');
    L.push('REMOTE');
    L.push(...renderRemote(result.remote));
    L.push(`  url ${result.remote.adapter.url}  project ${result.remote.adapter.project} (${result.remote.adapter.projectSource})`);
  } else if (result.subcommand === 'adapters') {
    L.push('memory-query --adapters');
    L.push('');
    L.push('local  (lib/memory-store.mjs)');
    L.push(`  state ${loc.state}  path ${loc.path}`);
    if (loc.state !== LOCAL_OK) L.push(`  reason: ${loc.reason}`);
    else L.push(`  ${loc.records} records, ${loc.receipts} receipts${loc.neverObserved ? '  NEVER OBSERVED (zero receipts)' : ''}`);
    L.push('');
    L.push('veld   (lib/memory-layer-client.mjs)');
    const r = result.remote;
    L.push(`  state ${r.state} — ${REMOTE_LEGEND[r.state] || 'undeclared'}`);
    L.push(`  url ${r.url}`);   // safeUrl'd upstream — userinfo never reaches here
    L.push(`  user_id ${r.userId}  project ${r.project} (${r.projectSource})`);
    L.push(`  credential ${r.credential.present ? `present (${r.credential.source})` : 'ABSENT'}`);
    L.push(`  reachable ${r.reachable}`);
    if (r.reason) L.push(`  reason: ${r.reason}`);
  }

  L.push('');
  return `${L.join('\n')}\n`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export const USAGE = `memory-query — read the memory records commitwork writes, from BOTH backends

  node bin/memory-query.mjs --tags <a,b>        records carrying EVERY tag (strict AND)
  node bin/memory-query.mjs --id <external_id>  one record by identity
  node bin/memory-query.mjs --receipts <id>     the write history for one identity
  node bin/memory-query.mjs --stats             fleet counts, per adapter
  node bin/memory-query.mjs --adapters          is each backend usable, and configured how

  --json          machine output
  --content       print record bodies (WITHHELD by default: content is why the redaction gate
                  exists, and a read is downstream of it)
  --limit <n>     cap results (default 50)

The two backends are reported SEPARATELY and never summed. A record present locally and absent
remotely is the normal, correct state. An unreachable veld is grey: not zero matches, and not a
finding.
`;

export function parseArgs(argv) {
  const a = { json: false, content: false, limit: 50, subcommand: null, value: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--content') a.content = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else if (t === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit needs a positive integer, got ${JSON.stringify(argv[i])}`);
      a.limit = n;
    } else if (t === '--stats' || t === '--adapters') {
      if (a.subcommand) throw new Error(`one subcommand at a time — already have --${a.subcommand}`);
      a.subcommand = t.slice(2);
    } else if (t === '--tags' || t === '--id' || t === '--receipts') {
      if (a.subcommand) throw new Error(`one subcommand at a time — already have --${a.subcommand}`);
      a.subcommand = t.slice(2);
      a.value = argv[++i];
      if (a.value === undefined || a.value.startsWith('--')) throw new Error(`${t} needs a value`);
    } else throw new Error(`unknown argument ${JSON.stringify(t)}`);
  }
  return a;
}

export async function run(argv, { env = process.env, fetchImpl = fetch, credentialImpl = credential } = {}) {
  const a = parseArgs(argv);
  if (a.help || !a.subcommand) return { text: USAGE, exitCode: a.help ? 0 : 2, result: null };

  let result;
  if (a.subcommand === 'tags') result = await queryTags(String(a.value).split(',').map((s) => s.trim()), { limit: a.limit, env, fetchImpl, credentialImpl });
  else if (a.subcommand === 'id') result = queryId(a.value, { env });
  else if (a.subcommand === 'receipts') result = queryReceipts(a.value, { limit: a.limit, env });
  else if (a.subcommand === 'stats') result = await queryStats({ env, fetchImpl, credentialImpl });
  else result = await queryAdapters({ env, fetchImpl, credentialImpl });

  const safe = withhold(result, a.content);
  const text = a.json ? `${JSON.stringify(safe, null, 2)}\n` : render(safe, { content: a.content });
  // Exit 0 even when the remote is grey. Grey is not red: an unreachable veld is this box's normal
  // condition today, and gating on it would turn "nobody asked" into a failing check.
  return { text, exitCode: 0, result: safe };
}

export async function main(argv, { out = process.stdout, err = process.stderr, env = process.env, fetchImpl = fetch, credentialImpl = credential } = {}) {
  let r;
  try {
    r = await run(argv, { env, fetchImpl, credentialImpl });
  } catch (e) {
    err.write(`memory-query: ${e && e.message ? e.message : e}\n`);
    // Fail closed: a fault is reported as a fault. It is never rendered as an empty result set,
    // which is the shape that lets a broken query read as a clean store.
    process.exitCode = 2;
    return;
  }
  out.write(r.text);
  // process.exitCode, NEVER process.exit(): a write to a pipe is asynchronous, and process.exit()
  // truncates at the 64KB pipe buffer while still reporting success. That exact bug shipped here.
  process.exitCode = r.exitCode;
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
