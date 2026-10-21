// lib/vault-peers.mjs — who may ask the vault for something, and what they get back.
//
// WHAT THIS IS FOR. bin/commitwork.mjs:348 already scopes credentials per check: it resolves from
// an empty base, copies only the names a check DECLARES, and hands them to that check's command
// rather than merging them into process.env. That is correct and it is not the whole problem. Three
// things remain, and none are served by better scoping:
//
//   1. The value still crosses into a child process in CLEARTEXT, readable by that process tree.
//   2. secretsFor() trusts the manifest's declaration. It cannot check that the process receiving
//      the token is the one the manifest named — every process running as the operator is equally
//      entitled, including ~40 third-party scanner subprocesses.
//   3. Nothing records who resolved what. Resolution is scattered in-process with no audit point.
//
// A registered keypair answers (2), a signed challenge answers it per call, and a capability that
// names an AUDIENCE rather than carrying a secret answers (1).
//
// THE CAPABILITY NEVER CARRIES THE CREDENTIAL. It is a bearer statement that some named peer may
// have some named act performed on its behalf, before some expiry. The broker holds the credential
// and performs the act; the credential does not cross the socket. A capability that embedded the
// token would move the plaintext hop rather than removing it, which is the whole point.
//
// SEPARATE PAIRS PER CONSUMER, so revocation is per consumer. Deleting a roster entry ends that
// peer's access without re-sealing or redistributing anything — the limitation a sealed-file map
// carries and this does not.
//
// Zero runtime dependencies: ed25519 and X25519 are node:crypto built-ins (verified on v24).
// Every input path is env-overridable and read at CALL time.

import { randomBytes, createPublicKey, verify as edVerify, sign as edSign, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const MECHANISMS = new Set(['ed25519']);

export function peersPath(env = process.env) {
  return env.CW_VAULT_PEERS || join(homedir(), '.commitwork', 'peers.json');
}

/** How long a challenge stays answerable. Short: a nonce is a replay window by definition. */
export const CHALLENGE_TTL_MS = 30_000;
/** How long an issued capability stays valid. Short for the same reason. */
export const CAPABILITY_TTL_MS = 60_000;

const emptyRoster = () => ({ version: 1, peers: {} });

/** Absent roster is a legitimate empty — no peer is registered, so nothing is entitled. A roster
 *  that EXISTS and is malformed THROWS: a typo must not read as "no peers", which fails OPEN in the
 *  one direction that matters if a caller treats an empty roster as "skip the check". */
export function loadPeers(env = process.env) {
  const path = peersPath(env);
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return emptyRoster();
    throw new Error(`vault-peers: roster at ${path} is unreadable (${e.code}); refusing to treat it as empty`);
  }
  let r;
  try { r = JSON.parse(raw); }
  catch (e) { throw new Error(`vault-peers: roster at ${path} is not valid JSON (${e.message}); refusing to treat it as empty`); }
  if (!r || typeof r !== 'object' || Array.isArray(r) || !r.peers || typeof r.peers !== 'object') {
    throw new Error(`vault-peers: roster at ${path} is not a peer roster`);
  }
  for (const [name, p] of Object.entries(r.peers)) {
    if (!MECHANISMS.has(p.mechanism)) throw new Error(`vault-peers: ${name} declares unknown mechanism ${JSON.stringify(p.mechanism)}`);
    if (typeof p.publicKey !== 'string' || !p.publicKey.includes('BEGIN PUBLIC KEY')) {
      throw new Error(`vault-peers: ${name} has no SPKI public key`);
    }
  }
  return r;
}

export function savePeers(roster, env = process.env) {
  const path = peersPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(roster, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* best-effort */ }
  return path;
}

/** Register one consuming system. `scope` is the set of audiences it may ever be issued for —
 *  checked at ISSUE time, so widening a peer's reach is a deliberate roster edit. */
export function registerPeer({ name, publicKey, mechanism = 'ed25519', scope = [] }, env = process.env) {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(name || ''))) throw new Error(`vault-peers: ${JSON.stringify(name)} is not a peer name (a-z, 0-9, -)`);
  if (!MECHANISMS.has(mechanism)) throw new Error(`vault-peers: unknown mechanism ${JSON.stringify(mechanism)}`);
  createPublicKey(publicKey); // throws on a key that is not a key, before it reaches the roster
  if (!Array.isArray(scope) || !scope.length) throw new Error('vault-peers: a peer with no scope could never be issued anything — declare its audiences');
  const roster = loadPeers(env);
  roster.peers[name] = { mechanism, publicKey, scope, added: new Date().toISOString() };
  savePeers(roster, env);
  return { name, mechanism, scope };
}

/** Revocation is a roster deletion. Nothing is re-sealed and nothing is redistributed. */
export function revokePeer(name, env = process.env) {
  const roster = loadPeers(env);
  const had = Object.prototype.hasOwnProperty.call(roster.peers, name);
  delete roster.peers[name];
  savePeers(roster, env);
  return had;
}

/** A challenge the caller must sign. Single-use is the CALLER's job to enforce via `seen`. */
export function newChallenge(now = Date.now()) {
  return { nonce: randomBytes(32).toString('base64'), expiresAt: now + CHALLENGE_TTL_MS };
}

/**
 * Verify a signed challenge. Returns { ok } / { ok:false, reason } — reasons stay distinct because
 * unknown-peer, expired and bad-signature demand different operator actions, and collapsing them
 * into one falsy is how a roster problem reads as an attack.
 */
export function verifyChallenge({ peer, challenge, signature, seen = null, now = Date.now() }, env = process.env) {
  const roster = loadPeers(env);
  const p = roster.peers[peer];
  if (!p) return { ok: false, reason: 'unknown-peer', detail: `${peer} is not registered` };
  if (!challenge || typeof challenge.nonce !== 'string') return { ok: false, reason: 'bad-challenge', detail: 'no nonce' };
  if (now > challenge.expiresAt) return { ok: false, reason: 'expired', detail: 'the challenge window has closed' };
  // Replay: a nonce answered once must never be answerable again, even inside its window.
  if (seen) {
    if (seen.has(challenge.nonce)) return { ok: false, reason: 'replay', detail: 'this nonce has already been answered' };
    seen.add(challenge.nonce);
  }
  let ok = false;
  try { ok = edVerify(null, Buffer.from(challenge.nonce), createPublicKey(p.publicKey), Buffer.from(signature, 'base64')); }
  catch (e) { return { ok: false, reason: 'bad-signature', detail: e.message }; }
  return ok ? { ok: true } : { ok: false, reason: 'bad-signature', detail: 'the signature does not verify against the registered key' };
}

const capBody = (c) => JSON.stringify({ peer: c.peer, audience: c.audience, expiresAt: c.expiresAt, nonce: c.nonce });

/**
 * Issue a capability: a signed statement that `peer` may have `audience` performed for it, until
 * `expiresAt`. It carries NO credential — see the header. `audience` must be in the peer's declared
 * scope, so a compromised caller cannot ask for something its roster entry never allowed.
 */
export function issueCapability({ peer, audience, brokerKey, now = Date.now() }, env = process.env) {
  const roster = loadPeers(env);
  const p = roster.peers[peer];
  if (!p) return { ok: false, reason: 'unknown-peer', detail: `${peer} is not registered` };
  if (!p.scope.includes(audience)) {
    return { ok: false, reason: 'out-of-scope', detail: `${peer} is scoped to [${p.scope.join(', ')}] and asked for ${audience}` };
  }
  const claim = { peer, audience, expiresAt: now + CAPABILITY_TTL_MS, nonce: randomBytes(16).toString('base64') };
  const signature = edSign(null, Buffer.from(capBody(claim)), brokerKey).toString('base64');
  return { ok: true, capability: { ...claim, signature } };
}

/** Verify a capability against the broker's PUBLIC key. Expiry is checked before the signature so a
 *  stale token cannot be distinguished from a forged one by timing. */
export function verifyCapability({ capability, brokerPublicKey, audience, now = Date.now() }) {
  if (!capability || typeof capability !== 'object') return { ok: false, reason: 'bad-capability', detail: 'not an object' };
  if (now > capability.expiresAt) return { ok: false, reason: 'expired', detail: 'the capability has expired' };
  if (audience !== undefined && capability.audience !== audience) {
    return { ok: false, reason: 'wrong-audience', detail: `issued for ${capability.audience}, presented for ${audience}` };
  }
  const { signature, ...claim } = capability;
  let ok = false;
  try { ok = edVerify(null, Buffer.from(capBody(claim)), createPublicKey(brokerPublicKey), Buffer.from(signature, 'base64')); }
  catch (e) { return { ok: false, reason: 'bad-signature', detail: e.message }; }
  return ok ? { ok: true, peer: claim.peer, audience: claim.audience } : { ok: false, reason: 'bad-signature', detail: 'does not verify against the broker key' };
}

/** What the remote may see: a digest, never a name, never a key. */
export const peerDigest = (name, env = process.env) => {
  const p = loadPeers(env).peers[name];
  return p ? createHash('sha256').update(p.publicKey).digest('hex').slice(0, 32) : null;
};
