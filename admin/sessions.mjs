// admin/sessions.mjs — panel sessions that survive a restart, without putting a bearer token on disk.
//
// THE PROBLEM. `oauthSessions` in serve.mjs is a Map in process memory, so every restart evicted
// every session. That is invisible until you press the panel's own "update" button, which restarts
// the process on purpose: the operator asks the panel to load new code and the panel answers by
// logging them out. The same shape as the health record in serve.mjs's `jobs` — an in-memory store
// whose loss is indistinguishable from something meaningful having happened.
//
// WHY THIS IS SAFE TO PUT ON DISK, WHICH IS THE ONLY INTERESTING QUESTION HERE.
// A session id IS a bearer token: whoever holds it is the operator, no password required. Writing a
// table of live session ids to a file would mean any read of that file — a backup, a stray `cat`, a
// path-traversal bug in some unrelated route — hands over the panel.
//
// So the id is never written. The file is keyed by sha256(sid) and the raw id exists only in two
// places: the operator's cookie, and this process's memory. A reader of this file learns that N
// sessions exist and which accounts they belong to, and cannot forge one, because turning the hash
// back into a cookie is the preimage problem. This is the same reason users.json holds scrypt
// hashes rather than passwords, applied to the other credential in the system.
//
// NO PLAIN HMAC-SIGNED-COOKIE ALTERNATIVE. A stateless signed cookie would also survive a restart
// and would need no file at all — but it moves revocation off the server. Logging out, and the
// "evict everyone" lever below, both stop being possible without a denylist, which is a session
// table with extra steps. For a panel that triggers sweeps and installs packages, being able to
// end a session is worth more than being able to avoid a file.
//
// WHAT IS DELIBERATELY NOT PERSISTED: the provider access token. When a real OAuth exchange runs,
// serve.mjs holds Google's access token in the session record. That is a live third-party
// credential and it does not go to disk under any circumstances — a restart drops it, and the
// session survives without it, because what the panel needs from a session is WHO, not a token it
// makes no further calls with.
//
// FAIL CLOSED HERE MEANS EMPTY, WHICH IS THE OPPOSITE OF auth.mjs — say it out loud, because the
// two files sit beside each other and follow contradictory-looking rules for the same word. In
// auth.mjs an unreadable users.json must NOT read as "no users", because zero users reopens the
// bootstrap window and lets anyone mint an operator: there, empty is the PERMISSIVE answer and
// loadStore() throws. Here an unreadable session file reading as "no sessions" logs everybody out
// and admits nobody: empty is the RESTRICTIVE answer. Same principle — refuse in the safe
// direction — and it points opposite ways because the stores mean opposite things.
//
// SINGLE WRITER, AND THAT IS AN ASSUMPTION RATHER THAN A GUARANTEE — stated because the failure is
// silent. persistSessions() writes a full dump of one process's memory, so two panels sharing a home
// directory are last-writer-wins: panel B holding a stale copy could flush a session that panel A
// had just logged out, and the logout would come back. There is normally exactly one panel (the
// published and operator ports are two listeners in ONE process), and a restart is ordered — the
// outgoing process flushes and exits before its successor loads — so the window needs a second
// panel started by hand against the same home. If that ever becomes normal, this needs
// monitor/lockfile.mjs and a reload-merge rather than a dump, and the dump is not safe to keep.
// Use CW_SESSION_STORE to give a scratch instance its own file; every test here does.
//
// env: CW_SESSION_STORE overrides the path, read at CALL time so a test that sets it after import
// is actually obeyed.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

/**
 * Beside users.json, in the operator's home — never inside the repo, where it could be committed.
 *
 * IT FOLLOWS THE AUTH STORE, and that is the whole point of the middle branch. The first cut read
 * only CW_SESSION_STORE and otherwise went straight to the home directory, which meant every test
 * that boots a panel — and several do — wrote its FIXTURE sessions into the operator's real
 * ~/.commitwork/sessions.json. Caught by looking at the file rather than by any test: five rows for
 * accounts that exist nowhere but a test fixture, timestamped across the run. Nothing failed,
 * because leaking into a file only this module reads produces no symptom until the day the panel
 * restores a session for an account that does not exist.
 *
 * The fix is not "remember to set a second variable in every test" — that is a rule enforced by
 * memory, and this repo has a name for those. A session table and the account store it references
 * are one trust domain: a session naming a user from a different users.json is incoherent, so the
 * two paths should never have been independently defaulted. Redirect the auth store and the
 * sessions follow it, automatically, including in tests written by anyone who never reads this file.
 *
 * Derived from the auth store's full name, not just its directory, so two fixtures sharing /tmp get
 * two session files rather than quietly sharing one.
 */
export const sessionStorePath = () => {
  if (process.env.CW_SESSION_STORE) return resolve(process.env.CW_SESSION_STORE);
  const auth = process.env.CW_AUTH_STORE;
  if (auth) return `${resolve(auth).replace(/\.json$/i, '')}.sessions.json`;
  return join(homedir(), '.commitwork', 'sessions.json');
};

// Bumped when the record shape changes. A mismatch drops every session rather than guessing at an
// older layout: the cost is one sign-in, and the alternative is a half-understood record deciding
// who is authenticated.
const VERSION = 1;

/** The disk key for a session id. The id itself is never stored, logged or returned. */
export const sessionKey = (sid) => createHash('sha256').update(String(sid), 'utf8').digest('hex');

/** Fields that may be written. An allowlist, so a token added to the record later cannot leak by
 *  default — a new field has to be named here to reach the disk, and `token` never will be. */
const PERSISTED = ['provider', 'user', 'createdAt', 'lastSeenAt'];

function redact(rec) {
  const out = {};
  for (const k of PERSISTED) if (rec[k] !== undefined) out[k] = rec[k];
  return out;
}

/**
 * Load into a Map keyed by sessionKey(sid) — the same key the in-memory store uses, so the two
 * forms are one thing rather than two that have to be kept in step.
 *
 * EXPIRY IS ENFORCED HERE, so a restart cannot extend a session. Without this check, bouncing the
 * process would refresh every idle session's lease, and the restart button would quietly become a
 * way to keep a stale session alive forever.
 */
export function loadSessions({ ttlMs, now = Date.now(), knownUsers, onNote = () => {} } = {}) {
  const path = sessionStorePath();
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    // ENOENT is the honest empty: no restart has ever persisted anything here.
    if (e.code !== 'ENOENT') onNote(`session store at ${path} is unreadable (${e.code}); starting with no sessions — everyone must sign in again`);
    return { sessions: new Map(), restored: 0, dropped: 0 };
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) {
    onNote(`session store at ${path} is not valid JSON (${e.message}); starting with no sessions`);
    return { sessions: new Map(), restored: 0, dropped: 0 };
  }
  if (!doc || typeof doc !== 'object' || doc.version !== VERSION || !doc.sessions || typeof doc.sessions !== 'object') {
    onNote(`session store at ${path} is version ${doc && doc.version} (expected ${VERSION}); dropping it`);
    return { sessions: new Map(), restored: 0, dropped: 0 };
  }
  // WHOSE SESSIONS ARE THESE? The account store is the authority; this table only refers to it.
  // Persisting sessions took away a revocation nobody had designed but everybody had: while the
  // table lived in memory, deleting a user and restarting the panel ENDED their sessions, because
  // the restart ended all of them. Measured after the change: remove every user, restart, and a
  // session naming the deleted account is restored and still authenticates — while userCount() is
  // 0, so needsBootstrap() is true and the bootstrap window has reopened at the same moment.
  //
  // So the join is done here, at the only point a session re-enters the world. Revocation is back
  // to exactly what it was: effective at the next restart or at idle expiry, whichever comes first,
  // and NOT instantly — a per-request check would mean reading the auth store on every request,
  // which is a price this does not justify. Stating the bound rather than implying a stronger one.
  //
  // ABSENT knownUsers MEANS DROP. It is the restrictive direction, and it is the one this module
  // already argues for at the top: here, empty means everybody signs in again. A caller that
  // forgets to pass the set loses sessions and notices; a default of "keep" would restore sessions
  // nobody validated and nobody would notice at all.
  const known = knownUsers instanceof Set ? knownUsers
    : (Array.isArray(knownUsers) ? new Set(knownUsers) : new Set());
  const sessions = new Map();
  let dropped = 0, orphaned = 0;
  for (const [k, v] of Object.entries(doc.sessions)) {
    // A key that is not a sha256 hex digest did not come from sessionKey(). Refuse it rather than
    // loading it: the only way one gets here is a hand-edited or corrupt file.
    if (!/^[0-9a-f]{64}$/.test(k) || !v || typeof v !== 'object') { dropped++; continue; }
    const last = Number(v.lastSeenAt ?? v.createdAt);
    if (!Number.isFinite(last) || now - last > ttlMs) { dropped++; continue; }
    // A session with no user cannot be checked against the account store, so it is not restored.
    // Unverifiable is not the same as valid.
    if (!v.user || !known.has(String(v.user).trim().toLowerCase())) { orphaned++; continue; }
    sessions.set(k, redact(v));
  }
  if (orphaned) onNote(`dropped ${orphaned} session(s) whose account no longer exists in the auth store`);
  return { sessions, restored: sessions.size, dropped: dropped + orphaned, orphaned };
}

// Throttle. `lastSeenAt` moves on every authenticated request, and writing the file that often
// would be a syscall per request for a field nobody reads until the next boot. Traffic-driven
// rather than a timer: no interval to keep the event loop alive, nothing to unref, and a process
// serving nobody writes nothing.
const FLUSH_INTERVAL_MS = 60 * 1000;
let lastWriteAt = 0;

/**
 * Write the table. `force` for the writes that must not be lost — minting a session, ending one,
 * and the flush immediately before a restart. Everything else is throttled.
 *
 * Returns true if it wrote. Never throws: failing to persist must not take down a request. A panel
 * that cannot write this file still works — it just goes back to losing sessions on restart, which
 * is where it started, and it says so.
 */
export function persistSessions(sessions, { force = false, now = Date.now(), onNote = () => {} } = {}) {
  if (!force && now - lastWriteAt < FLUSH_INTERVAL_MS) return false;
  const path = sessionStorePath();
  const doc = { version: VERSION, sessions: {} };
  for (const [k, v] of sessions) doc.sessions[k] = redact(v);
  try {
    mkdirSync(dirname(path), { recursive: true });
    // 0600 + tmp/rename, the same discipline as the auth store: a half-written session table would
    // log the operator out, and the mode is what keeps it to this account.
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    try { chmodSync(path, 0o600); } catch { /* best-effort on odd filesystems */ }
    lastWriteAt = now;
    return true;
  } catch (e) {
    onNote(`could not persist sessions to ${path} (${e.message}) — sessions will not survive the next restart`);
    return false;
  }
}

/**
 * The evict-everyone lever, and it needs to exist BY NAME.
 *
 * Before this module, restarting the panel ended every session as a side effect. That was never a
 * designed control, but it was a real one, and persisting sessions removes it — so the capability
 * has to come back deliberately rather than be quietly lost. Deleting the file and clearing the map
 * is "sign everybody out, now", including whoever is holding a session you did not issue.
 */
export function evictAllSessions(sessions, { onNote = () => {} } = {}) {
  const n = sessions.size;
  sessions.clear();
  const path = sessionStorePath();
  try { unlinkSync(path); } catch (e) { if (e.code !== 'ENOENT') onNote(`could not remove ${path}: ${e.message}`); }
  lastWriteAt = 0;
  return n;
}

/** Test seam: the throttle is module state, and a test that writes twice in a millisecond needs to
 *  be able to say so. Not exported into any runtime path. */
export function _resetFlushThrottle() { lastWriteAt = 0; }
