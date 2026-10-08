// monitor/issue-store.mjs — issue tracker library: store, mint, lifecycle, ready-work, ingest.
// Auto-close is evidence-gated, never absence-gated; a reappearing sourceKey reopens the same id.
// Store: monitor/issues.json (CW_ISSUES) — hash-chained events[] + derived issues{}; never hand-edit.

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeJSONAtomic, chainHash } from '../cra/lib.mjs';
import { acquireLock } from './lockfile.mjs';

import { formatIssueId, classForIssue, classForQueueEntry, DEFAULT_ORG } from './issue-key.mjs';

import { identityFor, identityIsKey } from './detail-schema.mjs';
// Imported, never re-declared — two copies of a category list is how registry drift starts.

import { validateAgainstSchema } from './registry.mjs';
import { issuesPathFor } from './store-paths.mjs';
import { SLA_TIERS } from './lifecycle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// ── identity ──────────────────────────────────────────────────────────────────────────────────
// ISS- is a parallel id space to CWX-. Reading accepts legacy flat + scoped ids; minting is scoped-only.
export { ISS_RE_ANY as ISS_RE, ISS_RE_LEGACY, ISS_RE_SCOPED } from './issue-key.mjs';

export const ISSUE_STATES = Object.freeze(['open', 'claimed', 'blocked', 'unsatisfiable', 'closed']);
export const CLOSED_AS = Object.freeze(['fixed', 'accepted', 'refuted', 'superseded']);
// Why an item has no path to done. Not a close — nothing was fixed, accepted or refuted — so it
// leaves the queue and stays countable apart from both the queue and the closed set.
export const UNSATISFIABLE_CODES = Object.freeze(['lane-retired', 'area-retired', 'blocker-unsatisfiable', 'manual']);
export const SOURCE_KINDS = Object.freeze(['finding', 'scanner-row', 'queue', 'manual']);
export const ISSUE_KINDS = Object.freeze(['vuln', 'code', 'config', 'docs', 'task']);

// issue.fix.fixType — how a fix was made; distinct from DISPOSITIONS (whether the finding is real).
export const FIX_TYPES = Object.freeze([
  'code-change', 'config-change', 'dep-upgrade', 'compensating-control', 'suppression', 'wont-fix',
]);

// Same bound and character class as external-judgement.schema.json's `reason`.
export const FIX_NOTES_MIN = 8;
export const FIX_NOTES_MAX = 2000;
const FIX_NOTES_RE = /^[^\u0000-\u001f\u007f]{8,2000}$/;

export const REMEDIATION_EVENT_TYPES = Object.freeze([
  'fix-authored',
  'fix-verified',
  'fix-disputed',
  'fp-reinvestigated',
  'reopened-contradiction',
]);
const REMEDIATION_EVENTS = new Set(REMEDIATION_EVENT_TYPES);

// Severity is normalised once at the door.
const NORM_SEV = { critical: 'crit', crit: 'crit', high: 'high', medium: 'med', moderate: 'med', med: 'med', low: 'low' };
export const normaliseSeverity = (s) => NORM_SEV[String(s || '').toLowerCase()] || 'unknown';
// unknown ranks between low and med — a data defect belongs where someone sees it.
export const SEV_RANK = Object.freeze({ crit: 4, high: 3, med: 2, unknown: 1.5, low: 1 });

// ── authority gate ────────────────────────────────────────────────────────────────────────────
// Infrastructure change classes for manually-filed issues; applying these is a human act.
export const AUTHORITY_CATEGORIES = new Set(['deploy', 'dns', 'tunnel', 'tls', 'branch-protection']);

// D11: scanner categories whose fix lives OUTSIDE this tree (needs credentials commitwork
// deliberately does not hold). Consulted on the scanner ingest path; sets authorityRequired.
export const AUTHORITY_SCANNER_CATEGORIES = new Set(['cspm', 'tlsHeaders']);

// ── clock / paths (every input CW_*-overridable) ─────────────────────────────────────────────
export { nowISO };
// Re-exported from store-paths.mjs, which is a leaf so callers that cannot import this module
// (bin/verdict-journal.mjs would close a cycle) still get the ONE definition. See that file for why
// there was more than one.
export { issuesPathFor };
export const issuesPath = () => issuesPathFor(ROOT);
export const issueSchemaPath = () =>
  (process.env.CW_ISSUE_SCHEMA ? resolve(process.env.CW_ISSUE_SCHEMA) : join(ROOT, 'schema', 'issue.schema.json'));

export const CLAIM_TTL_HOURS = () => +(process.env.CW_ISSUE_CLAIM_TTL_HOURS || 4);
export const STALE_HOURS = () => +(process.env.CW_ISSUE_STALE_HOURS || 26);

// ── store ─────────────────────────────────────────────────────────────────────────────────────
export function emptyIssuesDoc() {
  return {
    note: 'commitwork issue tracker — append-only events[] (hash-chained evidence trail); '
        + 'issues{} is derived current state. Never edit by hand; linear git history only. '
        + 'Verify: node bin/issue.mjs verify',
    version: 1,
    // Tenant for minted ids; null when undeclared.
    organisation: process.env.CW_ISSUE_ORG || null,
    nextOrdinal: 0,
    byKey: {},        // sourceKey -> ISS id (idempotent mint; reopen finds the same id here)
    lastIngest: {},   // areaSlug -> {sliceId, generated} — slice monotonicity guard (A1)
    events: [],
    issues: {},
  };
}

// Fail closed: only ENOENT is absence; the schema runs on every load.
export function loadIssues({ path = issuesPath(), schemaPath = issueSchemaPath() } = {}) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return emptyIssuesDoc();
    throw new Error(`issue store at ${path} is unreadable (${e.code}); refusing to treat it as empty`);
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error(`issue store at ${path} is not valid JSON (${e.message}); refusing to treat it as empty`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`issue store at ${path} is not an object`);
  const { errors } = validateAgainstSchema(doc, { path: schemaPath });
  if (errors.length) throw new Error(`issue store invalid (${path}):\n  - ${errors.join('\n  - ')}`);
  return doc;
}

// ── the chokepoint ────────────────────────────────────────────────────────────────────────────
// Store paths this process holds the lock for. Module-level so every importer shares one instance.
// Paths resolved on both sides — the lock is keyed on the file, not the spelling of its path.
const heldStores = new Set();

/** Does THIS process hold the issue-store lock for `path`? Exported for gates and tests; callers
 *  that merely want to write should take withIssuesLock rather than consult this. */
export const holdsIssuesLock = (path = issuesPath()) => heldStores.has(resolve(path));

export function saveIssues(doc, { path = issuesPath(), schemaPath = issueSchemaPath() } = {}) {
  const target = resolve(path);
  // Fail closed: a write without the lock is a silent lost update.
  if (!heldStores.has(target)) {
    throw new Error(
      `refusing to save the issue store at ${target} without its lock — wrap the load/mutate/save in `
      + 'withIssuesLock(). The write itself is atomic, which prevents a TORN file and does nothing '
      + 'about a LOST one: a concurrent writer\'s document simply replaces yours, and verifyChain '
      + 'reports no problem because the records it lost were never in the file it hashed.',
    );
  }
  // Every reader validates on load, so an invalid write locks every reader out, not just this one.
  const { errors } = validateAgainstSchema(doc, { path: schemaPath });
  if (errors.length) throw new Error(`refusing to save an invalid issue store (${target}):\n  - ${errors.join('\n  - ')}`);
  writeJSONAtomic(target, doc);
}

// Read-modify-write serialisation — the atomic write alone does not stop interleaving.
// contract: `attempts` is a synchronous busy-wait in 20ms rounds; request handlers keep the default,
// a CLI may wait longer because blocking its own process costs nobody else
export function withIssuesLock(fn, { path = issuesPath(), attempts = 50 } = {}) {
  const target = resolve(path);
  const held = acquireLock(`${target}.lock`, {
    staleMs: 30_000, label: 'issue-store', attempts, spinMs: 20,
    onStale: (ageMs) => console.warn(`[issues] breaking a stale store lock (${Math.round(ageMs / 1000)}s old)`),
  });
  if (!held.ok) throw new Error(`issue store is locked by another process (${target}.lock); try again`);
  heldStores.add(target);
  // Deregister before release so saveIssues never believes a handed-on lock is held.
  try { return fn(); } finally { heldStores.delete(target); held.release(); }
}

// ── events (hash chain) ───────────────────────────────────────────────────────────────────────
export function appendIssueEvent(doc, type, issueId, data, at) {
  const prevHash = doc.events.length ? doc.events[doc.events.length - 1].hash : null;
  const event = { type, issueId, at, data: data || {}, prevHash, hash: '' };
  event.hash = chainHash(prevHash, event);
  doc.events.push(event);
  return event;
}

const pathPrefixFor = (raw) => {
  const clean = String(raw || '').replace(/^file:\/\/\/src\//, '').replace(/^\/+/, '');
  if (!clean) return './';
  const dir = posix.dirname(clean);
  return dir === '.' ? './' : `${dir.replace(/\/$/, '')}/`;
};

export function learningPatternForIssue(iss, explicit = null) {
  if (!iss) throw new Error('learning pattern requires an issue');
  if (explicit) {
    if (typeof explicit.rule !== 'string' || !explicit.rule.trim()) throw new Error('learning pattern requires rule');
    if (typeof explicit.pathPrefix !== 'string' || !explicit.pathPrefix.trim()) throw new Error('learning pattern requires pathPrefix');
    if (explicit.package !== undefined && explicit.package !== null && typeof explicit.package !== 'string') {
      throw new Error('learning pattern package must be a string or null');
    }
    return { rule: explicit.rule.trim(), pathPrefix: explicit.pathPrefix.trim(), package: explicit.package || null };
  }

  const source = iss.source || {};
  const raw = String(source.key || '');
  const key = raw.replace(/^(?:f:|g:|sc:|gs:)/, '').split('|');
  let rule = source.rule || null;
  let pkg = null;
  let file = iss.anchor?.file || null;
  if (raw.startsWith('f:')) {
    rule ||= [key[1], key[2]].filter(Boolean).join('/') || null;
    pkg = key[3] || null;
    file ||= key[4] || null;
  } else if (raw.startsWith('g:')) {
    rule ||= `${source.tool || 'dependency'}/group`;
    pkg = key[1] || null;
  } else if (raw.startsWith('sc:')) {
    rule ||= key[2] || source.tool || null;
    file ||= key[3] || null;
  } else if (raw.startsWith('gs:')) {
    rule ||= key[2] || source.tool || null;
  }
  rule ||= `${source.tool || source.kind || 'manual'}/${iss.kind || 'task'}`;
  return { rule, pathPrefix: pathPrefixFor(file), package: pkg };
}

function remediationEventData(iss, { evidence, pattern = null, outcome = null, data = {} } = {}) {
  if (!evidence || typeof evidence !== 'object') throw new Error('remediation event requires evidence');
  const note = String(evidence.note || '').trim();
  const who = String(evidence.who || '').trim();
  if (!note) throw new Error('remediation event evidence.note is required');
  if (!who) throw new Error('remediation event evidence.who is required');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('remediation event data must be an object');
  const p = learningPatternForIssue(iss, pattern);
  return { ...data, ...p, evidence: { note, who }, ...(outcome ? { outcome } : {}) };
}

export function appendRemediationEvent(doc, type, issueId, { at, evidence, pattern = null, outcome = null, data = {} } = {}) {
  if (!REMEDIATION_EVENTS.has(type)) throw new Error(`remediation event type must be one of ${REMEDIATION_EVENT_TYPES.join('|')}`);
  const iss = doc.issues[issueId];
  if (!iss) throw new Error(`unknown issue ${issueId}`);
  if (!at || Number.isNaN(Date.parse(at))) throw new Error('remediation event requires a parseable at instant');
  if (type === 'fp-reinvestigated' && !['confirmed', 'contradicted'].includes(outcome)) {
    throw new Error('fp-reinvestigated outcome must be confirmed or contradicted');
  }
  return appendIssueEvent(doc, type, issueId,
    remediationEventData(iss, { evidence, pattern, outcome, data }), at);
}

export function verifyChain(doc) {
  const problems = [];
  let prev = null;
  doc.events.forEach((e, i) => {
    if (e.prevHash !== prev) problems.push(`events[${i}]: prevHash mismatch`);
    const expect = chainHash(e.prevHash, e);
    if (e.hash !== expect) problems.push(`events[${i}]: hash mismatch (${e.type} ${e.issueId})`);
    prev = e.hash;
  });
  // the derived state must agree with its own index
  for (const [key, id] of Object.entries(doc.byKey)) {
    if (!doc.issues[id]) problems.push(`byKey['${key}'] -> ${id} which is not in issues{}`);
  }
  for (const [id, iss] of Object.entries(doc.issues)) {
    if (iss.id !== id) problems.push(`issues['${id}'].id is '${iss.id}'`);
    if (!iss.source?.key) continue;
    const holder = doc.byKey[iss.source.key];
    if (holder === id) continue;
    // A key may be claimed by several records (superseded duplicates); the slot must point at a
    // claimant, and an open issue is never displaced by a closed one.
    if (!holder) { problems.push(`${id}: sourceKey '${iss.source.key}' is indexed by nobody`); continue; }
    const held = doc.issues[holder];
    if (!held || held.source?.key !== iss.source.key) {
      problems.push(`${id}: sourceKey indexed to ${holder}, which does not claim it`);
    } else if (iss.state !== 'closed' && held.state === 'closed') {
      problems.push(`${id}: open issue displaced in byKey by closed ${holder}`);
    }
  }
  return problems;
}

// Identity invariant alone: byKey resolves one key to one OPEN issue, and back. Cheap (no
// hashing), so callers can run it at write time and refuse to save a store they just broke.
export function identityProblems(doc) {
  const problems = [];
  const claimedBy = new Map();      // source.key -> [ids] among open issues
  for (const iss of Object.values(doc.issues || {})) {
    if (iss.state === 'closed' || !iss.source?.key) continue;
    if (!claimedBy.has(iss.source.key)) claimedBy.set(iss.source.key, []);
    claimedBy.get(iss.source.key).push(iss.id);
  }
  for (const [key, ids] of claimedBy) {
    if (ids.length > 1) problems.push(`sourceKey '${key}' is claimed by ${ids.length} open issues: ${ids.join(', ')}`);
    const indexed = doc.byKey?.[key];
    if (indexed && !ids.includes(indexed) && doc.issues[indexed]?.state !== 'closed') {
      problems.push(`byKey['${key}'] -> ${indexed}, which does not claim it`);
    }
    for (const id of ids) {
      if (indexed !== id && ids.length === 1) problems.push(`${id}: open issue is not indexed by its own sourceKey`);
    }
  }
  return problems;
}

// Rebuild byKey from the issues (repair primitive). Open beats closed; among equals oldest
// createdAt wins. Returns {rebound, dropped, unchanged}.
export function reindexByKey(doc, { dryRun = false } = {}) {
  const best = new Map();           // key -> issue
  for (const iss of Object.values(doc.issues || {})) {
    if (!iss.source?.key) continue;
    const cur = best.get(iss.source.key);
    if (!cur) { best.set(iss.source.key, iss); continue; }
    const curOpen = cur.state !== 'closed';
    const issOpen = iss.state !== 'closed';
    if (issOpen !== curOpen) { if (issOpen) best.set(iss.source.key, iss); continue; }
    if (String(iss.createdAt) < String(cur.createdAt)) best.set(iss.source.key, iss);
  }
  const next = {};
  for (const [key, iss] of best) next[key] = iss.id;
  const rebound = [], dropped = [];
  for (const [key, id] of Object.entries(next)) {
    if (doc.byKey[key] !== id) rebound.push({ key, from: doc.byKey[key] ?? null, to: id });
  }
  for (const key of Object.keys(doc.byKey || {})) {
    if (!(key in next)) dropped.push({ key, was: doc.byKey[key] });
  }
  if (!dryRun) doc.byKey = next;
  return { rebound, dropped, unchanged: Object.keys(next).length - rebound.length };
}

// ── mint / mutate ─────────────────────────────────────────────────────────────────────────────
export const slaDueAt = (createdAtIso, severity) => {
  const days = SLA_TIERS[severity] ?? SLA_TIERS.med;
  return new Date(new Date(createdAtIso).getTime() + days * 86_400_000).toISOString();
};

// ── D12 line-free identity migration ─────────────────────────────────────────────────────────
// Adopt on contact (1 legacy record), collapse deliberately (2+ → survivor; rest closed as
// superseded, never deleted). Survivor inherits earliest createdAt and worst severity — a
// collapse must not restart the SLA clock or forgive a crit.
export function migrateLineKeys(doc, newKeys, { at, dryRun = false } = {}) {
  const adopted = [], collapsed = [], skipped = [];

  // Index every existing sc: issue by its LINE-FREE place.
  const byPlace = new Map();
  for (const iss of Object.values(doc.issues)) {
    const k = iss.source?.key;
    if (typeof k !== 'string' || !k.startsWith('sc:')) continue;
    const place = scannerPlaceKey(k);
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(iss);
  }

  for (const target of [...new Set(newKeys || [])]) {
    if (typeof target !== 'string' || !target.startsWith('sc:')) continue;
    // Only ever migrate TO a line-free key.
    if (scannerPlaceKey(target) !== target) { skipped.push({ target, why: 'target still carries a line' }); continue; }

    const members = (byPlace.get(target) || []).filter((i) => i.source.key !== target);
    if (!members.length) continue;                       // nothing legacy here

    if (members.length === 1) {
      const iss = members[0], from = iss.source.key;
      adopted.push({ id: iss.id, from, to: target });
      if (dryRun) continue;
      iss.priorKeys = [...new Set([...(iss.priorKeys || []), from])];
      iss.source = { ...iss.source, key: target };
      if (doc.byKey[from] === iss.id) delete doc.byKey[from];
      doc.byKey[target] = iss.id;
      iss.updatedAt = at;
      appendIssueEvent(doc, 'issue-key-migrated', iss.id,
        { from, to: target, why: 'D12: identity is line-free; the line moved to anchor/anchorHistory' }, at);
      continue;
    }

    // 2+ — a genuine collapse.
    const survivor = chooseSurvivor(members);
    const absorbed = members.filter((m) => m.id !== survivor.id);
    const inherit = collapseInheritance(survivor, absorbed, { at });
    collapsed.push({ id: survivor.id, to: target, absorbed: absorbed.map((a) => a.id), from: survivor.source.key });
    if (dryRun) continue;

    for (const a of absorbed) {
      // Absorbed record keeps its historical key and index slot; the survivor holds the NEW place
      // key, so the two never contend for one slot.
      mutateIssue(doc, a.id, (i) => {
        i.deps.supersededBy = survivor.id;
        i.state = 'closed';
        i.closedAs = 'superseded';
        i.claim = null;
        i.evidence.push({ at, tier: 'manual', detail: `collapsed into ${survivor.id} — same place under the line-free identity (D12)` });
      }, 'issue-closed', { closedAs: 'superseded', supersededBy: survivor.id, why: 'D12 collapse' }, at);
    }

    const from = survivor.source.key;
    mutateIssue(doc, survivor.id, (i) => {
      i.priorKeys = [...new Set([...(i.priorKeys || []), from, ...inherit.priorKeys])];
      i.source = { ...i.source, key: target };
      i.createdAt = inherit.createdAt;
      i.severity = inherit.severity;
      i.slaDueAt = inherit.slaDueAt;
      i.reopenCount = inherit.reopenCount;
      i.suspect = inherit.suspect;
      i.attemptCount = inherit.attemptCount;
    }, 'issue-key-migrated', { from, to: target, absorbed: absorbed.map((a) => a.id), inherited: { createdAt: inherit.createdAt, severity: inherit.severity } }, at);
    if (doc.byKey[from] === survivor.id) delete doc.byKey[from];
    doc.byKey[target] = survivor.id;
  }

  return { adopted, collapsed, skipped };
}

// Survivor election is a total order (never iteration order): live beats closed, then oldest
// createdAt, then most evidence, then smallest id.
export function chooseSurvivor(members) {
  const all = (members || []).filter(Boolean);
  if (!all.length) return null;
  const live = all.filter((i) => i.state !== 'closed');
  const pool = live.length ? live : all;
  return [...pool].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || (b.evidence?.length ?? 0) - (a.evidence?.length ?? 0)
    || String(a.id).localeCompare(String(b.id)))[0];
}

export function collapseInheritance(survivor, absorbed, { at }) {
  const all = [survivor, ...absorbed].filter(Boolean);
  if (all.length < 2) return null;

  const earliest = all.map((i) => i.createdAt).filter(Boolean).sort()[0] ?? survivor.createdAt;
  const worst = all.reduce((w, i) => ((SEV_RANK[i.severity] ?? 0) > (SEV_RANK[w] ?? 0) ? i.severity : w), survivor.severity);

  // Union of every key any absorbed issue was ever known by.
  const priorKeys = [...new Set([
    ...(survivor.priorKeys || []),
    ...absorbed.flatMap((i) => [...(i.priorKeys || []), i.source?.key].filter(Boolean)),
  ])];

  return {
    createdAt: earliest,
    severity: worst,
    slaDueAt: slaDueAt(earliest, worst),
    priorKeys,
    // Carried, not reset: merging does not make an issue clean.
    reopenCount: Math.max(...all.map((i) => i.reopenCount || 0)),
    suspect: all.some((i) => i.suspect === true),
    attemptCount: Math.max(...all.map((i) => i.attemptCount || 0)),
    // authorityRequired is recomputed at ingest (D11), never inherited.
    absorbedFrom: absorbed.map((i) => ({ id: i.id, key: i.source?.key ?? null, createdAt: i.createdAt })),
    at,
  };
}

function newRecord(id, fields, at) {
  const severity = normaliseSeverity(fields.severity);
  return {
    id,
    area: fields.area,
    repo: fields.repo ?? null,
    source: fields.source ?? { kind: 'manual', key: null, tool: null, rule: null },
    groupMembers: fields.groupMembers ?? null,
    kind: fields.kind ?? 'task',
    severity,
    title: fields.title,
    body: fields.body ?? null,
    remediation: fields.remediation ?? null,
    state: 'open',
    closedAs: null,
    blockedReason: null,
    deps: { blockedBy: [], duplicateOf: null, supersededBy: null },
    claim: null,
    attemptCount: 0,
    suspect: false,
    evidence: [],
    anchor: fields.anchor ?? null,
    // D12: absent on older records; absence means unrecorded, never unmoved.
    anchorHistory: [],
    waiver: null,
    authorityRequired: fields.authorityRequired ?? false,
    slaDueAt: slaDueAt(at, severity),
    reopenCount: 0,
    createdAt: at,
    updatedAt: at,
  };
}

// Idempotent on sourceKey: same source, same ISS id forever. Manual issues always mint fresh.
export function mintIssue(doc, fields, at) {
  const sourceKey = fields.source?.key ?? null;
  if (sourceKey && doc.byKey[sourceKey]) {
    return { id: doc.byKey[sourceKey], existed: true };
  }
  // Org lives on the store; undeclared mints under DEFAULT_ORG. Minted ids are permanent —
  // declaring a real org later is a migration (bin/issue-rekey.mjs).
  const id = formatIssueId({
    org: doc.organisation || DEFAULT_ORG,
    cls: classForIssue(fields),
    ordinal: doc.nextOrdinal,
  });
  doc.nextOrdinal += 1;
  if (sourceKey) doc.byKey[sourceKey] = id;
  doc.issues[id] = newRecord(id, fields, at);
  appendIssueEvent(doc, 'issue-opened', id, {
    area: fields.area, severity: doc.issues[id].severity, sourceKey, title: fields.title,
  }, at);
  return { id, existed: false };
}

// Single mutation funnel: mutate -> stamp updatedAt -> append event. Never poke issues{} directly.
export function mutateIssue(doc, id, fn, eventType, data, at) {
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  fn(iss);
  iss.updatedAt = at;
  appendIssueEvent(doc, eventType, id, data || {}, at);
  return iss;
}

// ── claims (atomic under withIssuesLock) ──────────────────────────────────────────────────────
export const claimExpired = (claim, nowIso) => !claim || new Date(claim.expiresAt).getTime() <= new Date(nowIso).getTime();

export function claimIssue(doc, id, { by, sessionId, at, ttlHours = CLAIM_TTL_HOURS() }) {
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  if (iss.state === 'closed') throw new Error(`${id} is closed`);
  if (iss.state === 'blocked') throw new Error(`${id} is blocked: ${iss.blockedReason}`);
  if (iss.state === 'unsatisfiable') throw new Error(`${id} is unsatisfiable: ${iss.unsatisfiable?.reason}`);
  if (iss.claim && !claimExpired(iss.claim, at) && iss.claim.sessionId !== sessionId) {
    const err = new Error(`${id} is claimed by ${iss.claim.by} until ${iss.claim.expiresAt}`);
    err.code = 'CLAIM_CONFLICT';
    throw err;
  }
  return mutateIssue(doc, id, (i) => {
    i.state = 'claimed';
    i.claim = { by, sessionId, at, expiresAt: new Date(new Date(at).getTime() + ttlHours * 3600_000).toISOString() };
    i.attemptCount += 1;
  }, 'issue-claimed', { by, sessionId, attempt: iss.attemptCount + 1 }, at);
}

// sessionId makes the release ownership-checked; omitted = unconditional (human CLI).
export function releaseIssue(doc, id, { at, reason = 'released', sessionId = null, force = false }) {
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  if (sessionId && !force && iss.claim && !claimExpired(iss.claim, at) && iss.claim.sessionId !== sessionId) {
    const err = new Error(`${id} is claimed by ${iss.claim.by} (session ${iss.claim.sessionId}); release refused`);
    err.code = 'CLAIM_CONFLICT';
    throw err;
  }
  return mutateIssue(doc, id, (i) => {
    i.state = i.state === 'claimed' ? 'open' : i.state;
    i.claim = null;
  }, 'issue-released', { reason }, at);
}

export function blockIssue(doc, id, { at, reason }) {
  if (!reason || !String(reason).trim()) throw new Error('blockIssue requires a reason');
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  if (iss.state === 'closed') throw new Error(`${id} is closed`);
  if (iss.state === 'unsatisfiable') throw new Error(`${id} is unsatisfiable — reopen it before blocking it`);
  return mutateIssue(doc, id, (i) => {
    i.state = 'blocked';
    i.blockedReason = String(reason);
    i.claim = null;
  }, 'issue-blocked', { reason: String(reason) }, at);
}

// ── unsatisfiable: no path to done ────────────────────────────────────────────────────────────
// blockedReason is kept, not overwritten: an item blocked and then found unsatisfiable carries both.
export function markUnsatisfiable(doc, id, { code, reason, at, by = null }) {
  if (!UNSATISFIABLE_CODES.includes(code)) throw new Error(`unsatisfiable code must be one of ${UNSATISFIABLE_CODES.join('|')}`);
  if (!reason || !String(reason).trim()) throw new Error('markUnsatisfiable requires a reason — an item leaves the queue with its reason or not at all');
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  if (iss.state === 'closed') throw new Error(`${id} is closed`);
  if (iss.state === 'unsatisfiable') throw new Error(`${id} is already unsatisfiable (${iss.unsatisfiable?.code})`);
  if (iss.state === 'claimed' && !claimExpired(iss.claim, at)) {
    const err = new Error(`${id} is claimed by ${iss.claim.by} until ${iss.claim.expiresAt}`);
    err.code = 'CLAIM_CONFLICT';
    throw err;
  }
  const from = iss.state;
  return mutateIssue(doc, id, (i) => {
    i.state = 'unsatisfiable';
    i.claim = null;
    i.unsatisfiable = { code, reason: String(reason), at, by };
  }, 'issue-unsatisfiable', { code, reason: String(reason), from, by }, at);
}

// The reader that assigns it. Pure: the caller supplies what is still registered, and a list it
// could not supply is reported as an unrun check, never read as "everything is retired".
//   categories — Set of scanner categories ingest still runs (SCANNER_SPECS), or null
//   areas      — Set of registered area slugs, or null
// Only scan-sourced issues are judged against these: a manual issue's area need not be registered,
// and only ingest could ever close a scanner or finding issue.
export function findUnsatisfiable(doc, { categories = null, areas = null } = {}) {
  const unmeasured = [];
  if (!(categories instanceof Set)) unmeasured.push('lane-retired: no list of registered scanner categories');
  if (!(areas instanceof Set)) unmeasured.push('area-retired: no list of registered areas');
  const ids = Object.keys(doc.issues).sort();
  const found = new Map(); // id -> {code, reason}
  const skippedClaimed = [];
  const candidate = (i) => i.state === 'open' || i.state === 'blocked';
  for (const id of ids) {
    const i = doc.issues[id];
    if (i.state === 'claimed') { skippedClaimed.push(id); continue; }
    if (!candidate(i)) continue;
    const src = i.source || {};
    const scanned = src.kind === 'scanner-row' || src.kind === 'finding';
    if (src.kind === 'scanner-row' && src.tool && categories instanceof Set && !categories.has(src.tool)) {
      found.set(id, { code: 'lane-retired', reason: `scanner category '${src.tool}' is no longer registered; ingest never runs it, so no scan can close this` });
    } else if (scanned && areas instanceof Set && !areas.has(i.area)) {
      found.set(id, { code: 'area-retired', reason: `area '${i.area}' is no longer in the registry; ingest never reads it, so no scan can close this` });
    }
  }
  // A blocker that can never close holds its dependants for ever; run to a fixed point.
  const dead = (b) => doc.issues[b]?.state === 'unsatisfiable' || found.has(b);
  for (let changed = true; changed;) {
    changed = false;
    for (const id of ids) {
      const i = doc.issues[id];
      if (found.has(id) || !candidate(i)) continue;
      const b = (i.deps?.blockedBy || []).slice().sort().find(dead);
      if (b) {
        found.set(id, { code: 'blocker-unsatisfiable', reason: `blocked by ${b}, which cannot be completed` });
        changed = true;
      }
    }
  }
  const assign = [...found].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.id.localeCompare(b.id));
  return { assign, unmeasured, skippedClaimed };
}

/**
 * Evidence as text that survives being read back.
 *
 * `String({})` is `[object Object]` — non-empty, truthy, and void — so the `!String(evidence).trim()`
 * guard that used to stand here passed for exactly the input it existed to reject. Measured
 * 2026-09-01: 135 of 259 closures in the live store carry a corrupt evidence field, and 5 distinct
 * strings stand where 135 judgements should be. The guard reported those closes as evidenced.
 *
 * Objects and arrays are JSON-serialised rather than refused, because the callers passing them were
 * passing real content — refusing would lose it a second way. What is refused is a value that
 * serialises to nothing a reader can act on.
 */
export function evidenceText(evidence) {
  if (evidence == null) return '';
  if (typeof evidence === 'string') return evidence.trim();
  if (typeof evidence !== 'object') return String(evidence).trim();
  try {
    const j = JSON.stringify(evidence);
    return j && j !== '{}' && j !== '[]' && j !== 'null' ? j : '';
  } catch {
    return ''; // circular — unserialisable is absent, never `[object Object]`
  }
}

// A2: an unexpired claim from another session blocks the close; force is a human override only.
// `by` names a non-human closer ({ whoKind, channel, tool }); it rides the chained issue-closed event.
export function closeIssue(doc, id, { as, evidence, sessionId = null, force = false, at, by = null }) {
  if (!CLOSED_AS.includes(as)) throw new Error(`closedAs must be one of ${CLOSED_AS.join('|')}`);
  const evText = evidenceText(evidence);
  if (!evText) throw new Error('close requires --evidence (a close without evidence is an assertion, not a closure)');
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  if (iss.state === 'closed') throw new Error(`${id} is already closed (${iss.closedAs})`);
  if (!force && iss.claim && !claimExpired(iss.claim, at) && iss.claim.sessionId !== sessionId) {
    const err = new Error(`${id} is claimed by ${iss.claim.by} (session ${iss.claim.sessionId}); close refused — pass the owning --session or --force (human only)`);
    err.code = 'CLAIM_CONFLICT';
    throw err;
  }
  return mutateIssue(doc, id, (i) => {
    i.state = 'closed';
    i.closedAs = as;
    i.claim = null;
    i.suspect = false;
    i.evidence.push({ at, tier: 'manual', detail: evText });
  }, 'issue-closed', { closedAs: as, evidence: evText, ...(by ? { by } : {}) }, at);
}

export function reopenIssue(doc, id, { at, reason }) {
  const wasFixed = doc.issues[id]?.state === 'closed' && doc.issues[id]?.closedAs === 'fixed';
  const reopened = mutateIssue(doc, id, (i) => {
    i.state = 'open';
    i.closedAs = null;
    i.blockedReason = null;
    if (i.unsatisfiable) i.unsatisfiable = null;
    i.claim = null;
    i.reopenCount += 1;
    i.slaDueAt = slaDueAt(at, i.severity);
  }, 'issue-reopened', { reason }, at);
  if (wasFixed) appendRemediationEvent(doc, 'reopened-contradiction', id, {
    at,
    evidence: { note: String(reason || 'finding reappeared after verification'), who: 'scanner' },
  });
  return reopened;
}

// ── re-grading a closure: APPEND, never rewrite ───────────────────────────────────────────────
//
// fact: a closed issue's verdict can be WRONG and the honest correction must not erase what was originally decided / mutateIssue chains an event but overwrites the record, so a prior verdict is recoverable only by replaying the whole chain — and a rewrite that re-chains still verifies (expiry: never, prev: unknown)
// fact: 66 of 67 `fixed` closures are machine-inferred by the auto-close gate, which once reported 8 findings FIXED when they had merely shifted a few lines / re-grading those is the correction that makes a false-positive rate computable, and it touches 66 records at once (expiry: never, prev: broken)
//
// WHY THIS IS NOT JUST closeIssue AGAIN. Re-grading is the operation that runs over HISTORY, in
// bulk, by a party with an interest in the outcome. Those three properties together are why it
// gets its own funnel: `closedAsOriginal` is written ONCE and never again, so the first verdict
// survives in the record itself rather than only in the chain; `regradeCount` makes the fact that
// a record has been revised visible without a replay; and evidence is mandatory for exactly the
// reason it is mandatory on a close — a re-grade without it is an assertion, not a correction.
//
// The current `closedAs` still moves, because a reader asking "what is this issue now" must get the
// current answer. What must never happen is the ORIGINAL becoming unrecoverable.
export function regradeClosure(doc, id, { to, why, evidence, by = null, at }) {
  if (!CLOSED_AS.includes(to)) throw new Error(`regrade target must be one of ${CLOSED_AS.join('|')}`);
  const evText = evidenceText(evidence);
  if (!evText) throw new Error('regrade requires evidence (a re-grade without it is an assertion, not a correction)');
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  if (iss.state !== 'closed') throw new Error(`${id} is not closed — re-grading applies to a verdict, and an open issue has none`);
  const from = iss.closedAs;
  if (from === to) throw new Error(`${id} is already ${to} — a re-grade must change the verdict`);
  return mutateIssue(doc, id, (i) => {
    // Written once. A second re-grade must not overwrite the FIRST verdict with the second.
    if (i.closedAsOriginal == null) i.closedAsOriginal = from;
    i.closedAs = to;
    i.regradeCount = (i.regradeCount || 0) + 1;
  }, 'issue-regraded', { from, to, why: String(why || ''), evidence: evText, by }, at);
}

// ── who the defect belongs to ─────────────────────────────────────────────────────────────────
//
// instrument = commitwork's own bug · upstream = the scanner's · subject = a real finding about the
// scanned code · undetermined = nobody has established which, which is the common and correct state.
//
// fact: this classification is the whole ecosystem claim, and the party making it is the party being measured / it is recorded as a JUDGEMENT with its basis and author, never as a derived fact, so a reader can see who decided and on what (expiry: never, prev: missing)
// fact: `basis` distinguishes a COMMIT LOOKUP from an OPINION / where a refuted finding was closed because commitwork shipped a fix, that fix has a sha and the classification is derivable rather than judged (expiry: never, prev: unknown)
export const DEFECT_OWNERS = Object.freeze(['instrument', 'upstream', 'subject', 'undetermined']);

export function classifyDefect(doc, id, { owner, basis, evidence, by = null, at }) {
  if (!DEFECT_OWNERS.includes(owner)) throw new Error(`defectOwner must be one of ${DEFECT_OWNERS.join('|')}`);
  if (!basis || !['commit', 'adjudication', 'model-agreement'].includes(basis)) {
    throw new Error("classify requires basis: 'commit' (derived from a sha), 'adjudication' (a human judged it) or 'model-agreement'");
  }
  const evText = evidenceText(evidence);
  if (!evText) throw new Error('classify requires evidence');
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  const from = iss.defectOwner || null;
  return mutateIssue(doc, id, (i) => {
    i.defectOwner = owner;
    i.defectBasis = basis;
    // Append-only history of the classification itself: a changed mind leaves a trace in the record,
    // not only in the chain, so a rate computed from these can state how many were revised.
    i.classifyCount = (i.classifyCount || 0) + 1;
  }, 'issue-classified', { from, to: owner, basis, evidence: evText, by }, at);
}

// ── lodging a fix (a claim, never a close) ────────────────────────────────────────────────────
// Records fix type + annotation. Never touches state/closedAs/suspect/evidence/claim — issues
// close on scan evidence or explicit close, never a form. Re-lodging replaces `fix`; history
// stays in the event log.
export function lodgeFix(doc, id, { fixType, notes, who, at, dispositionId = null }) {
  const iss = doc.issues[id];
  if (!iss) throw new Error(`unknown issue ${id}`);
  if (!FIX_TYPES.includes(fixType)) throw new Error(`fixType must be one of ${FIX_TYPES.join('|')}`);
  const text = String(notes ?? '');
  if (text.length < FIX_NOTES_MIN || text.length > FIX_NOTES_MAX) {
    throw new Error(`notes must be ${FIX_NOTES_MIN}..${FIX_NOTES_MAX} characters (got ${text.length}) — a lodging without reasoning is a checkbox, not a record`);
  }
  if (!FIX_NOTES_RE.test(text)) throw new Error('notes contain a control character; only printable text is accepted');
  if (!who || !String(who).trim()) throw new Error('lodgeFix requires `who` — an unattributed lodging is worth exactly the identity behind it');
  // `at` is caller-supplied on every mutator (clock-injected, CW_NOW-deterministic).
  if (!at || typeof at !== 'string') throw new Error('lodgeFix requires `at` (ISO instant) — the store never reads the clock for a caller');
  if (dispositionId !== null && !/^DSP-[0-9a-f]{12}$/.test(String(dispositionId))) {
    throw new Error(`dispositionId ${JSON.stringify(dispositionId)} is not a DSP- id`);
  }
  return mutateIssue(doc, id, (i) => {
    i.fix = { fixType, notes: text, who: String(who), at, dispositionId };
  }, 'fix-authored', remediationEventData(iss, {
    evidence: { note: text, who: String(who) },
    data: { fix: { fixType, notes: text, who: String(who), dispositionId } },
  }), at);
}

export function linkIssues(doc, id, { blocks = null, duplicateOf = null, supersedes = null, at }) {
  const need = (x) => { if (x && !doc.issues[x]) throw new Error(`unknown issue ${x}`); };
  need(blocks); need(duplicateOf); need(supersedes);
  if (blocks) {
    // `A --blocks B` records A into B's blockedBy; reject cycles.
    const reaches = (from, to, seen = new Set()) => {
      if (from === to) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return (doc.issues[from]?.deps.blockedBy || []).some((b) => reaches(b, to, seen));
    };
    if (reaches(id, blocks, new Set())) throw new Error(`link would create a dependency cycle between ${id} and ${blocks}`);
    mutateIssue(doc, blocks, (i) => {
      if (!i.deps.blockedBy.includes(id)) i.deps.blockedBy.push(id);
    }, 'issue-linked', { blockedBy: id }, at);
  }
  if (duplicateOf) {
    mutateIssue(doc, id, (i) => {
      i.deps.duplicateOf = duplicateOf;
      i.state = 'closed';
      i.closedAs = 'superseded';
      i.claim = null;
      i.evidence.push({ at, tier: 'manual', detail: `duplicate of ${duplicateOf}` });
    }, 'issue-closed', { closedAs: 'superseded', duplicateOf }, at);
  }
  if (supersedes) {
    mutateIssue(doc, supersedes, (i) => {
      i.deps.supersededBy = id;
      i.state = 'closed';
      i.closedAs = 'superseded';
      i.claim = null;
      i.evidence.push({ at, tier: 'manual', detail: `superseded by ${id}` });
    }, 'issue-closed', { closedAs: 'superseded', supersededBy: id }, at);
  }
}

// ── ready-work detection (derived, never stored) ──────────────────────────────────────────────
export function readyIssues(doc, { area = null, now, limit = Infinity, includeAuthority = false } = {}) {
  const ready = Object.values(doc.issues).filter((i) => {
    if (i.state !== 'open') return false;
    if (area && i.area !== area) return false;
    if (!includeAuthority && i.authorityRequired) return false;
    if (i.waiver && new Date(i.waiver.expiresAt || '9999-12-31').getTime() > new Date(now).getTime()) return false;
    if ((i.deps.blockedBy || []).some((b) => doc.issues[b] && doc.issues[b].state !== 'closed')) return false;
    return true;
  });
  ready.sort((a, b) =>
    (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0)
    || a.slaDueAt.localeCompare(b.slaDueAt)
    || a.id.localeCompare(b.id));
  return Number.isFinite(limit) ? ready.slice(0, limit) : ready;
}

// ── gc (expired claims back to the pool, expired waivers surfaced) ────────────────────────────
export function gcIssues(doc, { at }) {
  const expiredClaims = [];
  const expiredWaivers = [];
  for (const iss of Object.values(doc.issues)) {
    if (iss.state === 'claimed' && claimExpired(iss.claim, at)) {
      iss.state = 'open';
      iss.claim = null;
      iss.updatedAt = at;
      expiredClaims.push(iss.id);
    }
    if (iss.waiver && iss.waiver.expiresAt && new Date(iss.waiver.expiresAt).getTime() <= new Date(at).getTime()) {
      iss.waiver = null;
      iss.updatedAt = at;
      expiredWaivers.push(iss.id);
    }
  }
  if (expiredClaims.length || expiredWaivers.length) {
    // 'gc' sentinel, not an ISS id — ISS-000000 is a real issue.
    appendIssueEvent(doc, 'issue-gc', 'gc', { expiredClaims, expiredWaivers }, at);
  }
  return { expiredClaims, expiredWaivers };
}

// ── ingest + auto-close ───────────────────────────────────────────────────────────────────────
// A4: titles compose from structured fields only; scanner message text never reaches a title.
export const titleForFinding = (f) => `${f.package || f.id}${f.version ? '@' + f.version : ''} ${f.id} (${f.repo})`;
export const titleForGroup = (repo, pkg, n) => `${pkg} (${repo}) — ${n} finding${n === 1 ? '' : 's'}`;
// Use the category's declared identity when rule is absent — never interpolate undefined.
export const titleForScannerRow = (row, category) => {
  if (present(row.rule)) return `${row.rule} [${category}] (${row.repo})`;
  const fields = identityFor(category) || [];
  const label = fields.map((f) => row[f]).filter(present).join(' · ');
  return `${label || '(unnamed rule)'} [${category}] (${row.repo})`;
};

const present = (v) => v !== undefined && v !== null && v !== '';

// Fall back to the category's declared identity (ROW_SCHEMAS) only when rule/file are entirely
// absent — a key that currently discriminates must not move.
//
// UNLESS THE LANE SAYS rule|file IS WRONG FOR IT. A category that sets `identityIsKey` in its row
// schema is stating that rule|file does not identify its findings: sastCobol's cobolwork lane can
// emit two findings of one rule in one program, which rule|file collapses into a single issue.
// Such a lane keys on its declared identity when the row carries EVERY field of it, and falls back
// to rule|file when it does not — an artifact written before the field existed still keys the old
// way rather than becoming unkeyable.
//
// OPT-IN, NOT INFERRED, and the measurement is the reason: 22 of the categories in ROW_SCHEMAS
// declare an identity their rows carry in full (2026-09-24 — depsJvm, cspm, dast, stubs and 18
// more), and all of them are keyed rule|file today. Preferring a declared identity wherever it
// happened to be present would re-key every one of them on the next sweep, closing each open
// issue as FIXED beside a freshly minted duplicate. One lane at a time, argued in its schema.
export function scannerIdentityParts(row, category) {
  // D12: identity is line-free; the line lives on anchor/anchorHistory. Same tuple as identityFor().
  const declared = identityIsKey(category) ? (identityFor(category) || []) : [];
  if (declared.length && declared.every((f) => present(row[f]))) {
    return { parts: declared.map((f) => `${f}=${row[f]}`), from: `identity(${declared.join(',')})` };
  }
  if (present(row.rule) || present(row.file)) {
    return { parts: [row.rule, row.file], from: 'rule-file' };
  }
  const fields = identityFor(category) || [];
  const vals = fields.filter((f) => present(row[f])).map((f) => `${f}=${row[f]}`);
  if (vals.length) return { parts: vals, from: `identity(${fields.join(',')})` };
  return { parts: [], from: 'none' };
}

// Degenerate: every discriminator is the literal string "undefined". Legacy keys of this shape
// persist in the store; migrated on contact (migrateDegenerateKeys), never silently rewritten.
export function isDegenerateKey(key) {
  const s = String(key || '');
  if (!s.startsWith('sc:')) return false;
  const parts = s.split('|').slice(2);
  return parts.length > 0 && parts.every((p) => p === 'undefined');
}

// Re-point legacy degenerate-keyed issues onto the corrected key, on contact, append-only.
// 1:1 pairings only — ambiguity is reported, never guessed. Old key kept in priorKeys; the
// migration event goes into the hash chain.
export function migrateDegenerateKeys(doc, newKeys, { at, dryRun = false } = {}) {
  const migrated = [], ambiguous = [];
  const legacy = new Map();     // "repo|category" -> [issue]
  for (const iss of Object.values(doc.issues)) {
    const k = iss.source?.key;
    if (!isDegenerateKey(k) || iss.state === 'closed') continue;
    const [repo, category] = String(k).slice(3).split('|');
    const bucket = `${repo}|${category}`;
    if (!legacy.has(bucket)) legacy.set(bucket, []);
    legacy.get(bucket).push(iss);
  }
  const fresh = new Map();      // "repo|category" -> [newKey]
  for (const k of newKeys || []) {
    if (!String(k).startsWith('sc:') || isDegenerateKey(k) || doc.byKey[k]) continue;
    const [repo, category] = String(k).slice(3).split('|');
    const bucket = `${repo}|${category}`;
    if (!fresh.has(bucket)) fresh.set(bucket, []);
    fresh.get(bucket).push(k);
  }
  for (const [bucket, olds] of legacy) {
    const news = fresh.get(bucket) || [];
    if (olds.length !== 1 || news.length !== 1) {
      if (news.length) ambiguous.push({ bucket, legacy: olds.length, candidates: news.length });
      continue;
    }
    const iss = olds[0], to = news[0], from = iss.source.key;
    migrated.push({ id: iss.id, from, to });
    if (dryRun) continue;
    iss.priorKeys = [...(iss.priorKeys || []), from];
    iss.source = { ...iss.source, key: to };
    if (doc.byKey[from] === iss.id) delete doc.byKey[from];
    doc.byKey[to] = iss.id;
    appendIssueEvent(doc, 'issue-key-migrated', iss.id, { from, to, why: 'degenerate key: every discriminator was the literal string "undefined"' }, at);
  }
  return { migrated, ambiguous };
}
// The key a row WOULD have had under rule|file, for a lane that has since taken an identityIsKey
// identity. Recomputed from the row rather than remembered, so the migration below needs nothing
// stored about the old scheme.
const legacyRuleFileKey = (row, category) => (present(row.rule) || present(row.file)
  ? `sc:${row.repo}|${category}|${[row.rule, row.file].join('|')}`
  : null);

/**
 * Adopt a lane's existing rule|file issues onto its declared identity, on contact, append-only.
 *
 * The same job migrateLineKeys does for D12 and for the same reason: run before filing, or the
 * rule|file record auto-closes as FIXED beside the freshly minted identity-keyed row that replaced
 * it — a fix nobody made, which is the failure this store is arranged against.
 *
 * It is the INVERSE of migrateLineKeys' collapse. One rule|file key can split into several
 * fingerprints — that split is the bug being fixed, two findings that were one issue — so one
 * issue keeps its id, history and anchor, and the rest are born as the new findings they always
 * were. Nothing is closed, so nothing is reported fixed. The kept one is the lowest key in sort
 * order: a deterministic choice, NOT a claim that it is the same finding as the original.
 */
export function migrateIdentityKeys(doc, openRows, { at, dryRun = false } = {}) {
  const adopted = [], split = [];
  const byLegacy = new Map();
  for (const [key, entry] of openRows || []) {
    const { row, category } = entry || {};
    if (!row || !identityIsKey(category)) continue;
    const legacy = legacyRuleFileKey(row, category);
    if (!legacy || legacy === key) continue;
    if (!byLegacy.has(legacy)) byLegacy.set(legacy, []);
    byLegacy.get(legacy).push(key);
  }
  for (const [legacy, targets] of byLegacy) {
    const iss = doc.issues[doc.byKey[legacy]];
    if (!iss || iss.state === 'closed') continue;
    const free = [...new Set(targets)].filter((t) => !doc.byKey[t]).sort();
    if (!free.length) continue;
    const to = free[0], born = free.slice(1);
    adopted.push({ id: iss.id, from: legacy, to });
    if (born.length) split.push({ id: iss.id, from: legacy, kept: to, born });
    if (dryRun) continue;
    iss.priorKeys = [...new Set([...(iss.priorKeys || []), legacy])];
    iss.source = { ...iss.source, key: to };
    if (doc.byKey[legacy] === iss.id) delete doc.byKey[legacy];
    doc.byKey[to] = iss.id;
    iss.updatedAt = at;
    appendIssueEvent(doc, 'issue-key-migrated', iss.id,
      { from: legacy, to, why: `the lane's declared identity now keys it (identityIsKey)`,
        ...(born.length ? { splitInto: [to, ...born] } : {}) }, at);
  }
  return { adopted, split };
}

// The same key without the line — a finding's identity when code moves under it.
export const scannerPlaceKey = (skey) => String(skey).split('|').slice(0, 4).join('|');
const scannerGroupSourceKey = (repo, category, rule) => `gs:${repo}|${category}|${rule}`;

// The discriminator a group key carries: the rule when the scanner names one, else the category's
// identity tuple as `f=v,f=v` (rule-less scanners key on identity — retire.js on component/id),
// else the literal 'undefined' — FROZEN for genuinely unkeyable rows so their keys do not move.
// '|' would corrupt key parsing and ',' the label; both become '/'. Exported so the migration
// (bin/issue-rekey-depsretire.mjs) derives targets with the SAME function the mint uses.
const groupLabelVal = (v) => String(v).replace(/[|,]/g, '/');
export function scannerGroupKeyFor(row, category) {
  if (present(row.rule)) return scannerGroupSourceKey(row.repo, category, row.rule);
  const fields = identityFor(category) || [];
  if (fields.length && fields.every((f) => present(row[f]))) {
    return scannerGroupSourceKey(row.repo, category,
      fields.map((f) => `${f}=${groupLabelVal(row[f])}`).join(','));
  }
  return scannerGroupSourceKey(row.repo, category, undefined);
}

// Per-category grouping to one issue per (repo, category, rule). Sticky both ways — an identity
// that flips with row count would mint duplicates.
export const GROUPED_CATEGORIES = () => new Set(
  (process.env.CW_ISSUE_GROUP_CATEGORIES || 'secretsHistory').split(',').map((s) => s.trim()).filter(Boolean));
export const GROUP_THRESHOLD = () => +(process.env.CW_ISSUE_GROUP_THRESHOLD || 5);
// '(unnamed rule)' rather than "undefined" for scanners that never name rules.
export const titleForScannerGroup = (repo, category, rule, n) => `${rule ?? '(unnamed rule)'} [${category}] (${repo}) — ${n} hit${n === 1 ? '' : 's'}`;

// ── anchor history (D12) ─────────────────────────────────────────────────────────────────────
// The line is a secondary reference that may always be stale; identity lives in source.key.
// Bounded: keep the first entry + most recent ANCHOR_HISTORY_MAX - 1; drops stated in `why`.
export const ANCHOR_HISTORY_MAX = 12;

export function recordAnchor(iss, next, { at, sliceId = null, why = 'observed' }) {
  if (!next || !Number.isInteger(next.line)) return false;
  const prev = iss.anchor;
  iss.anchor = next;
  // Unchanged position and content is not movement.
  if (prev && prev.file === next.file && prev.line === next.line && prev.hash === next.hash) return false;
  const hist = Array.isArray(iss.anchorHistory) ? iss.anchorHistory : [];
  // Seed from the previous anchor when history is empty — really observed, never invented.
  if (!hist.length && prev && Number.isInteger(prev.line)) {
    hist.push({ at, sliceId, file: prev.file, line: prev.line, hash: prev.hash ?? null, why: 'first recorded position (seeded from the live anchor)' });
  }
  hist.push({ at, sliceId, file: next.file, line: next.line, hash: next.hash ?? null, why });
  if (hist.length > ANCHOR_HISTORY_MAX) {
    const dropped = hist.length - ANCHOR_HISTORY_MAX;
    const kept = [hist[0], ...hist.slice(-(ANCHOR_HISTORY_MAX - 1))];
    kept[1] = { ...kept[1], why: `${kept[1].why} · ${dropped} earlier position(s) dropped at the ${ANCHOR_HISTORY_MAX}-entry cap` };
    iss.anchorHistory = kept;
  } else {
    iss.anchorHistory = hist;
  }
  return true;
}

/**
 * Record a scanner-annotation waiver on an issue, or clear a stale one.
 *
 * Mirrors the dependency `waiverAnn` path deliberately, including its restraint: a matching
 * annotation sets `iss.waiver` and changes nothing else. It does NOT close, because a suppression
 * is not evidence of repair and the auto-close table is evidence-gated for reasons this repository
 * has already paid for once.
 *
 * The CLEARING half matters as much as the setting half. An annotation that expires, or is edited
 * so it no longer matches, must take its waiver with it — otherwise the first adjudication is
 * permanent and the expiry date is decoration, which is the `E2 suppression outliving its
 * judgement` class the taxonomy already names and pattern-scan already has a detector for.
 */

/**
 * Ingest one area's rollup into the store: file new issues, refresh existing ones, run the
 * evidence-gated auto-close table, reopen recurrences. Mutates `doc`; caller holds the lock and
 * saves. Returns a summary whose `status` is honest about WHY nothing happened:
 *   'ok' | 'stale-rollup' | 'not-newer' | 'no-rollup'
 */

// Queue-entry ingestion (evaluations/<cycle>/queue.json, disposition open) — these are human-
// verified audit findings; they are never auto-closed.
//
// Keyed on the entry's id alone. q.anchor is `file:line`, so a key carrying it filed a re-anchored
// entry as a new issue. The id is q-<sha8(file + summary)> (bin/reconcile-findings.mjs ID_RULE):
// line-free and never positional. An entry without one is UNKEYABLE and reported, never filed
// under `q:undefined`, where every id-less entry would collide into one issue.
const QUEUE_ID = /^q-[0-9a-f]{8}(?:-\d+)?$/;
export function ingestQueue(doc, { queue, area, now, dryRun = false }) {
  const summary = { status: 'ok', created: [], skipped: 0, unkeyable: [], unclassified: [] };
  const entries = queue?.queue || [];
  for (const q of entries) {
    if (q.disposition !== 'open') { summary.skipped += 1; continue; }
    if (typeof q.id !== 'string' || !QUEUE_ID.test(q.id)) {
      summary.unkeyable.push(`${q.id ?? '(no id)'} at ${q.anchor ?? '(no anchor)'}`);
      continue;
    }
    const key = `q:${q.id}`;
    if (doc.byKey[key]) { summary.skipped += 1; continue; }
    // Refused per entry rather than thrown, so one unmappable kind does not hold back the rest.
    const { cls, why } = classForQueueEntry(q);
    if (!cls) { summary.unclassified.push(`${q.id}: ${why}`); continue; }
    if (dryRun) { summary.created.push(`(dry) ${key}`); continue; }
    const { id } = mintIssue(doc, {
      area: (q.provenance?.areas?.[0]) || area || 'commitwork',
      repo: null, kind: 'code', severity: normaliseSeverity(q.severity),
      class: cls,
      title: `${q.kind}: ${q.anchor}`, body: q.summary ?? null, remediation: q.remediation ?? null,
      source: { kind: 'queue', key, tool: null, rule: q.kind ?? null },
      anchor: q.file && q.line ? { file: q.file, line: q.line, hash: null } : null,
    }, now);
    summary.created.push(id);
  }
  if (summary.unkeyable.length) summary.status = 'unkeyable';
  else if (summary.unclassified.length) summary.status = 'unclassified';
  return summary;
}

// ── panel rows (the ONLY shape the panel may serve — field-whitelisted at the producer, A4) ──
export function panelRows(doc, { now }) {
  const rows = [];
  for (const iss of Object.values(doc.issues)) {
    if (iss.state === 'closed') continue;
    const src = iss.source || {};
    // panel-safe title: structured identifiers only, never body/message text, never file paths
    const title = (src.kind === 'scanner-row')
      ? `${src.rule || 'rule'} [${src.tool || '?'}] (${iss.repo || '?'})`
      : String(iss.title || '').slice(0, 120);
    rows.push({
      id: iss.id,
      area: iss.area,
      kind: iss.kind,
      severity: iss.severity,
      state: iss.state,
      ageDays: Math.floor((new Date(now).getTime() - new Date(iss.createdAt).getTime()) / 86_400_000),
      slaBreached: new Date(now).getTime() > new Date(iss.slaDueAt).getTime(),
      title: title.slice(0, 120),
    });
  }
  rows.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) || a.id.localeCompare(b.id));
  return rows;
}
