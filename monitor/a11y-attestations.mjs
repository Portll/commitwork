// monitor/a11y-attestations.mjs — the human half of the WCAG audit: records a person's verdict on
// criteria bin/a11y-scan.mjs cannot decide. Unsigned attestations are refused; every record binds
// to the report's content digest; attested ≠ scanner-passed and machine-attributed clears nothing.
// Append-only — withdrawal is an append, never a deletion.

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeJSONAtomic, stableStringify } from '../cra/lib.mjs';
import { validateAgainstSchema, SLUG_RE } from './registry.mjs';
import { acquireLock } from './lockfile.mjs';
import { sessionWho, classifyWho } from './attribution.mjs';
import { CRITERIA } from '../bin/a11y-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// ── vocabulary ───────────────────────────────────────────────────────────────────────────────────
// What a person can conclude — a checkbox that could only say "passes" records only good news.
export const VERDICTS = Object.freeze(['meets', 'fails', 'not-applicable']);

/** The only verdict that can turn an `unchecked` criterion into something a claim may rest on. */
const CLEARING_VERDICTS = Object.freeze(['meets', 'not-applicable']);

export const ACTIONS = Object.freeze(['attest', 'withdraw']);

/** The transports. Only `http` (the panel, holding a real login) can ever yield a human `who`. */
export const CHANNELS = Object.freeze(['http', 'mcp', 'cli']);
const AGENT_CHANNELS = new Set(['mcp', 'cli']);

// Closed set of attestable criteria: exactly the scanner's `static:false` set, derived never copied.
export function attestableCriteria() {
  return new Set(CRITERIA.filter((c) => c.static === false).map((c) => c.id));
}

// ── refusal codes (the adapters map these to transport-shaped errors; the set is closed) ─────────
export const REFUSALS = Object.freeze({
  NO_IDENTITY: 'no-identity',
  BAD_IDENTITY: 'bad-identity',
  BAD_CHANNEL: 'bad-channel',
  BAD_AREA: 'bad-area',
  SCHEMA: 'schema',
  NOT_ATTESTABLE: 'not-attestable',
  NOT_UNCHECKED: 'not-unchecked',
  NO_SUBJECT: 'no-subject',
  STALE_SUBJECT: 'stale-subject',
  BAD_EXPIRY: 'bad-expiry',
  NOTHING_TO_WITHDRAW: 'nothing-to-withdraw',
});

// ── clock / paths (every input CW_*-overridable) ─────────────────────────────────────────────────
export { nowISO };
export const attestationsPath = () => (process.env.CW_A11Y_ATTESTATIONS
  ? resolve(process.env.CW_A11Y_ATTESTATIONS)
  : join(ROOT, 'monitor', 'a11y-attestations.json'));
export const attestationSchemaPath = () => (process.env.CW_A11Y_ATTESTATION_SCHEMA
  ? resolve(process.env.CW_A11Y_ATTESTATION_SCHEMA)
  : join(ROOT, 'schema', 'a11y-attestation.schema.json'));

// TTL is about the CHECK ageing (browsers/AT change), not the page moving — the digest covers that.
export const ATTESTATION_TTL_DAYS = () => +(process.env.CW_A11Y_ATTESTATION_TTL_DAYS || 180);
/** The longest an attestation may be asked to live. Beyond this it is a permanent pass in disguise. */
export const ATTESTATION_MAX_TTL_DAYS = () => +(process.env.CW_A11Y_ATTESTATION_MAX_TTL_DAYS || 365);

// ── identity bound at the door ───────────────────────────────────────────────────────────────────
// Same rule as ingest-external's WHO_RE: no control characters, hard length cap, linear regex.
const WHO_RE = /^[^\u0000-\u001f\u007f]{1,200}$/;

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

// ── the store ────────────────────────────────────────────────────────────────────────────────────
export function emptyAttestationsDoc() {
  return {
    note: 'commitwork WCAG ATTESTATIONS — a person recording that they manually verified a success '
        + 'criterion bin/a11y-scan.mjs cannot decide. APPEND-ONLY: a withdrawal is a new entry, '
        + 'never a deletion. Every entry is bound to the content digest of the pages checked and '
        + 'stops being in force when that digest moves. An attestation is NOT a scanner pass. '
        + 'Written by monitor/a11y-attestations.mjs; never edit by hand.',
    version: 1,
    entries: [],
  };
}

// Fail closed: only ENOENT is absence. Throws; the caller answers 503.
export function loadAttestations({ path = attestationsPath() } = {}) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return emptyAttestationsDoc();
    throw new Error(`a11y attestation store at ${path} is unreadable (${e.code}); refusing to treat it as empty`);
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error(`a11y attestation store at ${path} is not valid JSON (${e.message}); refusing to treat it as empty`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.entries)) {
    throw new Error(`a11y attestation store at ${path} is not an attestation document; refusing to treat it as empty`);
  }
  // One malformed entry fails the whole store; structural check only — values are the writer's business.
  for (const [i, e] of doc.entries.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.criterion !== 'string'
        || typeof e.area !== 'string' || typeof e.who !== 'string' || typeof e.at !== 'string'
        || !ACTIONS.includes(e.action)) {
      throw new Error(`a11y attestation store at ${path}: entry ${i} is malformed; refusing to serve a partial store as a whole one`);
    }
  }
  return doc;
}

// Store paths this process holds the lock for; module-level so every importer shares one instance.
const heldStores = new Set();

/** Does THIS process hold the attestation lock for `path`? For gates and tests. */
export const holdsAttestationsLock = (path = attestationsPath()) => heldStores.has(resolve(path));

export function saveAttestations(doc, { path = attestationsPath() } = {}) {
  const target = resolve(path);
  // Fail closed: atomic prevents a TORN file, not a LOST one — a concurrent writer's document
  // simply replaces yours, and an attestation is a conformance claim someone will cite.
  if (!heldStores.has(target)) {
    throw new Error(
      `refusing to save the a11y attestation store at ${target} without its lock — wrap the `
      + 'load/mutate/save in withAttestationsLock().',
    );
  }
  writeJSONAtomic(target, doc);
  return target;
}

/** Serialise writers, exactly as withIssuesLock does — two panels attesting at once is normal. */
export function withAttestationsLock(fn, { path = attestationsPath() } = {}) {
  const target = resolve(path);
  const held = acquireLock(`${path}.lock`, {
    staleMs: 30_000, label: 'a11y-attestations', attempts: 50, spinMs: 20,
    onStale: (ageMs) => console.warn(`[a11y] breaking a stale attestation lock (${Math.round(ageMs / 1000)}s old)`),
  });
  if (!held.ok) throw new Error(`a11y attestation store is locked by another process (${path}.lock); try again`);
  heldStores.add(target);
  // Deregister before release so saveAttestations never believes a handed-on lock is held.
  try { return fn(); } finally { heldStores.delete(target); held.release(); }
}

// ── lifecycle ────────────────────────────────────────────────────────────────────────────────────
/** The store key. Area-scoped: a ruling about one area's pages is not a ruling about another's. */
export const keyOf = (area, criterion) => `${area}|${criterion}`;

// Newest entry for one area+criterion, or null. Newest wins; a withdraw supersedes.
export function latestEntry(doc, area, criterion) {
  const list = Array.isArray(doc?.entries) ? doc.entries : [];
  const k = keyOf(area, criterion);
  for (let i = list.length - 1; i >= 0; i--) if (keyOf(list[i].area, list[i].criterion) === k) return list[i];
  return null;
}

// Five states, never a boolean: 'active' | 'withdrawn' | 'expired' | 'stale-subject' |
// 'unverifiable' (digest unknown — not in force). Only 'active' ever clears anything.
export function attestationStatus(e, { now, currentDigest = null } = {}) {
  if (!e) return 'withdrawn';
  if (e.action === 'withdraw') return 'withdrawn';
  if (!currentDigest) return 'unverifiable';
  if (e.subjectDigest !== currentDigest) return 'stale-subject';
  if (e.expires && new Date(e.expires).getTime() <= new Date(now).getTime()) return 'expired';
  return 'active';
}

// Keeps the two greens apart: scanner states pass through verbatim and always win; a human-
// attributed active attestation maps to attested-pass / attested-n/a / attested-fail; a
// machine-attributed one clears nothing.
export function attestedState(scannerState, e, { now, currentDigest = null } = {}) {
  if (scannerState !== 'unchecked') return scannerState;
  if (!e) return 'unchecked';
  if (attestationStatus(e, { now, currentDigest }) !== 'active') return 'unchecked';
  if (e.whoKind !== 'human') return 'unchecked';
  if (e.verdict === 'fails') return 'attested-fail';
  if (e.verdict === 'not-applicable') return 'attested-n/a';
  return 'attested-pass';
}

/** The states that count as met for a conformance claim, human layer included. */
const MET_STATES = new Set(['pass', 'n/a', 'attested-pass', 'attested-n/a']);
const FAILED_STATES = new Set(['fail', 'attested-fail']);

// ── the write ────────────────────────────────────────────────────────────────────────────────────
/**
 * Record ONE attestation, or withdraw the standing one.
 *   recordAttestation(doc, payload, { report, area, session, now, channel })
 *   `doc` is caller-loaded under withAttestationsLock, mutated only on success. `payload` is
 *   untrusted. `report` is the authority on the digest and on whether the criterion is undecided.
 *   -> { ok:true, entry } | { ok:false, refused:<REFUSALS code>, errors:[…] }
 */
export function recordAttestation(doc, payload, {
  report = null,
  area = '',
  session = null,
  now = nowISO(),
  channel = 'http',
  schemaPath = attestationSchemaPath(),
} = {}) {
  const refuse = (refused, errors) => ({ ok: false, refused, errors });

  if (!CHANNELS.includes(channel)) return refuse(REFUSALS.BAD_CHANNEL, [`channel must be one of ${CHANNELS.join('|')}`]);

  // 1. Identity first — a well-formed anonymous attestation is exactly what must not be filed.
  const who = sessionWho(session);
  if (!who) {
    return refuse(REFUSALS.NO_IDENTITY, [
      'no resolvable identity — an attestation is worth exactly the identity behind it, and an '
      + 'unsigned one launders a machine assertion into the record as though a person had made it. '
      + 'Sign in to the panel; there is no anonymous attestation.',
    ]);
  }
  if (!WHO_RE.test(who)) return refuse(REFUSALS.BAD_IDENTITY, ['identity contains control characters or exceeds 200 chars']);
  // A channel without an authenticated human session can never yield a human attribution.
  const whoKind = AGENT_CHANNELS.has(channel) ? 'machine' : classifyWho(who);

  // 2. Area — the attestation names what it is about, or it is not filed.
  const slug = String(area || '');
  if (!SLUG_RE.test(slug)) return refuse(REFUSALS.BAD_AREA, ['no resolvable area — an attestation must name the pages it is about']);

  // 3. Schema — untrusted bytes; no best-effort branch.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return refuse(REFUSALS.SCHEMA, ['payload must be a JSON object']);
  const { errors } = validateAgainstSchema(payload, { path: schemaPath });
  if (errors.length) return refuse(REFUSALS.SCHEMA, errors);
  const action = payload.action || 'attest';

  // 4. Criterion — the closed derived set, never the caller's string.
  const attestable = attestableCriteria();
  if (!attestable.has(payload.criterion)) {
    return refuse(REFUSALS.NOT_ATTESTABLE, [
      `${String(payload.criterion).slice(0, 32)} is not a criterion this scanner leaves undecided. `
      + `Attestable: ${[...attestable].sort().join(', ')}. A criterion the scanner measures is not `
      + 'one a person overrides.',
    ]);
  }
  const criterion = [...attestable].find((c) => c === payload.criterion);

  // 5. Withdrawal — an append, never a delete, and only when something is standing.
  if (action === 'withdraw') {
    const standing = latestEntry(doc, slug, criterion);
    if (!standing || standing.action === 'withdraw') {
      return refuse(REFUSALS.NOTHING_TO_WITHDRAW, [`no standing attestation for ${criterion} in ${slug}`]);
    }
    const entry = newEntry({
      doc, action: 'withdraw', area: slug, criterion, verdict: null, note: payload.note || null,
      who, whoKind, channel, now, expires: null, subjectDigest: standing.subjectDigest,
      supersedes: standing.id,
    });
    doc.entries.push(entry);
    return { ok: true, entry };
  }

  // 6. Subject — the digest comes from the artifact, never from the caller.
  const currentDigest = reportDigest(report);
  if (!currentDigest) {
    return refuse(REFUSALS.NO_SUBJECT, [
      'this area has no a11y artifact carrying a content digest, so there is nothing to bind an '
      + 'attestation to. Run the a11y-wcag check first: an attestation against unknown content is '
      + 'unverifiable, and unverifiable is not evidence.',
    ]);
  }
  // Optimistic-concurrency pin (ETag shape): a moved subject is refused, not mis-attached.
  if (payload.subjectDigest && payload.subjectDigest !== currentDigest) {
    return refuse(REFUSALS.STALE_SUBJECT, [
      `the pages moved since you read them (pinned ${payload.subjectDigest.slice(0, 23)}…, now ${currentDigest.slice(0, 23)}…). `
      + 'Re-check what is there now — a verification of the previous build is not a verification of this one.',
    ]);
  }

  // 7. Still undecided? The scanner is the authority on its own reach.
  const row = criterionRow(report, criterion);
  if (!row) return refuse(REFUSALS.NOT_UNCHECKED, [`${criterion} is not in this area's audit`]);
  if (row.state !== 'unchecked') {
    return refuse(REFUSALS.NOT_UNCHECKED, [
      `${criterion} is '${row.state}' in the current audit — the scanner decided it. An attestation `
      + 'may only stand where the scanner reports `unchecked`.',
    ]);
  }

  // 8. Expiry — nothing stands forever without saying so.
  const nowMs = new Date(now).getTime();
  let expires;
  if (payload.expires) {
    const t = new Date(payload.expires).getTime();
    if (!Number.isFinite(t)) return refuse(REFUSALS.BAD_EXPIRY, ['expires is not a parseable instant']);
    if (t <= nowMs) return refuse(REFUSALS.BAD_EXPIRY, ['expires is in the past — an already-expired attestation is a no-op wearing an attestation\'s clothes']);
    if (t > nowMs + ATTESTATION_MAX_TTL_DAYS() * 86_400_000) {
      return refuse(REFUSALS.BAD_EXPIRY, [`expires is more than ${ATTESTATION_MAX_TTL_DAYS()} days out; a verification that outlives the memory of doing it is a permanent pass in disguise`]);
    }
    expires = new Date(t).toISOString();
  } else {
    expires = new Date(nowMs + ATTESTATION_TTL_DAYS() * 86_400_000).toISOString();
  }

  // ── everything below this line WRITES ──────────────────────────────────────────────────────────
  const standing = latestEntry(doc, slug, criterion);
  const entry = newEntry({
    doc, action: 'attest', area: slug, criterion, verdict: payload.verdict, note: payload.note || null,
    who, whoKind, channel, now, expires, subjectDigest: currentDigest,
    supersedes: standing ? standing.id : null,
  });
  doc.entries.push(entry);
  return { ok: true, entry };
}

function newEntry({ doc, action, area, criterion, verdict, note, who, whoKind, channel, now, expires, subjectDigest, supersedes }) {
  const seq = doc.entries.length;
  const id = 'ATT-' + sha256hex(stableStringify({ seq, area, criterion, at: now, who, action, verdict })).slice(0, 12);
  return {
    id,
    action,
    area,
    criterion,
    verdict,
    // Operator-authored free text; must still be escaped at the HTML sink.
    note: note ? String(note).slice(0, 2000) : null,
    who,
    whoKind,
    channel,
    at: now,
    expires,
    // What was attested to — without this the record is a signature on nothing in particular.
    subjectDigest,
    supersedes: supersedes || null,
  };
}

// ── reading the artifact ─────────────────────────────────────────────────────────────────────────
/** The content digest an a11y artifact carries, or null. Null is "unknown", never "unchanged". */
export function reportDigest(report) {
  const d = report && report.subject && report.subject.digest;
  return (typeof d === 'string' && /^sha256:[0-9a-f]{64}$/.test(d)) ? d : null;
}

function criterionRow(report, id) {
  const rows = (report && Array.isArray(report.criteria)) ? report.criteria : [];
  return rows.find((r) => r && r.id === id) || null;
}

// ── the view the panel consumes ──────────────────────────────────────────────────────────────────
// Structured fields and the operator's own note only.
export function attestationView(e, { now, currentDigest = null, scannerState = 'unchecked' } = {}) {
  if (!e) return null;
  const status = attestationStatus(e, { now, currentDigest });
  return {
    id: e.id,
    action: e.action,
    verdict: e.verdict,
    who: e.who,
    whoKind: e.whoKind,
    channel: e.channel,
    at: e.at,
    expires: e.expires,
    note: e.note ? String(e.note).slice(0, 2000) : null,
    subjectDigest: e.subjectDigest,
    // 'superseded-by-scanner' means the scanner grew a measurement — the good outcome.
    status: scannerState !== 'unchecked' ? 'superseded-by-scanner' : status,
    // Stated explicitly so no client re-derives the rule.
    counts: status === 'active' && e.whoKind === 'human' && e.action === 'attest' && scannerState === 'unchecked',
    ...(e.whoKind !== 'human' && e.action === 'attest'
      ? { notCounted: 'machine-attributed — an agent-signed attestation is recorded, but it clears nothing' }
      : {}),
  };
}

// Merge the human layer onto a scanner report without touching the scanner's own numbers: state/
// levels/conformance pass through byte-identical; the human layer adds effectiveState,
// attestation, attestedLevels and attestedConformance as new fields.
export function mergeAttestations(report, doc, { area, now } = {}) {
  const currentDigest = reportDigest(report);
  const rows = (report && Array.isArray(report.criteria)) ? report.criteria : [];
  const criteria = rows.map((r) => {
    const e = latestEntry(doc, area, r.id);
    const view = attestationView(e, { now, currentDigest, scannerState: r.state });
    return {
      ...r,
      attestable: attestableCriteria().has(r.id) && r.state === 'unchecked',
      effectiveState: attestedState(r.state, e, { now, currentDigest }),
      attestation: view,
    };
  });
  const tally = (lvl) => {
    const set = criteria.filter((r) => r.level === lvl);
    const count = (pred) => set.filter(pred).length;
    return {
      total: set.length,
      pass: count((r) => r.effectiveState === 'pass'),
      attestedPass: count((r) => r.effectiveState === 'attested-pass' || r.effectiveState === 'attested-n/a'),
      fail: count((r) => FAILED_STATES.has(r.effectiveState)),
      unchecked: count((r) => r.effectiveState === 'unchecked'),
    };
  };
  const A = tally('A'), AA = tally('AA');
  const claim = (fails, unchecked) => (fails ? 'fails' : unchecked ? 'unverified' : 'conformant');
  return {
    ...report,
    criteria,
    attestedLevels: { A, AA },
    attestedConformance: {
      A: claim(A.fail, A.unchecked),
      AA: claim(A.fail + AA.fail, A.unchecked + AA.unchecked),
      note: 'THIS IS A DIFFERENT CLAIM FROM `conformance`, which is the scanner\'s alone. This one '
          + 'also counts criteria a named person manually verified. A human attestation is a signed '
          + 'statement, not a measurement: it is only as good as the identity behind it, it is bound '
          + 'to the exact content that was checked, and it lapses the moment that content changes. '
          + 'An attested criterion is never counted as a static pass — see `attestedPass`, counted '
          + 'separately from `pass`, in every tally here.',
    },
    subjectDigest: currentDigest,
    // The legend travels with the data so a client cannot invent its own colour mapping.
    effectiveStates: {
      pass: 'the scanner checked it statically and found no violation',
      fail: 'the scanner checked it statically and found violations',
      'n/a': 'no applicable content on these pages',
      unchecked: 'NOT decidable from static markup, and nobody has verified it. Not a pass.',
      'attested-pass': 'a named person manually verified it against this exact content. NOT a scanner pass.',
      'attested-n/a': 'a named person determined it does not apply to these pages',
      'attested-fail': 'a named person checked it and it is broken — counted exactly like a scanner fail',
    },
    verdicts: [...VERDICTS],
    clearingVerdicts: [...CLEARING_VERDICTS],
    metStates: [...MET_STATES],
  };
}
