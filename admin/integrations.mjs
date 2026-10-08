// commitwork admin — third-party vuln-intel source credentials (VulnCheck, Sonatype, Snyk, …).
//
// Same store conventions as auth.mjs: ~/.commitwork, 0600, atomic tmp+rename, monitor/lockfile.mjs
// for the mutex, fail-closed on anything but ENOENT. A per-service API key is lower-stakes than the
// auth store — it doesn't gate login — so there is no password/TOTP/passkey machinery here, only:
// store, retrieve, rotate, redact-on-display.
//
// EVERY read goes through an env-var override that ALWAYS wins over the stored value, read at CALL
// time (never cached at import) so a test or a headless run can set it without touching the panel —
// this repo's CW_* rule. That is also what makes the source usable in CI/headless: no admin panel
// interaction required.
//
// The stored key is never returned in full once set — listSources() redacts to the last 4 chars,
// same idea as a password manager. Getting the FULL key back out is only for the code that actually
// calls the vendor API (getSourceKey), never for display.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { integrationsStorePath } from '../monitor/store-paths.mjs';
import { acquireLock } from '../monitor/lockfile.mjs';

// RESOLVED AT CALL TIME, PINNED inside a locked operation — the same treatment as admin/auth.mjs,
// and this is the module where the defect actually fired. It was a module-load `const` reading
// CW_INTEGRATIONS_STORE, so a test that set the variable after import operated on the operator's
// REAL store: on 2026-09-01 one wrote a live third-party key into ~/.commitwork/integrations.json
// and it sat there for about three minutes before an ENOENT on the wrong path gave it away.
//
// The pin matters for the same reason it does in auth.mjs: call-time resolution alone would let a
// load and its save name different files, which a const made impossible.
let pinnedStorePath = null;
const storePath = () => pinnedStorePath || integrationsStorePath();

// Re-exported so a caller can ask where the store is and get a CURRENT answer.
export { integrationsStorePath };

// Declared sources, each with the env override that always wins. A source not in this map is
// refused rather than silently accepted — an unknown key here would be a typo nobody notices until
// the lookup that reads it comes back empty.
export const SOURCES = Object.freeze({
  vulncheck: { envVar: 'CW_VULNCHECK_KEY', label: 'VulnCheck (KEV / NVD++)' },
  sonatype: { envVar: 'CW_SONATYPE_KEY', label: 'Sonatype OSS Index / Guide' },
  snyk: { envVar: 'CW_SNYK_KEY', label: 'Snyk' },
});

export const isKnownSource = (name) => Object.prototype.hasOwnProperty.call(SOURCES, name);

function emptyStore() { return { version: 1, sources: {} }; }

// FAIL CLOSED on anything except a genuinely absent file — same reasoning as auth.mjs's loadStore:
// a corrupt or unreadable store must never read as "no keys configured", which would silently
// disable every enrichment lane reading it rather than surfacing the break.
export function loadStore() {
  let raw;
  try { raw = readFileSync(storePath(), 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return emptyStore();
    throw new Error(`integrations store at ${storePath()} is unreadable (${e.code}); refusing to treat it as empty`);
  }
  let s;
  try { s = JSON.parse(raw); }
  catch (e) { throw new Error(`integrations store at ${storePath()} is not valid JSON (${e.message}); refusing to treat it as empty`); }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`integrations store at ${storePath()} is not an object`);
  if (!s.sources || typeof s.sources !== 'object' || Array.isArray(s.sources)) throw new Error(`integrations store at ${storePath()} has no sources object; refusing to guess`);
  return s;
}

let holdsStoreLock = false;
export const holdsIntegrationsStoreLock = () => holdsStoreLock;

function saveStore(store) {
  if (!holdsStoreLock) {
    throw new Error('refusing to save the integrations store without its lock — wrap the load/mutate/save in withStoreLock().');
  }
  // ONE resolution for the whole write — mkdir, tmp, rename and chmod must name the same file.
  const target = storePath();
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
  try { chmodSync(target, 0o600); } catch { /* best-effort on odd filesystems */ }
}

const LOCK_PATH = () => `${storePath()}.lock`;
const LOCK_STALE_MS = 30_000;
const LOCK_ATTEMPTS = 50;
const LOCK_SPIN_MS = 20;
function withStoreLock(fn) {
  const previousPin = pinnedStorePath;
  pinnedStorePath = integrationsStorePath();
  const path = LOCK_PATH();
  const held = acquireLock(path, {
    staleMs: LOCK_STALE_MS, label: 'integrations-store', attempts: LOCK_ATTEMPTS, spinMs: LOCK_SPIN_MS,
    onStale: (ageMs) => console.warn(`[integrations] breaking a stale store lock (${Math.round(ageMs / 1000)}s old) at ${path}`),
  });
  if (!held.ok) { pinnedStorePath = previousPin; throw new Error(`integrations store is locked by another process (${path}); try again`); }
  holdsStoreLock = true;
  try { return fn(); } finally { holdsStoreLock = false; held.release(); pinnedStorePath = previousPin; }
}

function assertKnownSource(name) {
  if (!isKnownSource(name)) throw new Error(`unknown integration source '${name}' — known: ${Object.keys(SOURCES).join(', ')}`);
}

/** Store (or replace) a source's key. The full value is written once and never echoed back whole. */
export function setSourceKey(name, key) {
  assertKnownSource(name);
  const k = String(key || '').trim();
  if (!k) throw new Error('key must not be empty');
  return withStoreLock(() => {
    const store = loadStore();
    store.sources[name] = { key: k, addedAt: new Date().toISOString() };
    saveStore(store);
    return { name, addedAt: store.sources[name].addedAt };
  });
}

export function removeSourceKey(name) {
  assertKnownSource(name);
  return withStoreLock(() => {
    const store = loadStore();
    const had = Boolean(store.sources[name]);
    delete store.sources[name];
    saveStore(store);
    return { name, removed: had };
  });
}

/**
 * The EFFECTIVE key for a source: an env override always wins over the stored value, read at CALL
 * time — a test or a headless run can set CW_VULNCHECK_KEY without touching the panel or the store
 * at all. Returns null when neither is set — callers treat that as "integration not configured",
 * never as an empty-but-valid credential.
 */
export function getSourceKey(name) {
  assertKnownSource(name);
  const envKey = process.env[SOURCES[name].envVar];
  if (envKey) return envKey;
  let store;
  try { store = loadStore(); } catch { return null; } // fail closed for a read: an unreadable store looks unconfigured to a caller that just wants a key, not a crash
  const rec = store.sources[name];
  return rec && rec.key ? rec.key : null;
}

const redact = (key) => (key.length <= 4 ? '••••' : `••••${key.slice(-4)}`);

/**
 * Every declared source, redacted, with WHERE its effective key comes from (env / stored / none) —
 * three states, not a boolean, because "configured" and "configured via which path" are different
 * facts an operator debugging a silent lane needs told apart.
 */
export function listSources() {
  let store;
  try { store = loadStore(); } catch { store = null; } // an unreadable store reports every source as unknown-state, not falsely absent
  return Object.entries(SOURCES).map(([name, meta]) => {
    const envKey = process.env[meta.envVar];
    if (envKey) return { name, label: meta.label, source: 'env', envVar: meta.envVar, key: redact(envKey) };
    if (store === null) return { name, label: meta.label, source: 'unknown', envVar: meta.envVar, key: null };
    const rec = store.sources[name];
    if (rec && rec.key) return { name, label: meta.label, source: 'stored', envVar: meta.envVar, key: redact(rec.key), addedAt: rec.addedAt };
    return { name, label: meta.label, source: 'none', envVar: meta.envVar, key: null };
  });
}

// For tests: a key that round-trips distinctly without being a real credential.
export const testKey = () => `test-${randomBytes(8).toString('hex')}`;
