// SPDX-License-Identifier: Apache-2.0
// lib/memory-layer-client.mjs — THE memory-layer write client; every write to memory-layer goes through here.
// Contract: lib/memory-layer-contract.json. Memory-layer mints tags from content (redact BEFORE the request;
// verify content and assert tags as a SUBSET). Env is read at CALL time, never at module load.

import { createHash } from 'node:crypto';
import { resolveInto, reportMissing } from './secrets.mjs';
import { decompress } from './lz4-block.mjs';

export const CONTRACT_VERSION = 1;

/** Receipt states. Three, not two: "accepted" and "verified" are different facts. */
export const VERIFIED = 'verified';
export const ACCEPTED_UNVERIFIED = 'accepted-unverified';
export const FAILED = 'failed';
/**
 * A FOURTH state, and the reason it has to exist. monitor/export-overwatch.mjs:71 has always
 * pushed `state: 'dry-run'` on --dry, and this file declared only three states with an unguarded
 * `else t.failed++` in tally(). So every dry run reported its own no-op as a fleet of failed
 * writes: `node monitor/sweep.mjs all --dry` printed "0 verified, N failed". That is grey rendered
 * as RED, in the lane whose job is publishing — over-reporting is not the safe direction, because
 * a fabricated failure costs more than a missed one when it is the number a reader can check.
 * Nothing was written and nothing failed; the write was NOT ATTEMPTED, which is its own fact.
 */
export const NOT_ATTEMPTED = 'dry-run';

/**
 * How much of a record the server actually holds. Measured 2026-09-02: memory-layer stores a
 * ~410-byte PREVIEW in `content` and discards the rest — `metadata.compressed_data` decompresses
 * to that same preview plus ~600 NER rows, and `ner_entities` keeps char offsets (end_char 17392)
 * into a document that is no longer anywhere. Metadata outliving its referent is the whole trap:
 * every signal says "full document" except the document.
 *
 * So the stored form is its own axis, never folded into the receipt state — a preview is neither
 * a pass nor a corruption.
 */
export const STORED_FULL = 'full';           // stored content matches what was sent
export const STORED_PREVIEW = 'preview';     // server kept a subset and dropped the rest
export const STORED_DIVERGENT = 'divergent'; // stored text is NOT derived from the source — corruption
export const STORED_UNKNOWN = 'unknown';     // could not be determined — never read as either
export const PREVIEW_TOLERANCE = 0.95;       // stored/sent below this is a preview, not rounding
export const CONTAINMENT_FLOOR = 0.5;        // below this, stored is not a subset of source
export const PROSE_FLOOR = 0.9;              // below this a decoded blob is a structure, not a document

// ── Redaction ───────────────────────────────────────────────────────────────
// Rows are CONSTRUCTED from declared fields, never spread; the deny-list covers known
// credential-bearing fields (trufflehog Raw/RawV2, gitleaks Secret/Match).
export const CREDENTIAL_FIELDS = Object.freeze([
  'Raw', 'RawV2', 'raw', 'rawV2',            // trufflehog
  'Secret', 'Match', 'secret', 'match',      // gitleaks
  'password', 'passwd', 'token', 'apiKey', 'api_key', 'authorization', 'privateKey', 'private_key',
]);

/** Build a row from a declared field list: undeclared fields drop, credential fields throw. */
export function buildRow(source, fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('buildRow: a declared field list is required (an empty list would silently emit nothing)');
  }
  const denied = fields.filter((f) => CREDENTIAL_FIELDS.includes(f));
  if (denied.length) {
    throw new Error(`buildRow: refusing to serialise credential-bearing field(s): ${denied.join(', ')}`);
  }
  const row = {};
  for (const f of fields) if (source && source[f] !== undefined && source[f] !== null) row[f] = source[f];
  return row;
}

/** The gate. Returns { ok, reasons } — refuses, never sanitises. Default is closed. */
export function redactionCheck(record, { extraDenied = [] } = {}) {
  const reasons = [];
  const deny = [...CREDENTIAL_FIELDS, ...extraDenied];
  for (const k of Object.keys(record || {})) {
    if (deny.includes(k)) reasons.push(`record carries a credential-bearing key: ${k}`);
  }
  const content = record && record.content;
  if (typeof content !== 'string' || content.length === 0) {
    reasons.push('content is absent or not a string — an empty write is not a legitimate write');
  } else {
    // Deny entries are caller-supplied: escape so each matches only its literal self.
    const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const f of deny) {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- field name pinned to a literal via escRe above
      const re = new RegExp(`["']?\\b${escRe(f)}\\b["']?\\s*[:=]`, 'i');
      if (re.test(content)) reasons.push(`content embeds a credential-bearing field: ${f}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// ── Config, read at CALL time ───────────────────────────────────────────────

// An env-sourced URL can carry credentials in its userinfo; redact at display so every logger
// is covered. An unparseable URL is reported, never echoed.
export function safeUrl(u) {
  let p;
  try { p = new URL(String(u ?? '')); } catch { return '(unparseable url — not echoed)'; }
  if (!p.username && !p.password) return String(u);
  p.username = ''; p.password = '';
  return `${p.toString().replace(/\/$/, '')} (userinfo redacted)`;
}

export function config({ env = process.env } = {}) {
  return {
    url: String(env.VELD_API_URL || 'http://127.0.0.1:3030').replace(/\/$/, ''),
    // ONE tenant, the person — see lib/memory-layer-contract.json `tenant`.
    userId: env.VELD_USER_ID || 'portll',
    // Lowercase always — /api/recall/tags matches exactly, and a case split hides a project
    // from its own scoped search.
    project: String(env.CW_VELD_PROJECT || 'commitwork').toLowerCase(),
    // 'default' in a repo that never set CW_VELD_PROJECT is the silently-wrong combination.
    projectSource: env.CW_VELD_PROJECT ? 'env' : 'default',
    timeoutMs: Number(env.VELD_TIMEOUT_MS || 5000),
    verify: env.CW_VELD_VERIFY !== '0',
    maxRetries: Number(env.VELD_MAX_RETRIES || 2),
  };
}

/**
 * Scope tags, applied here rather than asked of the caller.
 *   memory-layer-project:<name>  WHICH project (not the `project:` namespace — that means the scanned repo)
 *   scope:<writer>       WHO wrote it
 */
export function scopeTags(callerTags = [], { scope, project = null, env = process.env } = {}) {
  if (!scope) throw new Error('scopeTags: a writer scope is required (e.g. "commitwork-sweep")');
  // Explicit-first; the default is right inside this repo and silently wrong from a second repo,
  // so its source stays reportable via config().projectSource.
  const resolved = String(project || config({ env }).project).toLowerCase();
  return [...new Set([...(callerTags || []), `${PROJECT_TAG_NAMESPACES[0]}:${resolved}`, `scope:${scope}`])].sort();
}

/**
 * Every namespace the project tag has been written under, current first. The key was renamed
 * twice by redaction rulings and the store was never migrated, so the same project sits under
 * three prefixes. Measured 2026-09-09 on the live store for `commitwork`: veld-project ≥1000
 * (the query cap), internal-c-project 325, memory-layer-project 439 — a read under the current
 * prefix alone missed most of the project's history and looked complete doing it.
 *
 * Writes use [0]. Reads expand to all of them (the server unions tag matches), so a scoped read
 * sees the whole history without a data migration. Retire a historical prefix only after a
 * migration has measured zero records under it.
 */
export const PROJECT_TAG_NAMESPACES = Object.freeze(['memory-layer-project', 'internal-c-project', 'veld-project']);

/** Expand any project tag to every namespace it may be stored under; other tags pass through. */
export function expandProjectTags(tags) {
  const out = [];
  for (const t of tags || []) {
    const s = String(t);
    const i = s.indexOf(':');
    const ns = i > 0 ? s.slice(0, i) : null;
    if (ns && PROJECT_TAG_NAMESPACES.includes(ns)) {
      const value = s.slice(i + 1);
      for (const alias of PROJECT_TAG_NAMESPACES) out.push(`${alias}:${value}`);
    } else {
      out.push(s);
    }
  }
  return [...new Set(out)];
}

export const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

// ── Credentials ─────────────────────────────────────────────────────────────

/** env -> keychain. A missing key is a fault on THIS box, not the overwatch-layer being down. */
export function credential({ env = process.env, report = true } = {}) {
  if (env.VELD_API_KEY) return { ok: true, key: env.VELD_API_KEY, source: 'env' };
  const r = resolveInto(['VELD_API_KEY'], { env: {} });
  if (r.ok) return { ok: true, key: r.env.VELD_API_KEY, source: 'keychain' };
  if (report) reportMissing(r.missing, { context: 'the memory-layer client' });
  return { ok: false, key: null, source: null, missing: r.missing };
}

// ── Transport ───────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'POST', body, key, cfg, fetchImpl = fetch }) {
  const headers = { 'X-API-Key': key };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const res = await fetchImpl(`${cfg.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (res.status === 429 && attempt < cfg.maxRetries) { await sleep(2500 * (attempt + 1)); continue; }
    // Return the status, never swallow it.
    let json = null;
    try { json = await res.json(); } catch { /* body shape is not load-bearing */ }
    return { ok: res.ok, status: res.status, json };
  }
  return { ok: false, status: 429, json: null };
}

export async function health({ env = process.env, fetchImpl = fetch } = {}) {
  const cfg = config({ env });
  try {
    const res = await fetchImpl(`${cfg.url}/health`, { signal: AbortSignal.timeout(2000) });
    return { ok: res.ok, reason: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// ── The write ───────────────────────────────────────────────────────────────

/**
 * Upsert one memory and return a receipt. `truncated` is the caller's declaration that it
 * shortened the content — `verified` proves what was SENT round-tripped, not that it was complete.
 */
export async function upsert(record, {
  scope,
  project = null,
  env = process.env,
  key = null,
  fetchImpl = fetch,
  verify = null,
  truncated = false,
  extraDenied = [],
} = {}) {
  const cfg = config({ env });
  const doVerify = verify === null ? cfg.verify : verify;
  const external_id = record && record.external_id;

  const base = {
    external_id: external_id || null,
    id: null,
    was_update: null,
    version: null,
    contentSha256: null,
    storedSha256: null,
    tagsSent: [],
    tagsStoredCount: null,
    truncated: Boolean(truncated),
    storedForm: STORED_UNKNOWN,
    storedCoverage: null,
    state: FAILED,
    reason: null,
  };

  if (!external_id) return { ...base, reason: 'no external_id — identity is external_id, and a record without one can never be updated or superseded' };

  const gate = redactionCheck(record, { extraDenied });
  if (!gate.ok) return { ...base, reason: `redaction gate refused: ${gate.reasons.join('; ')}` };

  const cred = key ? { ok: true, key } : credential({ env });
  if (!cred.ok) return { ...base, reason: 'VELD_API_KEY unresolvable — a configuration failure on this box, not the overwatch-layer being down' };

  const tags = scopeTags(record.tags, { scope, project, env });
  const body = {
    user_id: cfg.userId,
    content: record.content,
    memory_type: record.memory_type || 'Context',
    tags,
    external_id,
  };
  const receipt = { ...base, tagsSent: tags, contentSha256: sha256(record.content) };

  let res;
  try {
    res = await call('/api/upsert', { body, key: cred.key, cfg, fetchImpl });
  } catch (e) {
    // A timeout is accepted-unverified, never failed — memory-layer may well have stored it.
    const timeout = /abort|timeout|timed out/i.test(e.message || '');
    return { ...receipt, state: timeout ? ACCEPTED_UNVERIFIED : FAILED, reason: `${timeout ? 'request timed out — memory-layer may have stored it' : 'request failed'}: ${e.message}` };
  }
  if (!res.ok) return { ...receipt, reason: `HTTP ${res.status}` };

  receipt.id = res.json?.id ?? null;
  receipt.was_update = res.json?.was_update ?? null;
  receipt.version = res.json?.version ?? null;

  if (!doVerify) return { ...receipt, state: ACCEPTED_UNVERIFIED, reason: 'verification disabled (CW_VELD_VERIFY=0)' };
  if (!receipt.id) return { ...receipt, state: ACCEPTED_UNVERIFIED, reason: 'upsert response carried no id, so there is nothing to read back' };

  // Verify immediately — a deferred pass races other writers.
  return verifyReceipt(receipt, { env, key: cred.key, fetchImpl, cfg, sentText: record.content });
}

/**
 * Read the record back by id and compare. Content hashes compared; tags asserted as a SUBSET
 * (memory-layer adds its own). An incomplete comparison yields accepted-unverified with a reason, never failed.
 */
export async function verifyReceipt(receipt, { env = process.env, key = null, fetchImpl = fetch, cfg = null, sentText = null } = {}) {
  const c = cfg || config({ env });
  const cred = key ? { ok: true, key } : credential({ env, report: false });
  if (!cred.ok) return { ...receipt, state: ACCEPTED_UNVERIFIED, reason: 'no credential available for readback' };

  let res;
  try {
    // user_id is a QUERY PARAM — memory-layer answers 400 to a header or to no user_id at all.
    res = await call(`/api/memory/${encodeURIComponent(receipt.id)}?user_id=${encodeURIComponent(c.userId)}`,
      { method: 'GET', key: cred.key, cfg: c, fetchImpl });
  } catch (e) {
    return { ...receipt, state: ACCEPTED_UNVERIFIED, reason: `readback failed: ${e.message}` };
  }
  if (!res.ok) return { ...receipt, state: ACCEPTED_UNVERIFIED, reason: `readback HTTP ${res.status}` };

  const exp = res.json?.experience || res.json || {};
  const stored = exp.content;
  if (typeof stored !== 'string') {
    return { ...receipt, state: ACCEPTED_UNVERIFIED, reason: 'readback carried no experience.content — cannot compare, which is not the same as a mismatch' };
  }

  const storedTags = exp.tags || res.json?.tags || [];
  const out = { ...receipt, storedSha256: sha256(stored), tagsStoredCount: storedTags.length };

  const missingTags = receipt.tagsSent.filter((t) => !storedTags.includes(t));
  if (out.storedSha256 !== receipt.contentSha256) {
    // A mismatch has two causes that must not share a verdict. Memory-layer PREVIEWS on store:
    // anything past ~410 bytes is dropped, so a perfectly healthy large write can never
    // hash-match. Reporting that as FAILED cries corruption on every big record — and a check
    // that cannot pass is worse than none. Distinguish by measuring against the sent text.
    // sentText is passed, never stored on the receipt — receipts get logged, and a 19KB body
    // in a log line is how content escapes into places the redaction gate never sees.
    const cls = sentText != null
      ? classifyStored(sentText, exp)
      : { form: STORED_UNKNOWN, coverage: null, reason: 'no sentText supplied to compare against' };

    if (cls.form === STORED_PREVIEW) {
      return {
        ...out,
        state: ACCEPTED_UNVERIFIED,
        storedForm: STORED_PREVIEW,
        storedCoverage: cls.coverage,
        reason: `memory-layer stored a preview, not the document — ${cls.reason}. The write succeeded; the record is not a durable copy.`,
      };
    }
    if (cls.form === STORED_FULL) return { ...out, state: VERIFIED, storedForm: STORED_FULL, storedCoverage: cls.coverage, reason: null };
    // DIVERGENT and UNKNOWN both fail, but for different reasons a reader needs kept apart.
    return { ...out, state: FAILED, storedForm: cls.form, storedCoverage: cls.coverage, reason: cls.reason || 'stored content does not match what was sent' };
  }
  if (missingTags.length) {
    // memory-layer dropped a sent tag — the record is not scoped as intended.
    return { ...out, state: ACCEPTED_UNVERIFIED, storedForm: STORED_FULL, storedCoverage: 1, reason: `memory-layer did not retain tag(s): ${missingTags.join(', ')}` };
  }
  return { ...out, state: VERIFIED, storedForm: STORED_FULL, storedCoverage: 1, reason: null };
}

// ── Stored-form inspection ──────────────────────────────────────────────────

/** Whitespace-normalised compare — memory-layer flattens newlines on store. */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Best available reconstruction of a stored record's text, and WHICH path produced it.
 *
 * Order: `content`, then `metadata.compressed_data`. The compressed blob is a framed record
 * (preview + entity table), not the document, so a decode that yields LESS text than `content`
 * is rejected rather than preferred — decoding successfully is not the same as decoding usefully.
 */
export function storedText(experience) {
  const exp = experience?.experience || experience || {};
  const content = typeof exp.content === 'string' ? exp.content : null;
  const blob = exp.metadata?.compressed_data;

  let recovered = null;
  let attempts = [];
  if (blob) {
    // accept() is the second gate: a wrong offset can decode without throwing and emit garbage.
    //
    // The threshold is HIGH on purpose. The real blob decodes to a framed record — preview text
    // followed by a ~600-row binary NER table — that is 66% printable and 27KB long. At a loose
    // threshold it was accepted as document text, and because it is LONGER than `content` it was
    // preferred, dragging containment to 8.5% and reporting a preview as CORRUPTION. Prose runs
    // ~99% printable; anything below PROSE_FLOOR is a structure, not a document.
    const prose = (s) => (s.match(/[\x20-\x7e\s]/g) || []).length / Math.max(1, s.length) >= PROSE_FLOOR;
    const res = decompress(blob, { accept: prose });
    attempts = res.attempts;
    if (res.ok) recovered = res.text;
  }

  const useRecovered = recovered && norm(recovered).length > norm(content || '').length;
  return {
    text: useRecovered ? recovered : content,
    source: useRecovered ? 'compressed' : content != null ? 'content' : 'none',
    contentBytes: content == null ? null : Buffer.byteLength(content, 'utf8'),
    recoveredBytes: recovered == null ? null : Buffer.byteLength(recovered, 'utf8'),
    attempts,
  };
}

/**
 * Does the server hold what was sent? Compares against the SOURCE text, which is the only
 * comparison that can catch a payload chosen wrongly before the write — hashing sent-against-stored
 * closes the channel and leaves the selection unwitnessed.
 *
 * Returns coverage as a MEASURED fraction. A durability claim quotes this, never the size of
 * the buffer it assembled.
 */
export function classifyStored(sourceText, experience, { tolerance = PREVIEW_TOLERANCE } = {}) {
  const st = storedText(experience);
  if (st.text == null) return { form: STORED_UNKNOWN, coverage: null, reason: 'no content and no decodable blob', ...st };

  const src = norm(sourceText);
  const got = norm(st.text);
  if (!src) return { form: STORED_UNKNOWN, coverage: null, reason: 'no source text to compare against', ...st };

  if (sha256(st.text) === sha256(sourceText)) return { form: STORED_FULL, coverage: 1, containment: 1, lengthRatio: 1, reason: null, ...st };

  // Two directions, because one of them alone cannot tell truncation from corruption:
  //   coverage    — how much of the SOURCE is present in what was stored
  //   containment — how much of what was STORED comes from the source
  // A preview is high-containment and low-coverage. Corruption is low on both. Measuring only
  // coverage collapses them, and the corruption check silently stops working.
  const shingles = (s) => { const w = s.split(' '); const o = []; for (let i = 0; i + 8 <= w.length; i += 8) o.push(w.slice(i, i + 8).join(' ')); return o; };
  const srcSh = shingles(src);
  const gotSh = shingles(got);
  const inGot = (x) => got.includes(x);
  const inSrc = (x) => src.includes(x);
  const coverage = srcSh.length ? srcSh.filter(inGot).length / srcSh.length : (got === src ? 1 : 0);
  const containment = gotSh.length ? gotSh.filter(inSrc).length / gotSh.length : (src.includes(got) ? 1 : 0);

  // Length ratio is the independent witness for coverage: shingle coverage inflates on repetitive
  // text, where one stored copy satisfies many identical source shingles. Both must clear the bar.
  // Computed BEFORE the divergence branch so every verdict carries it — a field present on some
  // outcomes and absent on others is read as zero by the next consumer along.
  const lengthRatio = src.length ? got.length / src.length : 0;

  if (containment < CONTAINMENT_FLOOR) {
    return { form: STORED_DIVERGENT, coverage, containment, lengthRatio, reason: `stored text is not derived from the source (${(containment * 100).toFixed(1)}% of it appears in the source)`, ...st };
  }

  if (coverage >= tolerance && lengthRatio >= tolerance) {
    return { form: STORED_FULL, coverage, containment, lengthRatio, reason: 'normalised match above tolerance', ...st };
  }
  return {
    form: STORED_PREVIEW,
    coverage,
    containment,
    lengthRatio,
    reason: `server holds ${(Math.min(coverage, lengthRatio) * 100).toFixed(1)}% of the source — the rest was discarded on store`,
    ...st,
  };
}

// ── Enumeration ─────────────────────────────────────────────────────────────

/**
 * STRICT tag recall — the only tag-scoped read here (/api/recall ignores its `tags` filter).
 * For ENUMERATION, not existence checks: content-derived tags mean a tag is not an identity.
 */
export async function recallByTags(tags, { limit = 50, env = process.env, key = null, fetchImpl = fetch } = {}) {
  const cfg = config({ env });
  const cred = key ? { ok: true, key } : credential({ env });
  if (!cred.ok) return { ok: false, reason: 'VELD_API_KEY unresolvable', memories: null };
  let res;
  try {
    // A project tag is sent under every namespace it was ever written with; see PROJECT_TAG_NAMESPACES.
    res = await call('/api/recall/tags', { body: { user_id: cfg.userId, tags: expandProjectTags(tags), limit }, key: cred.key, cfg, fetchImpl });
  } catch (e) { return { ok: false, reason: e.message, memories: null }; }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, memories: null };
  // `memories: null` on failure, never [] — a failed query observed nothing.
  return { ok: true, reason: null, memories: res.json?.memories || res.json?.results || [] };
}

/**
 * SEMANTIC recall — `/api/recall`, which ranks by meaning and, as the note above records, IGNORES
 * any tag filter it is given. So this returns whatever the layer thought was relevant across every
 * writer and project, and the caller must filter. It is exposed with that stated rather than
 * wrapped in a tag argument that would look like scoping and do nothing.
 *
 * `mode` DEFAULTS TO veld's own default, `hybrid`, and hybrid IS NOT DETERMINISTIC. Measured
 * 2026-09-04 against 0.7.39+229 over a 2,615-record index: four identical queries returned four
 * different result sets with ZERO names common to all four, while `semantic` returned the same five
 * every time. A caller that needs a repeatable answer — which is every caller whose output is
 * checked by anybody — must pass `mode: 'semantic'` explicitly. The default is left alone because
 * it is the server's, and silently changing it would surprise a caller who wanted hybrid.
 *
 * The response shape is NOT the tag-recall shape: rows carry `experience` (unwrap with
 * `storedText`) and `score`, and neither `content`, `tags`, nor `external_id`. See
 * codegraph/veld.mjs for what reading `m.content` here costs — a clean return of zero results.
 *
 * `memories: null` on failure, never [] — a failed query observed nothing, and an empty result is a
 * different fact from an unanswered one.
 */
export async function recallSemantic(query, { limit = 20, mode = 'hybrid', env = process.env, key = null, fetchImpl = fetch } = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    return { ok: false, reason: 'an empty query is not a query', memories: null };
  }
  const cfg = config({ env });
  const cred = key ? { ok: true, key } : credential({ env });
  if (!cred.ok) return { ok: false, reason: 'VELD_API_KEY unresolvable', memories: null };
  let res;
  try {
    res = await call('/api/recall', { body: { user_id: cfg.userId, query, limit, mode }, key: cred.key, cfg, fetchImpl });
  } catch (e) { return { ok: false, reason: e.message, memories: null }; }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, memories: null };
  return { ok: true, reason: null, memories: res.json?.memories || res.json?.results || [] };
}

// ── Receipt aggregation ─────────────────────────────────────────────────────

/** Three states, not two. inserted/updated are the canary for an external_id identity
 *  regression — a moving id turns every update into a fresh, perfectly-verifying insert. */
export function tally(receipts) {
  const t = {
    verified: 0, acceptedUnverified: 0, failed: 0, notAttempted: 0,
    // The NEXT undeclared state announces itself here instead of inflating `failed`. An unguarded
    // else is how `dry-run` was reported as data loss for as long as both have existed.
    unknownState: 0,
    truncated: 0, inserted: 0, updated: 0,
    // Stored form is its own axis — a previewed record is accepted-unverified AND not a copy.
    // Counted separately so "0 failed" can never be read as "N durable records".
    // ALL FOUR are counted. `divergent` — corruption, the most severe form — previously fell
    // through both branches and had no number anywhere, in the very tally written so that a
    // healthy-looking count could not hide an unhealthy store.
    storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0,
    total: receipts.length,
  };
  for (const r of receipts) {
    if (r.state === VERIFIED) t.verified++;
    else if (r.state === ACCEPTED_UNVERIFIED) t.acceptedUnverified++;
    else if (r.state === FAILED) t.failed++;
    else if (r.state === NOT_ATTEMPTED) t.notAttempted++;
    else t.unknownState++;
    if (r.truncated) t.truncated++;
    if (r.storedForm === STORED_FULL) t.storedFull++;
    else if (r.storedForm === STORED_PREVIEW) t.storedPreview++;
    else if (r.storedForm === STORED_DIVERGENT) t.storedDivergent++;
    else if (r.storedForm === STORED_UNKNOWN) t.storedUnknown++;
    // Only counted when memory-layer said so — was_update:null is not an insert.
    if (r.was_update === false) t.inserted++;
    else if (r.was_update === true) t.updated++;
  }
  return t;
}

export function summarise(receipts) {
  const t = tally(receipts);
  const parts = [`${t.verified} verified`];
  if (t.acceptedUnverified) parts.push(`${t.acceptedUnverified} accepted-unverified`);
  if (t.failed) parts.push(`${t.failed} failed`);
  // Never folded into failed: a dry run wrote nothing and lost nothing.
  if (t.notAttempted) parts.push(`${t.notAttempted} not attempted (dry run)`);
  // An undeclared state is a fact about this CLIENT, not about the store. Say so rather than
  // silently binning it in one of the real counters.
  if (t.unknownState) parts.push(`${t.unknownState} carrying a state this client does not declare`);
  // Always printed, even at zero — the canary has to be visible on healthy runs.
  parts.push(`${t.inserted} new, ${t.updated} updated`);
  if (t.truncated) parts.push(`${t.truncated} truncated at source`);
  // Loudest term in the line when non-zero: these records were accepted and are NOT copies.
  if (t.storedPreview) parts.push(`${t.storedPreview} STORED AS PREVIEW ONLY (not a durable copy)`);
  // Louder than preview: divergent means the stored text is not derived from what was sent.
  if (t.storedDivergent) parts.push(`${t.storedDivergent} STORED DIVERGENT (corruption, not truncation)`);
  if (t.storedUnknown) parts.push(`${t.storedUnknown} stored form unknown`);
  return parts.join(', ');
}
