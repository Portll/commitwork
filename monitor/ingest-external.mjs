// monitor/ingest-external.mjs — the return path: the single spine through which an external
// judgement (false-positive / remediated / not-applicable) reaches the issue store, plus the
// re-scan that follows. Transports (mcp/http/cli) are thin adapters and validate nothing.
// The finding is never deleted and never closed as fixed here; `remediated` does not suppress.
// Rulings bind to a subject digest (title carries the version; anchorHash is content, not line)
// and go stale the moment it moves.

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeJSONAtomic, stableStringify } from '../cra/lib.mjs';
import { validateAgainstSchema, SLUG_RE } from './registry.mjs';
import { sessionWho, classifyWho } from './attribution.mjs';
import { appendRemediationEvent, mutateIssue } from './issue-store.mjs';
import { SCANNER_CHECKS, canonicalCheck } from './scanner-checks.mjs';
import { appendFindingAdjudication, findingKeyForDependency } from '../bin/lib/verdict-journal-core.mjs';
import { scannerEnv } from '../bin/lib/scanner-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// ── vocabulary ───────────────────────────────────────────────────────────────────────────────────
export const DISPOSITIONS = Object.freeze(['false-positive', 'remediated', 'not-applicable']);

// `remediated` is deliberately absent — a claim of a fix is not a fix; the scanner decides.
export const SUPPRESSING_DISPOSITIONS = Object.freeze(['false-positive', 'not-applicable']);

/** The transports. `webhook` is declared but unbuilt — the seam, not a receiver. */
export const CHANNELS = Object.freeze(['mcp', 'http', 'webhook', 'cli']);

// Channels that can never yield a `human` attribution — only the panel's logged-in session can.
const AGENT_CHANNELS = new Set(['mcp', 'webhook']);

export const RESCAN_GROUPS = Object.freeze(['all', 'fast', 'supply-chain', 'deep']);
export const RESCAN_NONE = 'none';

// Closed set of legal re-scan levels — derived from SCANNER_CHECKS, never duplicated in the schema.
export function rescanLevels() {
  return new Set([...RESCAN_GROUPS, RESCAN_NONE, ...Object.values(SCANNER_CHECKS)]);
}

// ── clock / paths (every input CW_*-overridable) ─────────────────────────────────────────────────
export { nowISO };
export const judgementSchemaPath = () => (process.env.CW_JUDGEMENT_SCHEMA
  ? resolve(process.env.CW_JUDGEMENT_SCHEMA)
  : join(ROOT, 'schema', 'external-judgement.schema.json'));
export const quarantinePath = () => (process.env.CW_INGEST_QUARANTINE
  ? resolve(process.env.CW_INGEST_QUARANTINE)
  : join(ROOT, 'monitor', 'ingest-quarantine.json'));

/** Default life of a SUPPRESSING ruling when the caller names no expiry. */
export const DISPOSITION_TTL_DAYS = () => +(process.env.CW_DISPOSITION_TTL_DAYS || 90);
/** The longest a suppression may be asked to live. Beyond this it is a deletion with extra steps. */
export const DISPOSITION_MAX_TTL_DAYS = () => +(process.env.CW_DISPOSITION_MAX_TTL_DAYS || 365);
/** Ops kill-switch: 0/false records the re-scan request without spawning anything. */
export const rescanEnabled = () => !['0', 'false', 'no'].includes(String(process.env.CW_INGEST_RESCAN ?? '1').toLowerCase());

// ── refusal codes (the adapters map these to transport-shaped errors; the set is closed) ─────────
export const REFUSALS = Object.freeze({
  NO_IDENTITY: 'no-identity',
  BAD_IDENTITY: 'bad-identity',
  SCHEMA: 'schema',
  UNKNOWN_LEVEL: 'unknown-rescan-level',
  UNKNOWN_ISSUE: 'unknown-issue',
  CLOSED_ISSUE: 'closed-issue',
  STALE_SUBJECT: 'stale-subject',
  BAD_EXPIRY: 'bad-expiry',
  BAD_CHANNEL: 'bad-channel',
});

// ── the subject digest ───────────────────────────────────────────────────────────────────────────
const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

// Canonical structured subject of an issue. Store-derived only — a caller cannot shape its own
// invalidation key.
export function issueSubject(iss) {
  const src = iss.source || {};
  return {
    sourceKind: src.kind ?? null,
    sourceKey: src.key ?? null,
    tool: src.tool ?? null,
    rule: src.rule ?? null,
    repo: iss.repo ?? null,
    // composed from structured fields only (A4); this is where the version lives
    title: iss.title ?? null,
    severity: iss.severity ?? null,
    anchorHash: iss.anchor ? (iss.anchor.hash ?? null) : null,
    groupMembers: Array.isArray(iss.groupMembers) ? [...iss.groupMembers].sort() : null,
  };
}

/** `sha256:<hex>` over the canonical subject. stableStringify ⇒ key order can never move it. */
export function subjectDigest(iss) {
  return `sha256:${sha256hex(stableStringify(issueSubject(iss)))}`;
}

// ── quarantine (the refusal ledger) ──────────────────────────────────────────────────────────────
export function emptyQuarantineDoc() {
  return {
    note: 'commitwork external-ingest QUARANTINE — every judgement the return path refused, with '
        + 'the raw payload kept as an opaque STRING. Never re-applied, never parsed back into the '
        + 'issue store. Written by monitor/ingest-external.mjs; never edit by hand.',
    version: 1,
    dropped: 0,
    entries: [],
  };
}

// Fail closed: only ENOENT is absence.
export function loadQuarantine({ path = quarantinePath() } = {}) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return emptyQuarantineDoc();
    throw new Error(`ingest quarantine at ${path} is unreadable (${e.code}); refusing to treat it as empty`);
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error(`ingest quarantine at ${path} is not valid JSON (${e.message}); refusing to treat it as empty`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.entries)) {
    throw new Error(`ingest quarantine at ${path} is not a quarantine document`);
  }
  return doc;
}

/** Retention bound. The issue store is strictly append-only; this file is NOT, and cannot be. */
export const QUARANTINE_MAX = () => +(process.env.CW_INGEST_QUARANTINE_MAX || 1000);
const PAYLOAD_CAP = 4096;

// Append one refusal atomically. Bounded — unauthenticated writers are a disk-fill primitive —
// with `dropped` keeping the loss visible; payloads capped and stored as opaque strings.
export function defaultQuarantineSink(entry, { path = quarantinePath(), max = QUARANTINE_MAX() } = {}) {
  const doc = loadQuarantine({ path });
  doc.entries.push(entry);
  if (doc.entries.length > max) {
    doc.dropped = (doc.dropped || 0) + (doc.entries.length - max);
    doc.entries.splice(0, doc.entries.length - max);
  }
  writeJSONAtomic(path, doc);
  return doc;
}

function quarantineEntry({ at, channel, who, refused, errors, payload }) {
  let text;
  // Serialising hostile bytes can throw; that must not take down the refusal.
  try { text = JSON.stringify(payload); } catch { text = null; }
  if (typeof text !== 'string') text = String(payload);
  const truncated = text.length > PAYLOAD_CAP;
  return {
    at,
    channel,
    who: who || null,           // null is the honest record of "nobody signed this"
    refused,
    errors: (errors || []).slice(0, 25).map((e) => String(e).slice(0, 500)),
    payloadSha: `sha256:${sha256hex(text)}`,
    payloadTruncated: truncated,
    payload: truncated ? text.slice(0, PAYLOAD_CAP) : text,   // an opaque STRING, deliberately
  };
}

// ── identity ─────────────────────────────────────────────────────────────────────────────────────
// Bound `who` at the door: no control characters, hard length cap, linear regex.
const WHO_RE = /^[^\u0000-\u001f\u007f]{1,200}$/;

// ── the spine ────────────────────────────────────────────────────────────────────────────────────
/**
 * Ingest ONE external judgement.
 *   ingestExternal(doc, payload, { now, session, channel, ... })
 *   `doc` is caller-loaded under withIssuesLock and mutated ONLY on success — every refusal
 *   returns before the first write. `payload` is untrusted. `session` is {user, provider}.
 *   -> { ok:true,  issueId, disposition, subjectDigest, greenKind, rescan:{level, argv, spawned} }
 *   -> { ok:false, refused:<REFUSALS code>, errors:[…], quarantined:true|false }
 * The caller saves the store and (if it wants the re-scan to run) calls runRescan().
 */
export function ingestExternal(doc, payload, {
  now = nowISO(),
  session = null,
  channel = 'http',
  schemaPath = judgementSchemaPath(),
  quarantineSink = defaultQuarantineSink,
  quarantineOpts = {},
} = {}) {
  const refuse = (refused, errors, { who = null, quarantine = true } = {}) => {
    let quarantined = false;
    if (quarantine) {
      try { quarantineSink(quarantineEntry({ at: now, channel, who, refused, errors, payload }), quarantineOpts); quarantined = true; }
      catch (e) {
        // A quarantine that cannot be written must not turn into an accept.
        errors = [...errors, `quarantine write failed: ${e.message}`];
      }
    }
    return { ok: false, refused, errors, quarantined };
  };

  if (!CHANNELS.includes(channel)) {
    return refuse(REFUSALS.BAD_CHANNEL, [`channel must be one of ${CHANNELS.join('|')}`], { quarantine: false });
  }

  // 1. Identity first — a well-formed anonymous judgement is exactly what must not be filed.
  const who = sessionWho(session);
  if (!who) {
    return refuse(REFUSALS.NO_IDENTITY, [
      'no resolvable identity — an external judgement is worth exactly the identity behind it, and '
      + 'an unsigned one launders a machine assertion into the ledger as though a person made it. '
      + 'Sign in (panel) or supply the acting + authorizing identities (MCP).',
    ]);
  }
  if (!WHO_RE.test(who)) {
    return refuse(REFUSALS.BAD_IDENTITY, ['identity contains control characters or exceeds 200 chars'], { who: null });
  }
  const whoKind = AGENT_CHANNELS.has(channel) ? 'machine' : classifyWho(who);

  // 2. Schema — quarantine failures; an invalid payload is never partially applied.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return refuse(REFUSALS.SCHEMA, ['payload must be a JSON object'], { who });
  }
  const { errors } = validateAgainstSchema(payload, { path: schemaPath });
  if (errors.length) return refuse(REFUSALS.SCHEMA, errors, { who });

  // 3. Re-scan level — closed set; an unknown level is a refusal, never a default.
  const levels = rescanLevels();
  const asked = canonicalCheck(payload.rescan);
  if (!levels.has(asked)) {
    return refuse(REFUSALS.UNKNOWN_LEVEL, [
      `rescan '${String(payload.rescan).slice(0, 64)}' is not a sweep group, a known check id, or 'none'. `
      + `Name one of: ${[...levels].sort().join(', ')}. No level is picked for you.`,
    ], { who });
  }
  // The value that travels is the closed set's own copy, never the caller's string.
  const level = [...levels].find((l) => l === asked);

  // 4. Target must exist and still be open.
  const iss = doc.issues[payload.issueId];
  if (!iss) return refuse(REFUSALS.UNKNOWN_ISSUE, [`no such issue ${payload.issueId}`], { who });
  if (iss.state === 'closed') {
    return refuse(REFUSALS.CLOSED_ISSUE, [`${iss.id} is already closed (${iss.closedAs}); reopen it before judging it`], { who });
  }

  // 5. Subject — compute the digest the ruling binds to, and honour the caller's pin.
  const digest = subjectDigest(iss);
  if (payload.subjectDigest && payload.subjectDigest !== digest) {
    return refuse(REFUSALS.STALE_SUBJECT, [
      `the subject moved since you read it (pinned ${payload.subjectDigest.slice(0, 23)}…, now ${digest.slice(0, 23)}…). `
      + 'Re-read the finding and judge what is there now.',
    ], { who });
  }

  // 6. Expiry — suppressions expire by default.
  const suppressing = SUPPRESSING_DISPOSITIONS.includes(payload.disposition);
  const nowMs = new Date(now).getTime();
  let expires = null;
  if (payload.expires) {
    const t = new Date(payload.expires).getTime();
    if (!Number.isFinite(t)) return refuse(REFUSALS.BAD_EXPIRY, ['expires is not a parseable instant'], { who });
    if (t <= nowMs) return refuse(REFUSALS.BAD_EXPIRY, ['expires is in the past — an already-expired ruling is a no-op wearing a ruling\'s clothes'], { who });
    const maxMs = nowMs + DISPOSITION_MAX_TTL_DAYS() * 86_400_000;
    if (t > maxMs) {
      return refuse(REFUSALS.BAD_EXPIRY, [
        `expires is more than ${DISPOSITION_MAX_TTL_DAYS()} days out; a suppression that outlives the reasoning behind it is a deletion with extra steps`,
      ], { who });
    }
    expires = new Date(t).toISOString();
  } else if (suppressing) {
    expires = new Date(nowMs + DISPOSITION_TTL_DAYS() * 86_400_000).toISOString();
  }
  // `remediated` never carries an expiry: it ends on scan evidence, not a clock.
  if (!suppressing) expires = null;

  // ── everything below this line WRITES ──────────────────────────────────────────────────────────
  // dispositions[] is lazily created so pre-feature records stay byte-identical.
  if (!Array.isArray(iss.dispositions)) iss.dispositions = [];

  const seq = iss.dispositions.length;
  const id = 'DSP-' + sha256hex(stableStringify({ i: iss.id, seq, at: now, who, d: payload.disposition, r: payload.reason })).slice(0, 12);
  const record = {
    id,
    disposition: payload.disposition,
    reason: payload.reason,
    who,
    whoKind,
    channel,
    at: now,
    expires,
    subjectDigest: digest,
    rescan: level,
    invalidatedAt: null,
    invalidatedReason: null,
  };

  mutateIssue(doc, iss.id, (i) => {
    i.dispositions.push(record);
    // Agent channels carry a caller-typed identity, so their suppression is a proposal: filed and
    // attributed, but the issue stays queued until a human channel rules.
    if (suppressing && whoKind !== 'machine') {
      i.waiver = { annotationId: record.id, expiresAt: expires };
    }
    // state is untouched, always — closedAs:'fixed' means a scanner proved it.
  }, 'issue-disposition', {
    dispositionId: id, disposition: record.disposition, who, whoKind, channel,
    expires, subjectDigest: digest, rescan: level,
  }, now);
  appendRemediationEvent(doc, 'fix-authored', iss.id, {
    at: now,
    evidence: { note: record.reason, who },
    data: { dispositionId: id, action: record.disposition, channel },
  });

  // ── ground truth: the ONE disposition that is also a machine-truth claim ──────────────────────
  // ACTION_TRUTH discipline (bin/adjudication-import.mjs, bin/verdict-journal.mjs vocabulary note):
  // false-positive is, by construction, a judgment that the SCANNER was wrong, so it flows to the
  // calibration ledger the moment it is filed — not when someone remembers the batch importer,
  // which reads annotations.json and never this store. Every other disposition is a human risk
  // decision and maps to no truth. Fail-open, loudly: a ledger write failure costs evidence,
  // never a ruling — the caller sees `groundTruth` either way, so unrecorded is a stated state,
  // not a silent one.
  let groundTruth = null;
  if (record.disposition === 'false-positive' && whoKind === 'machine') {
    groundTruth = { recorded: false, reason: `agent channel (${channel}) — a machine claim is not a human verdict` };
  } else if (record.disposition === 'false-positive') {
    const fk = findingKeyFromSource(iss.source);
    if (!fk) {
      groundTruth = { recorded: false, reason: iss.source?.kind === 'manual'
        ? 'manual issue — no scanner claim to adjudicate'
        : 'source key unkeyable — deriving a finding identity would be a guess (degenerate or absent key)' };
    } else {
      try {
        const res = appendFindingAdjudication({
          findingKey: fk.findingKey, category: fk.category, repo: fk.repo,
          machineVerdict: 'finding', humanVerdict: 'false-positive', truth: 'false-alarm',
          basis: record.reason, evidence: null, model: null, promptId: null,
          bornSlice: null, // the issue store tracks born via events, not a slice field — honest null
          dispositionId: id, issueId: iss.id,
        }, { place: fk.findingKey, artifact: `issue:${iss.id}` });
        groundTruth = res.ok ? { recorded: true } : { recorded: false, reason: res.error };
        if (!res.ok) console.error(`[ground-truth] finding-adjudication not recorded (${res.error}) — the ruling itself is filed`);
      } catch (e) {
        groundTruth = { recorded: false, reason: String(e && e.message || e) };
        console.error(`[ground-truth] finding-adjudication write threw (${groundTruth.reason}) — the ruling itself is filed`);
      }
    }
  }

  return {
    ok: true,
    issueId: iss.id,
    disposition: record,
    subjectDigest: digest,
    greenKind: greenKind(iss, { now }),
    groundTruth,
    rescan: { level, argv: level === RESCAN_NONE ? null : rescanArgv(level, iss.area), spawned: false },
  };
}

// Derive the ledger's place-keyed findingKey from an issue's source key — 1:1 or refuse, never a
// guess. `f:repo|tool|id|package|path` (dependency) → repo|id|package, the exact tuple
// findingKeyForDependency builds and adjudication-import already writes, so a live ruling and a
// batch-imported annotation about the same CVE land under ONE subject. `sc:repo|category|p1|p2…`
// (scanner) → category|repo|p1|p2…, matching findingKeyForScanner's assembly order — the parts are
// identityFor(category)'s own values in its own order, minted by scannerSourceKey from the same
// tuple, so no name-checked reassembly is needed (identityFor already excluded line at mint).
// Degenerate keys (every discriminator the literal "undefined") and null keys refuse: 500+ legacy
// rows carry that shape and one findingKey for all of them would merge unrelated findings.
function findingKeyFromSource(src) {
  const key = String((src && src.key) || '');
  if (src?.kind === 'finding' && key.startsWith('f:')) {
    const [repo, , id, pkg] = key.slice(2).split('|');
    if (repo && id) return { findingKey: findingKeyForDependency(repo, id, pkg || ''), category: src.tool || 'deps', repo };
  }
  if (src?.kind === 'scanner-row' && key.startsWith('sc:')) {
    const [repo, category, ...idParts] = key.slice(3).split('|');
    if (repo && category && idParts.length && !idParts.every((p) => p === 'undefined' || p === '')) {
      return { findingKey: [category, repo, ...idParts].join('|'), category, repo };
    }
  }
  return null;
}

// ── disposition lifecycle (expiry + invalidation) ────────────────────────────────────────────────
// Four states, never three: 'active' | 'expired' | 'invalidated' | 'stale-subject' (subject moved,
// not yet reconciled — still not in force).
export function dispositionStatus(d, { now, currentDigest = null } = {}) {
  if (!d) return 'invalidated';
  if (d.invalidatedAt) return 'invalidated';
  if (currentDigest && d.subjectDigest !== currentDigest) return 'stale-subject';
  if (d.expires && new Date(d.expires).getTime() <= new Date(now).getTime()) return 'expired';
  return 'active';
}

/** The newest in-force disposition on an issue, or null. Newest-first: a later ruling supersedes. */
export function activeDisposition(iss, { now, currentDigest = undefined } = {}) {
  const list = Array.isArray(iss?.dispositions) ? iss.dispositions : [];
  const digest = currentDigest === undefined ? subjectDigest(iss) : currentDigest;
  for (let i = list.length - 1; i >= 0; i--) {
    if (dispositionStatus(list[i], { now, currentDigest: digest }) === 'active') return list[i];
  }
  return null;
}

// Machine evidence tiers; `manual`/`scan-absent` must not read as scanner-clean.
const MACHINE_TIERS = new Set(['strong', 'medium', 'anchor-drift']);

// Keeps the two greens apart — never collapse into a boolean.
//   'scanner-clean'  closed as fixed on machine evidence
//   'human-green'    open, in-force false-positive / not-applicable ruling
//   'human-closed'   closed by a person — a decision, not a proof
//   'claimed-fixed'  in-force `remediated` claim, awaiting scan evidence
//   'agent-proposed' in-force false-positive / not-applicable from an agent channel, still queued
//   'open'           no judgement, no proof
//   'grey'           closed as fixed with no machine evidence tier (A5)
export function greenKind(iss, { now, currentDigest = undefined } = {}) {
  if (iss.state === 'closed') {
    if (iss.closedAs === 'fixed') {
      const machine = (iss.evidence || []).some((e) => MACHINE_TIERS.has(e.tier));
      return machine ? 'scanner-clean' : 'grey';
    }
    return 'human-closed';
  }
  const digest = currentDigest === undefined ? subjectDigest(iss) : currentDigest;
  const d = activeDisposition(iss, { now, currentDigest: digest });
  if (!d) return 'open';
  if (!SUPPRESSING_DISPOSITIONS.includes(d.disposition)) return 'claimed-fixed';
  if (d.whoKind !== 'machine') return 'human-green';
  const humanInForce = (iss.dispositions || []).some((x) => x.whoKind !== 'machine'
    && SUPPRESSING_DISPOSITIONS.includes(x.disposition)
    && dispositionStatus(x, { now, currentDigest: digest }) === 'active');
  return humanInForce ? 'human-green' : 'agent-proposed';
}

// Stamp dispositions whose subject digest moved as invalidated (append-only, with an event) and
// withdraw their waivers — the finding returns to the work queue. Nothing is deleted.
export function reconcileDispositions(doc, { now, dryRun = false } = {}) {
  const invalidated = [];
  for (const iss of Object.values(doc.issues || {})) {
    const list = Array.isArray(iss.dispositions) ? iss.dispositions : [];
    if (!list.length) continue;
    const digest = subjectDigest(iss);
    const stale = list.filter((d) => !d.invalidatedAt && d.subjectDigest !== digest);
    if (!stale.length) continue;
    if (dryRun) { invalidated.push(...stale.map((d) => `(dry) ${iss.id}/${d.id}`)); continue; }
    const ids = stale.map((d) => d.id);
    mutateIssue(doc, iss.id, (i) => {
      for (const d of i.dispositions) {
        if (!ids.includes(d.id)) continue;
        d.invalidatedAt = now;
        d.invalidatedReason = `subject moved: judged ${d.subjectDigest.slice(0, 23)}…, now ${digest.slice(0, 23)}…`;
      }
      // withdraw a waiver installed by any now-invalid ruling
      if (i.waiver && ids.includes(i.waiver.annotationId)) i.waiver = null;
    }, 'issue-disposition-invalidated', { dispositionIds: ids, subjectDigest: digest }, now);
    invalidated.push(...ids.map((d) => `${iss.id}/${d}`));
  }
  return { invalidated };
}

// Panel/tool-safe projection: structured fields + operator reason only (A4); `reason` must still
// be escaped at the HTML sink.
export function judgementView(iss, { now }) {
  const digest = subjectDigest(iss);
  const list = Array.isArray(iss.dispositions) ? iss.dispositions : [];
  return {
    id: iss.id,
    area: iss.area,
    severity: iss.severity,
    state: iss.state,
    // the two greens, never merged
    greenKind: greenKind(iss, { now, currentDigest: digest }),
    subjectDigest: digest,
    dispositions: list.map((d) => ({
      id: d.id,
      disposition: d.disposition,
      who: d.who,
      whoKind: d.whoKind,
      channel: d.channel,
      at: d.at,
      expires: d.expires,
      rescan: d.rescan,
      reason: String(d.reason || '').slice(0, 2000),
      status: dispositionStatus(d, { now, currentDigest: digest }),
    })),
  };
}

// ── the re-scan trigger ──────────────────────────────────────────────────────────────────────────
// Argv array, never a shell string; both variable elements are allowlist-canonical. The re-check
// here is defence in depth for direct callers.
export function rescanArgv(level, area, { root = ROOT } = {}) {
  if (level === RESCAN_NONE) return null;
  if (!rescanLevels().has(level)) throw new Error(`refusing to build a re-scan for unknown level '${String(level).slice(0, 64)}'`);
  const slug = String(area || '');
  if (!SLUG_RE.test(slug)) throw new Error(`refusing to build a re-scan for unresolvable area '${slug.slice(0, 64)}'`);
  return ['node', join(root, 'monitor', 'sweep.mjs'), level, slug];
}

// Run a re-scan, detached and unref'd. `spawn` is injected for tests; CW_INGEST_RESCAN=0 records
// the request without spawning.
// fact: the re-scan gets the scanner env, not the caller's / issue_judge runs inside the MCP server, whose env carries the harness credentials a sweep's lanes must never see (review 2026-10-07 D13) (expiry: never, prev: broken)
export function runRescan(argv, { spawn = nodeSpawn, enabled = rescanEnabled(), env = process.env } = {}) {
  if (!argv) return { spawned: false, reason: 'none', argv: null };
  if (!enabled) return { spawned: false, reason: 'disabled (CW_INGEST_RESCAN=0)', argv };
  try {
    // codeql[js/command-line-injection]: argv array, no shell:true; every element is either a
    // literal or an allowlist-canonical constant (see rescanArgv).
    const child = spawn(argv[0], argv.slice(1), { cwd: ROOT, detached: true, stdio: 'ignore', env: scannerEnv(env) });
    if (child && typeof child.unref === 'function') child.unref();
    return { spawned: true, reason: null, argv, pid: (child && child.pid) || null };
  } catch (e) {
    return { spawned: false, reason: `spawn failed: ${e.message}`, argv };
  }
}
