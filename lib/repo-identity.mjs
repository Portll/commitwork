// lib/repo-identity.mjs — a repository's identity is a UUID; its real name lives in the vault.
//
// WHY AN IDENTITY AND NOT ANOTHER FILTER. Today every client name is redacted on the way OUT, at
// each boundary separately: taxonomy pages have a pass, docsite-build has none, the MCP server has
// none, report HTML has none, git history has none. That is one policy stated in ten places, so a
// new egress starts unredacted and has to be REMEMBERED — measured 2026-09-06 as four boundaries
// failing the same way at once. Assigning the identity at INGEST inverts it: the private name is
// absent from every downstream store rather than filtered from every downstream reader, and a
// boundary nobody remembered leaks a UUID.
//
// THE UUID IS RANDOM, NEVER DERIVED FROM THE NAME. A hash looks like the tidier construction and is
// not one here: the identity domain is small — 12 names in monitor/release-redactions.json, 7
// projects in the live registry, 374 report directories — so hash(name) over a domain that size is
// recovered by wordlist in seconds, and the map would be decorative. Random minting is what makes
// the vault the only way back.
//
// THE MAP IS KEYCHAIN-HELD, NOT A FILE. lib/secrets.mjs already keeps values in the macOS Keychain
// and only REFERENCES on disk; this reuses that rather than inventing a second store with its own
// failure modes. The consequence is the property that matters: the on-disk roster carries UUIDs and
// no names, so it is safe to track, diff and publish, and losing it discloses nothing.
//
// Every input path is env-overridable and read at CALL time — a `const X = process.env.Y` at import
// silently defeats the override for any test that sets it afterwards, so the test passes while
// proving nothing.

import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRef, defaultRefFor } from './secrets.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The keychain SERVICE that holds identity items. Separate from the credential service so that a
 *  grant over one is not a grant over the other. */
export const IDENTITY_SERVICE = 'commitwork-identity';

/** UUID roster: identities and their metadata, carrying NO names. Safe to track. */
export function rosterPath(env = process.env) {
  return env.CW_REPO_IDENTITY_ROSTER || join(REPO, 'monitor', 'repo-identity.json');
}

/** Append-only, hash-chained record of every mint and retirement. Carries no names either. */
export function ledgerPath(env = process.env) {
  return env.CW_REPO_IDENTITY_LEDGER || join(REPO, '.claude', 'store', 'repo-identity.jsonl');
}

export const identityRefFor = (uuid) => defaultRefFor(uuid, IDENTITY_SERVICE);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isIdentity = (s) => UUID_RE.test(String(s || ''));

/** Mint a fresh identity. Random by construction — see the header for why a digest is not used. */
export const mint = () => randomUUID();

const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

/**
 * The DIFF digest — over the change alone, independent of the chain link below it.
 *
 * Two digests, because they fail differently and a remote that sees only hashes needs both. The
 * chain hash covers `prev + record` and answers "has the lineage been broken". This one covers the
 * change and answers "is the content what was recorded". One digest serving both roles would let a
 * replay that preserves lineage carry a matching content hash, and a remote would read a clean
 * chain over altered content — a guard sharing its own failure mode.
 */
export const diffDigest = (before, after) =>
  digest(JSON.stringify({ before: before ?? null, after: after ?? null }));

function emptyRoster() { return { version: 1, note: 'UUIDs only — names live in the keychain, service ' + IDENTITY_SERVICE, identities: {} }; }

/**
 * Absent roster is a legitimate empty. A roster that EXISTS and is malformed THROWS: a typo must
 * not read as "no identities are assigned", which would mint duplicates for repos that already have
 * one and orphan the keychain items holding their names.
 */
export function loadRoster(env = process.env) {
  const path = rosterPath(env);
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return emptyRoster();
    throw new Error(`repo-identity: roster at ${path} is unreadable (${e.code}); refusing to treat it as empty`);
  }
  let r;
  try { r = JSON.parse(raw); }
  catch (e) { throw new Error(`repo-identity: roster at ${path} is not valid JSON (${e.message}); refusing to treat it as empty`); }
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`repo-identity: roster at ${path} is not an object`);
  if (r.identities === undefined) r.identities = {};
  if (!r.identities || typeof r.identities !== 'object' || Array.isArray(r.identities)) {
    throw new Error(`repo-identity: roster at ${path} has a non-object 'identities' map`);
  }
  // A roster that carries something which is not an identity is a roster somebody hand-edited, and
  // the next mint would sit beside it as though it were equivalent.
  for (const k of Object.keys(r.identities)) {
    if (!isIdentity(k)) throw new Error(`repo-identity: roster at ${path} holds ${JSON.stringify(k)}, which is not a v4 UUID`);
  }
  return r;
}

/** Atomic (tmp+rename), 0600. Re-runs are idempotent; same inputs produce the same bytes. */
export function saveRoster(roster, env = process.env) {
  const path = rosterPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(roster, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* best-effort on odd filesystems */ }
  return path;
}

/**
 * Resolve an identity to its real name. Returns { ok, value } / { ok:false, reason, detail } — the
 * shape lib/secrets.mjs already uses, and for the same reason: not-found, locked and denied demand
 * different operator actions, so they must not collapse into one falsy.
 *
 * THIS IS THE ONLY WAY BACK. Nothing else in the tree holds the mapping.
 */
export function resolveIdentity(uuid, { env = process.env } = {}) {
  if (!isIdentity(uuid)) return { ok: false, reason: 'bad-identity', detail: `${JSON.stringify(uuid)} is not a v4 UUID` };
  return resolveRef(identityRefFor(uuid), { env });
}

/** Presence WITHOUT names — no name field at all, not even a redacted one. */
export function status({ env = process.env, probe = true } = {}) {
  const roster = loadRoster(env);
  return Object.entries(roster.identities).map(([uuid, meta]) => {
    const row = { uuid, ...meta, ref: identityRefFor(uuid) };
    if (probe) {
      const r = resolveIdentity(uuid, { env });
      row.resolvable = r.ok;
      if (!r.ok) { row.reason = r.reason; row.detail = r.detail; }
    }
    return row;
  });
}
