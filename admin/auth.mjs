// commitwork admin — local user store, password hashing and TOTP second factor.
//
// The panel triggers sweeps and installs packages, and its only protection was the loopback bind;
// the OAuth flow beside it issues a session WITHOUT contacting any provider, so "logged in" meant
// nothing. Publishing through a tunnel needed a real front door.
//
// fact: loopback is deliberately NOT gated / anyone on this machine can run the CLI anyway, and gating it locks the operator out of a damaged store (expiry: if the panel ever binds off-loopback by default, prev: wrong)
// fact: the first user is mintable only from loopback and only while zero users exist / the window closes permanently on first write, so a published panel can never mint its own admin (expiry: never, prev: broken)
// fact: passwords are scrypt+per-user-salt, constant-time compared, and NOT recoverable / the recovery path is the second factor, not a reset (expiry: never, prev: not built)
// fact: TOTP recovery codes (RFC 6238) are single-use and stored hashed / a stolen users.json otherwise yields a usable code (expiry: never, prev: not built)
//
// Zero third-party dependencies — node:crypto covers scrypt, HMAC and constant-time compare, so the
// file guarding everything else has no supply-chain surface. The one non-builtin import is
// first-party: monitor/lockfile.mjs, this repo's single mutex (C2). It was a COPY of that algorithm
// before, sharing its bug and not its fixes.

import { randomBytes, randomInt, scrypt, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { authStorePath } from '../monitor/store-paths.mjs';
import { acquireLock, inspectLock, forceReleaseLock } from '../monitor/lockfile.mjs';
import { classifyFsError } from '../lib/win-path-safety.mjs'; // on Windows ENOENT also means "unusable path"
// First-party, and node:crypto underneath — the zero-third-party rule above still holds. Same
// direction as the lockfile import: one implementation, shared, rather than a copy per caller.
import { verifyRegistration, verifyAssertion } from '../lib/webauthn.mjs';

// THE STORE PATH IS RESOLVED AT CALL TIME, and PINNED for the duration of a locked operation.
//
// It was a module-load `const` reading CW_AUTH_STORE, which silently defeats any test that sets the
// variable afterwards — the test passes while operating on the operator's REAL credential store.
// Four test files here carry comments about working around it (a subprocess, or a dynamic import
// before the env is read), and the sibling module's version of the same shape wrote a live
// third-party key into the operator's real integrations store for about three minutes on
// 2026-09-01. An invariant documented in four places and enforced in none is held by convention.
//
// THE PIN IS THE PART THAT IS NOT OBVIOUS, and it is why a bare function would be worse than the
// const it replaces. A const made it impossible to read one store and write another; call-time
// resolution reintroduces exactly that, in a store where a lost write is a burned TOTP step or a
// spent recovery code with no undo. withStoreLock() resolves ONCE on entry and everything inside
// uses that answer, so an operation is atomic with respect to its target even though the module is
// not pinned to one. The previous value is saved and restored rather than cleared, so this stays
// correct if these ever nest.
// Re-exported so a caller outside this module can ask WHERE the store is without importing the
// leaf module directly, and — unlike the const it replaces — get an answer that is current.
export { authStorePath };
let pinnedStorePath = null;
const storePath = () => pinnedStorePath || authStorePath();

// Identity is an EMAIL, not a bare name. Two reasons: it is the only identifier that can also be
// matched against an SSO provider's verified address (so "sign in with Google" can be tied to a
// KNOWN account rather than letting any Google user in), and it avoids publishing a guessable
// account name — a login form pre-filled with `root` tells an attacker half the credential.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
const normEmail = (v) => String(v || '').trim().toLowerCase();

// scrypt cost. N=2^15 keeps a single verification near ~100ms on this class of machine: slow
// enough to make offline cracking expensive, fast enough that a login does not feel broken.
// maxmem MUST be set explicitly: scrypt needs ~128*N*r bytes = exactly 32 MiB here, which lands
// ON Node's default 32 MiB ceiling and fails with "memory limit exceeded". Leaving it implicit
// makes the cost parameter silently un-raisable.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };
const TOTP_STEP_S = 30;
const TOTP_DIGITS = 6;
// ±1 step tolerance: phone clocks drift, and a code that fails on a 3-second skew trains people
// to disable 2FA. Wider than ±1 starts meaningfully extending a stolen code's life.
const TOTP_WINDOW = 1;

// ── store ───────────────────────────────────────────────────────────────────────────────────
// `settings.allowExternalSso` gates REMOTE single-sign-on. It defaults to false so that binding an
// operator (which happens on this machine) never publishes a way in from outside as a side effect;
// opening that door stays a separate, deliberate act.
function emptyStore() { return { version: 1, users: [], settings: { allowExternalSso: false } }; }

// FAIL CLOSED on anything except a genuinely absent file. This used to return an empty store on any
// error, so a corrupt or unreadable users.json reported "no users" — REOPENING the bootstrap window
// this module closes permanently. Demonstrated: chmod 000 on a store holding an operator made
// needsBootstrap() true and the next bootstrap erased the account. ENOENT is the one honest empty;
// a parse failure, a permissions error, or a non-array `users` throws.
//
// ON WINDOWS, "ENOENT is the one honest empty" IS NOT TRUE, and this is the one place in the
// codebase where that costs an account. Measured 2026-09-04: a filename containing `< > " | ? *` or
// a control character fails with **ENOENT**, not EINVAL — and so does a path past MAX_PATH. Since
// storePath() is `CW_AUTH_STORE || <default>` and therefore operator-configurable, a mistyped or
// hostile value does not produce a loud error. It produces "no users", which is bootstrap mode:
// the panel offers to create a fresh operator, and the next bootstrap erases the real account. The
// exact window the paragraph above says this module closes permanently.
//
// classifyFsError() separates a real absence from an unusable path, so absence keeps meaning
// absence. See lib/win-path-safety.mjs for the measurements behind each code.
export function loadStore(path = storePath()) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') {
      const why = classifyFsError(e, path);
      if (why === 'absent') return emptyStore();
      throw new Error(`auth store at ${path} could not be read (${why} — the path itself is `
        + 'unusable, which is not the same as the store being absent); refusing to treat it as empty');
    }
    throw new Error(`auth store at ${path} is unreadable (${e.code}); refusing to treat it as empty`);
  }
  let s;
  try { s = JSON.parse(raw); }
  catch (e) { throw new Error(`auth store at ${path} is not valid JSON (${e.message}); refusing to treat it as empty`); }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`auth store at ${path} is not an object`);
  // `users` was never validated, so a store missing it threw a TypeError out of userCount() —
  // which serve.mjs calls on EVERY request outside any try/catch, killing the panel process.
  if (!Array.isArray(s.users)) throw new Error(`auth store at ${path} has no users array; refusing to guess`);
  // a store written before settings existed must not read as "external access allowed"
  if (!s.settings || typeof s.settings !== 'object') s.settings = { allowExternalSso: false };
  return s;
}

// 0600 + atomic rename: the file holds hashes and TOTP secrets, and a half-written store would
// lock the operator out of a panel whose whole point is to be reachable.
// Set when this process holds the store lock. saveStore refuses without it: the atomic write
// prevents a TORN file, not a LOST one, and a lost write here un-burns a single-use TOTP or
// recovery code — the replay protection silently reverting.
let holdsStoreLock = false;

/** Does THIS process hold the auth-store lock? For gates and tests. */
export const holdsAuthStoreLock = () => holdsStoreLock;

function saveStore(store) {
  if (!holdsStoreLock) {
    throw new Error(
      'refusing to save the auth store without its lock — wrap the load/mutate/save in '
      + 'withStoreLock(). An unlocked write loses a concurrent TOTP or recovery-code burn.',
    );
  }
  // ONE resolution for the whole write. mkdir, tmp, rename and chmod must name the same file, and
  // four separate calls could not if the env moved between them.
  const target = storePath();
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
  try { chmodSync(target, 0o600); } catch { /* best-effort on odd filesystems */ }
}

// ── read-modify-write serialisation ─────────────────────────────────────────────────────────
// fact: the write is atomic but the read-modify-write around it was not / a second process landing between loadStore() and saveStore() discards the first change (expiry: never, prev: broken)
// fact: the lost write is a BURNED TOTP step, a recovery code, or the external-SSO switch / two concurrent logins burn against the same snapshot, one burn vanishes, and replay protection is undone (expiry: never, prev: broken)
// Async login hashing runs outside this synchronous critical section; decisions are revalidated
// against the locked record before committing a single-use factor.
//
// C2: the mutex lives in monitor/lockfile.mjs. This module's former copy broke a stale lock with a
// bare rmdirSync, which for the loser of a takeover race removes the WINNER'S lock; the shared one
// compare-and-deletes through rename(2). What stays here is POLICY, and must not change:
//   · SYNCHRONOUS, busy-waiting. The read/decide/write callback never awaits.
//   · 50 attempts x ~20ms ~= one second before refusing.
//   · NO KDF INSIDE. See confirmTotp()/authenticate() — scrypt runs in an unlocked phase 1.
const LOCK_PATH = () => `${storePath()}.lock`;
const LOCK_STALE_MS = 30_000;   // generous: the critical section is one saveStore at most
const LOCK_ATTEMPTS = 50;
const LOCK_SPIN_MS = 20;
function withStoreLock(fn, targetPath = authStorePath()) {
  // PIN FIRST, then derive the lock from the pinned answer, so the lock and the store it guards
  // cannot end up naming different files.
  const previousPin = pinnedStorePath;
  pinnedStorePath = targetPath;
  const path = LOCK_PATH();
  const held = acquireLock(path, {
    staleMs: LOCK_STALE_MS, label: 'auth-store', attempts: LOCK_ATTEMPTS, spinMs: LOCK_SPIN_MS,
    // crashed holder — break it loudly, never silently
    onStale: (ageMs) => console.warn(`[auth] breaking a stale store lock (${Math.round(ageMs / 1000)}s old) at ${path}`),
  });
  if (!held.ok) { pinnedStorePath = previousPin; throw new Error(`auth store is locked by another process (${path}); try again`); }
  holdsStoreLock = true;
  // Clear before release so saveStore never believes a handed-on lock is held.
  try { return fn(); } finally { holdsStoreLock = false; held.release(); pinnedStorePath = previousPin; }
}

export const userCount = () => loadStore().users.length;
export const needsBootstrap = () => userCount() === 0;

// ── password hashing ────────────────────────────────────────────────────────────────────────
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const dk = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return { salt, hash: dk.toString('hex') };
}

function verifyPassword(password, salt, expectedHex) {
  const dk = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  const expected = Buffer.from(expectedHex, 'hex');
  // length check first: timingSafeEqual THROWS on a length mismatch, and an exception here would
  // read as a server error rather than a failed login.
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

// The same decision sequence serves synchronous CLI callers and asynchronous HTTP callers.
// Only KDF execution differs. A generator yields hashing inputs outside the store lock.
function runHashSteps(steps) {
  let next = steps.next();
  while (!next.done) {
    next = steps.next(Buffer.from(hashPassword(next.value.password, next.value.salt).hash, 'hex'));
  }
  return next.value;
}

async function runHashStepsAsync(steps) {
  let next = steps.next();
  while (!next.done) {
    const { password, salt } = next.value;
    const dk = await new Promise((resolve, reject) => {
      scrypt(password, salt, SCRYPT.keylen,
        { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem },
        (err, result) => err ? reject(err) : resolve(result));
    });
    next = steps.next(dk);
  }
  return next.value;
}

function matchesAuthSnapshot(target, snapshot, passwordProof) {
  return !!target && target.id === snapshot.id && target.email === snapshot.email
    && !!target.totpConfirmed === !!snapshot.totpConfirmed
    && (!snapshot.totpConfirmed || target.totpSecret === snapshot.totpSecret)
    && !!target.emailFactor === !!snapshot.emailFactor
    && (!passwordProof || (target.salt === passwordProof.salt && target.hash === passwordProof.hash));
}

function* passwordMatchesSteps(u, password) {
  // Unknown users and provider-only accounts pay the same KDF cost as password accounts.
  const dk = yield { password: String(password || ''), salt: u?.salt || 'x'.repeat(32) };
  const expected = Buffer.from(u?.hash || '', 'hex');
  return Boolean(u && u.salt && u.hash && dk.length === expected.length && timingSafeEqual(dk, expected));
}

// ── TOTP (RFC 6238) ─────────────────────────────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue; // tolerate spaces/hyphens people paste from an authenticator
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function totpAt(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', key).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac[offset] & 0x7f) << 24 | mac[offset + 1] << 16 | mac[offset + 2] << 8 | mac[offset + 3]) % 10 ** TOTP_DIGITS;
  return String(code).padStart(TOTP_DIGITS, '0');
}

// Verify across the tolerance window in CONSTANT time with respect to which step matched: compare
// every candidate rather than returning early, so response timing cannot reveal clock offset.
//
// Returns the MATCHED STEP (an integer counter) rather than a bare boolean, or null for no match.
// The caller needs the step to enforce single-use: RFC 6238 §5.2 requires that a validated OTP be
// rejected on its second presentation, and without the step there is nothing to record. `matched`
// is assigned inside the loop without breaking, so the constant-time property is unchanged.
export function verifyTotp(secretB32, token, nowMs = Date.now()) {
  const t = String(token || '').replace(/\D/g, '');
  if (t.length !== TOTP_DIGITS) return null;
  const counter = Math.floor(nowMs / 1000 / TOTP_STEP_S);
  let matched = null;
  for (let w = -TOTP_WINDOW; w <= TOTP_WINDOW; w++) {
    const step = counter + w;
    const expect = Buffer.from(totpAt(secretB32, step));
    const given = Buffer.from(t);
    if (expect.length === given.length && timingSafeEqual(expect, given)) matched = step;
  }
  return matched;
}

// the URI an authenticator app consumes (paste or QR). issuer/account only affect the label.
// The issuer is what an authenticator app shows as the entry's name, so it is spelled as the product.
export function otpauthUri(secretB32, account, issuer = 'Commitwork') {
  const p = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_S) });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${p}`;
}

// ── recovery codes ──────────────────────────────────────────────────────────────────────────
// Shown ONCE at bootstrap, stored hashed, single-use. They are the answer to "lost the phone",
// which is the failure mode that otherwise ends with someone disabling 2FA entirely.
function makeRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
}

function* replacementCredentialsSteps(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (yield { password: String(password), salt }).toString('hex');
  const recovery = makeRecoveryCodes();
  const recoveryHashes = [];
  for (const code of recovery) {
    recoveryHashes.push({ hash: (yield { password: code, salt }).toString('hex'), used: false });
  }
  return { salt, hash, recovery, recoveryHashes };
}

// ── bootstrap / login ───────────────────────────────────────────────────────────────────────
// Creates the root user. Callers MUST have already established that the request is loopback —
// this function enforces the "zero users" half of the window, not the "local" half.
export function bootstrapRoot({ email, password }) {
  return runHashSteps(bootstrapRootSteps({ email, password }, authStorePath()));
}

export function bootstrapRootAsync(options) {
  return runHashStepsAsync(bootstrapRootSteps(options, authStorePath()));
}

function* bootstrapRootSteps({ email, password }, path) {
  // Refuse cheaply when already initialized, then recheck under lock after all hashing.
  if (loadStore(path).users.length) throw new Error('bootstrap window is closed: a user already exists');
  const addr = normEmail(email);
  if (!isEmail(addr)) throw new Error('a valid email address is required');
  if (!password || String(password).length < 12) throw new Error('password must be at least 12 characters');
  const { salt, hash, recovery, recoveryHashes } = yield* replacementCredentialsSteps(password);
  const totpSecret = base32Encode(randomBytes(20)); // 160-bit, the RFC 4226 recommendation
  // The final zero-users check and write are one critical section. A losing attempt exposes no
  // generated secrets and cannot erase the operator another attempt just created.
  return withStoreLock(() => {
    const store = loadStore();
    if (store.users.length) throw new Error('bootstrap window is closed: a user already exists');
    store.users.push({
      id: randomBytes(8).toString('hex'),
      email: addr, salt, hash, totpSecret,
      // hashed, so a stolen store yields no usable code; `used` marks single-use consumption
      recovery: recoveryHashes,
      createdAt: new Date().toISOString(),
      totpConfirmed: false,
    });
    saveStore(store);
    // secret + plaintext codes are returned exactly once, to be shown and never stored by us
    return { email: addr, totpSecret, otpauth: otpauthUri(totpSecret, addr), recovery };
  }, path);
}

// fact: until `totpConfirmed` a login must NOT demand a code / a failed enrolment otherwise locks the only account out (expiry: never, prev: broken)
// fact: this route is under /auth/, which the login gate exempts, so it is reachable unauthenticated and remotely while MUTATING credential state — `totpConfirmed` and `lastTotpStep` (expiry: if /auth/ stops being exempt, prev: broken)
// fact: proof of ownership is therefore required / an unauthenticated caller who lands a valid code (10^6, no rate limiting) burns the step past the operator's own and holds a repeatable lockout (expiry: never, prev: broken)
//
// fact: the password is the proof, at the same scrypt cost as a login / a cheaper check here would make this route a cheaper oracle than the front door (expiry: never, prev: missing)
// fact: the KDF runs OUTSIDE the lock / withStoreLock() spins synchronously, so a ~100ms scrypt inside it blocks the single thread against every spinning caller and turns the lock into the denial-of-service the throttling exists to remove (expiry: if the lock stops busy-waiting, prev: broken)
// fact: phase 1 decides unlocked, phase 2 RE-READS under the lock before committing / the store may have moved during the ~100ms phase 1 spent hashing (expiry: never, prev: broken)
export function confirmTotp(email, password, token) {
  return runHashSteps(confirmTotpSteps(email, password, token, authStorePath()));
}

export function confirmTotpAsync(email, password, token) {
  return runHashStepsAsync(confirmTotpSteps(email, password, token, authStorePath()));
}

function* confirmTotpSteps(email, password, token, path) {
  // ── phase 1, UNLOCKED: prove ownership ────────────────────────────────────────────────────
  const snapshot = loadStore(path);
  const u = snapshot.users.find((x) => x.email === normEmail(email));
  const passOk = yield* passwordMatchesSteps(u, password);
  if (!u || !passOk) return false;
  if (!u.totpSecret) return false;

  // ── phase 2, LOCKED: re-read, re-decide, commit ───────────────────────────────────────────
  return withStoreLock(() => {
  const store = loadStore();
  // match by id, not by email: an address can in principle be rewritten between the phases,
  // and the identity phase 1 authenticated is the one that must be mutated here.
  const target = store.users.find((x) => x.id === u.id);
  if (!matchesAuthSnapshot(target, u, { salt: u.salt, hash: u.hash })
      || target.totpSecret !== u.totpSecret) return false;
  // An SSO-bootstrapped operator has NO totpSecret — the provider is its only factor. Passing
  // undefined into verifyTotp reaches base32Decode's .replace() and throws a TypeError, and this
  // route sits under /auth/, which the login gate exempts: an unauthenticated remote caller who
  // merely guesses the operator's address could take the panel down (serve.mjs installs no
  // uncaughtException handler). Refuse the same way an unknown account is refused.
  if (!target.totpSecret) return false;
  const step = verifyTotp(target.totpSecret, token);
  if (step === null) return false;
  // burn the enrolment code too: it is a validated OTP like any other. Re-checked against the
  // FRESH record: a concurrent login may have advanced the guard while phase 1 was hashing.
  if (target.lastTotpStep != null && step <= target.lastTotpStep) return false;
  target.lastTotpStep = step;
  target.totpConfirmed = true;
  saveStore(store);
  return true;
  }, path);
}

// -> { ok, user } | { ok:false, reason }
// `reason` is deliberately coarse for the caller to surface: distinguishing "no such user" from
// "wrong password" to an unauthenticated client is a username oracle.
export function authenticate({ email, password, token }) {
  return runHashSteps(authenticateSteps({ email, password, token }, authStorePath()));
}

export function authenticateAsync(credentials) {
  return runHashStepsAsync(authenticateSteps(credentials, authStorePath()));
}

function* authenticateSteps({ email, password, token }, path) {
  const snapshot = loadStore(path);
  const u = snapshot.users.find((x) => x.email === normEmail(email));
  // An SSO-bootstrapped account carries no salt/hash — the provider is its only factor. Verifying
  // against an absent hash would throw; treating it as a match would be catastrophic. Burn the
  // same scrypt cost and refuse, so a password attempt against an SSO account is indistinguishable
  // in time and in message from an attempt against an address that does not exist.
  const passOk = yield* passwordMatchesSteps(u, password);
  if (!u || !passOk) return { ok: false, reason: 'invalid credentials' };

  return yield* secondFactorSteps(u, token, path, { salt: u.salt, hash: u.hash });
}

/**
 * The SECOND FACTOR, on its own — TOTP or a recovery code, single-use, decided twice.
 *
 * Split out of authenticate() on 2026-09-01 so a caller that has proved identity by some OTHER
 * means can still be held to the account's enrolled factor. The first such caller is the OAuth
 * callback: completing a Google flow proved an identity and then minted a full session, so an
 * account with a confirmed authenticator was single-factor over SSO while being two-factor over
 * its own password form. The weaker path is the one that decides.
 *
 * It is EXTRACTED rather than reimplemented, and authenticate() now calls it, because everything
 * that makes this correct is easy to leave out of a second copy: the RFC 6238 single-use step
 * record, the recovery-code burn, and the locked re-read that catches a concurrent login spending
 * the same step in the ~100ms the first decision took. A second implementation of this would be a
 * second chance to omit one of them.
 *
 * @param {object} u a user record already loaded from the store
 * @param {string} token a TOTP code or a recovery code
 */
export function verifySecondFactor(u, token) {
  return runHashSteps(secondFactorSteps(u, token, authStorePath()));
}

export function verifySecondFactorAsync(u, token) {
  return runHashStepsAsync(secondFactorSteps(u && structuredClone(u), token, authStorePath()));
}

function* secondFactorSteps(u, token, path, passwordProof = null) {
  if (!u) return { ok: false, reason: 'invalid credentials' };
  // A standalone factor check needs no write when nothing is enrolled. After password hashing,
  // revalidate credentials and factor enrollment under the lock even for this branch.
  if (!u.totpConfirmed && !u.emailFactor) {
    if (!passwordProof) return { ok: true, user: { id: u.id, email: u.email }, factor: 'none' };
    return withStoreLock(() => {
      const target = loadStore().users.find(x => x.id === u.id);
      return matchesAuthSnapshot(target, u, passwordProof)
        ? { ok: true, user: { id: target.id, email: target.email }, factor: 'none' }
        : { ok: false, reason: 'invalid credentials' };
    }, path);
  }
  // fact: email code is the factor when TOTP is unconfirmed
  if (!u.totpConfirmed) return verifyEmailCodeAt(u, token, {}, path, passwordProof);

  // SINGLE USE (RFC 6238 §5.2): a code stays arithmetically valid for the whole ±1-step window,
  // so without recording the consumed step the same code authenticates repeatedly for ~90s.
  // Anyone who observes one — a proxy log, a shoulder-surf, a phished form — could replay it.
  const step = verifyTotp(u.totpSecret, token);          // HMAC, cheap
  // All recovery hashes share the user's salt: derive once, then compare the unused hashes.
  // Preserve the existing scrypt format and revalidate the matched entry under the lock.
  const recovery = u.recovery || [];
  const recoverySalt = u.salt;
  let recIdx = -1;
  if (step === null && recovery.some(r => !r.used)) {
    const dk = yield { password: String(token || ''), salt: recoverySalt };
    recIdx = recovery.findIndex(r => {
      if (r.used) return false;
      const expected = Buffer.from(r.hash, 'hex');
      return dk.length === expected.length && timingSafeEqual(dk, expected);
    });
  }
  const recoveryHash = recIdx === -1 ? null : recovery[recIdx].hash;
  // fact: an emailed code is accepted beside TOTP
  if (step === null && recIdx === -1) return u.emailFactor ? verifyEmailCodeAt(u, token, {}, path, passwordProof) : { ok: false, reason: 'invalid second factor' };

  // ── phase 2, LOCKED: re-read, re-decide against the fresh record, commit ──────────────────
  // The decision above rests on a snapshot that is now ~100ms old — one scrypt. A concurrent
  // login may have burned the same step or the same recovery code in that window, so the guard
  // is re-evaluated here, against the record actually on disk, before anything is written.
  return withStoreLock(() => {
    const store = loadStore();
    const target = store.users.find((x) => x.id === u.id);
    if (!matchesAuthSnapshot(target, u, passwordProof)) return { ok: false, reason: 'invalid credentials' };
    if (step !== null) {
      if (target.lastTotpStep != null && step <= target.lastTotpStep) {
        return { ok: false, reason: 'invalid second factor' }; // replayed (or an older step)
      }
      target.lastTotpStep = step;
      saveStore(store);
      return { ok: true, user: { id: target.id, email: target.email } };
    }
    const rec = (target.recovery || [])[recIdx];
    // `used` is re-read from disk, so the double-spend a concurrent login could have caused is
    // caught here rather than in the stale snapshot phase 1 matched against.
    if (!rec || rec.used || target.salt !== recoverySalt || rec.hash !== recoveryHash) {
      return { ok: false, reason: 'invalid second factor' };
    }
    rec.used = true;
    saveStore(store);
    return { ok: true, user: { id: target.id, email: target.email }, usedRecovery: true };
  }, path);
}

// ── EMAIL CODE — a second factor delivered by mail ─────────────────────────────────────────
// fact: HMAC over the user's salt, cheap under the lock
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_REISSUE_MS = 60 * 1000;
const emailCodeHash = (u, code) => createHmac('sha256', String(u.salt || u.id)).update(String(code || '')).digest('hex');
function emailCodeMatches(u, code) {
  const a = Buffer.from(emailCodeHash(u, code));
  const b = Buffer.from(String((u.emailCode && u.emailCode.hash) || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Switches the email factor on or off; off discards any waiting code
export function setEmailFactor(email, enabled) {
  return withStoreLock(() => {
    const store = loadStore();
    const u = store.users.find((x) => x.email === normEmail(email));
    if (!u) throw new Error(`no account for ${normEmail(email)}`);
    u.emailFactor = !!enabled;
    if (!enabled) delete u.emailCode;
    saveStore(store);
    return { email: u.email, emailFactor: u.emailFactor };
  });
}

// Mints a code for the caller to send; returned once, stored hashed
export function issueEmailCode(email, { nowMs = Date.now() } = {}) {
  return withStoreLock(() => {
    const store = loadStore();
    const u = store.users.find((x) => x.email === normEmail(email));
    if (!u) return { ok: false, reason: 'invalid credentials' };
    if (!u.emailFactor) return { ok: false, reason: 'email code is not enabled for this account' };
    if (u.emailCode && nowMs - u.emailCode.issuedAt < EMAIL_CODE_REISSUE_MS) {
      return { ok: false, reason: 'a code was sent less than a minute ago', retryAfterMs: EMAIL_CODE_REISSUE_MS - (nowMs - u.emailCode.issuedAt) };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    u.emailCode = { hash: emailCodeHash(u, code), issuedAt: nowMs, expiresAt: nowMs + EMAIL_CODE_TTL_MS, attempts: 0 };
    saveStore(store);
    return { ok: true, code, email: u.email, expiresAt: u.emailCode.expiresAt };
  });
}

// guard: single use, bounded attempts, expiry re-read under lock
export function verifyEmailCode(u, token, { nowMs = Date.now() } = {}) {
  return verifyEmailCodeAt(u, token, { nowMs }, authStorePath());
}

function verifyEmailCodeAt(u, token, { nowMs = Date.now() } = {}, path, passwordProof = null) {
  if (!u) return { ok: false, reason: 'invalid credentials' };
  if (!u.emailFactor) return { ok: false, reason: 'invalid second factor' };
  const t = String(token || '').trim();
  return withStoreLock(() => {
    const store = loadStore();
    const target = store.users.find((x) => x.id === u.id);
    if (!matchesAuthSnapshot(target, u, passwordProof) || !target.emailFactor) return { ok: false, reason: 'invalid credentials' };
    if (!t) return { ok: false, reason: 'second factor required', factor: 'email' };
    const c = target.emailCode;
    if (!c) return { ok: false, reason: 'no code is waiting — request a new one', factor: 'email' };
    if (nowMs > c.expiresAt || c.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      delete target.emailCode; saveStore(store);
      return { ok: false, reason: 'the code has expired — request a new one', factor: 'email' };
    }
    if (!/^\d{6}$/.test(t) || !emailCodeMatches(target, t)) {
      c.attempts += 1;
      if (c.attempts >= EMAIL_CODE_MAX_ATTEMPTS) delete target.emailCode;
      saveStore(store);
      return { ok: false, reason: 'invalid second factor', factor: 'email' };
    }
    delete target.emailCode;
    saveStore(store);
    return { ok: true, user: { id: target.id, email: target.email }, factor: 'email' };
  }, path);
}

// SSO gate. An OAuth provider proving "this is alice@example.com" is NOT authorisation: without
// this check any Google account on earth would satisfy the flow. Only an email already present in
// the store may sign in, so SSO authenticates an EXISTING account rather than creating one.
export function findByEmail(email) {
  const addr = normEmail(email);
  return loadStore().users.find((x) => x.email === addr) || null;
}

// ── SSO bootstrap + externalAccess switch ──────────────────────────────────────────────────
// fact: trust-on-first-use — the FIRST provider identity to complete an OAuth flow becomes the operator, and findByEmail() is the gate thereafter / the window closes on first write, as in bootstrapRoot(), so a published panel can never bind itself an admin (expiry: never, prev: broken)
// fact: the CALLER must have already established that the request is loopback / this function enforces the "zero users" half only, not the "local" half (expiry: never, prev: unknown)
//
// No password is set. The provider IS the factor here, and inventing a password nobody chose would
// be a credential the operator cannot rotate. `hash` is deliberately absent, and authenticate()
// refuses any account without one, so an SSO account can never be entered through the password
// form — including by someone who guesses the address.
export function bootstrapSsoRoot({ email, provider }) {
  return withStoreLock(() => {
    const store = loadStore();
    if (store.users.length) throw new Error('bootstrap window is closed: a user already exists');
    const addr = normEmail(email);
    if (!isEmail(addr)) throw new Error('the provider did not return a usable email address');
    store.users.push({
      id: randomBytes(8).toString('hex'),
      email: addr,
      sso: { provider: String(provider || 'unknown'), boundAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      // no salt/hash/totpSecret: this account exists only behind the provider
      totpConfirmed: false,
    });
    saveStore(store);
    return { email: addr, provider };
  });
}

// Is remote (non-loopback) SSO permitted? Read fresh on every check — the operator ticking the box
// must take effect on the next request, not on the next restart.
export const externalSsoAllowed = () => loadStore().settings.allowExternalSso === true;

export function setExternalSsoAllowed(enabled) {
  return withStoreLock(() => {
  const store = loadStore();
  store.settings.allowExternalSso = enabled === true;
  saveStore(store);
  return store.settings.allowExternalSso;
  });
}

// ── break-glass surface (R8a) ───────────────────────────────────────────────────────────────
// Recovery operations for `bin/panel-breakglass.mjs`. They live HERE, not in the CLI, so there is
// exactly one implementation of the store format and one implementation of the hashing. A CLI that
// re-derived either would eventually disagree with the panel about what a valid record looks like,
// and the first time anyone finds out would be during a lockout.
//
// There is no authentication on these functions and there should not be: their authorisation IS
// filesystem access to a 0600 file in the operator's home directory. Anything that can call them
// could equally well delete the store. What they must never become is a network surface — nothing
// in admin/serve.mjs may import them.

// Redacted roster. Never returns hashes, salts, TOTP secrets or recovery-code hashes.
export function listUsers() {
  return loadStore().users.map((u) => ({
    id: u.id,
    email: u.email,
    kind: u.sso ? `sso:${u.sso.provider}` : 'password',
    totpEnrolled: !!u.totpSecret,
    totpConfirmed: !!u.totpConfirmed,
    recoveryRemaining: (u.recovery || []).filter((r) => !r.used).length,
    createdAt: u.createdAt || null,
  }));
}

// Set a new password AND mint fresh recovery codes, returned once. Recovery codes are re-minted
// because they are salted with the user's salt, which changes here — leaving the old ones in place
// would leave records that can never validate again.
/**
 * WHICH FACTORS AN ACCOUNT ACTUALLY HOLDS, redacted for display.
 *
 * listUsers() reports a single `kind` of 'password' or 'sso:<provider>', which COLLAPSES a state
 * that matters here: binding a provider to an existing account sets `sso` without removing the
 * password, so `kind` says 'sso:google' about an account that also has one. The panel has to decide
 * whether to offer a password field or a provider bounce, and a collapsed answer sends half the
 * operators to the wrong control.
 *
 * Three-valued for the same reason listPasskeys is: `null` means the account could not be read, and
 * that is not the same as an account with no factors.
 */
export function accountFactors(email) {
  if (!email) return null;
  let store;
  try { store = loadStore(); } catch { return null; }
  const u = store.users.find((x) => x.email === normEmail(email));
  if (!u) return null;
  return {
    hasPassword: Boolean(u.salt && u.hash),
    sso: u.sso ? String(u.sso.provider) : null,
    totpEnrolled: Boolean(u.totpSecret),
    // Enrolled and confirmed are different answers — the panel says so about TOTP everywhere else.
    totpConfirmed: Boolean(u.totpConfirmed),
    emailFactor: Boolean(u.emailFactor),
    passkeys: (u.passkeys || []).length,
    recoveryRemaining: (u.recovery || []).filter((r) => !r.used).length,
  };
}

/** Verify the account's password without consuming a recovery code or requiring its second factor. */
export function reauthenticatePassword(email, password) {
  return runHashSteps(reauthenticatePasswordSteps(email, password, authStorePath()));
}

export function reauthenticatePasswordAsync(email, password) {
  return runHashStepsAsync(reauthenticatePasswordSteps(email, password, authStorePath()));
}

function* reauthenticatePasswordSteps(email, password, path) {
  let store;
  try { store = loadStore(path); } catch { return false; }
  const u = store.users.find((x) => x.email === normEmail(email));
  if (!(yield* passwordMatchesSteps(u, password))) return false;
  return withStoreLock(() => {
    const target = loadStore().users.find(x => x.id === u.id);
    return matchesAuthSnapshot(target, u, { salt: u.salt, hash: u.hash });
  }, path);
}

/**
 * Set or change a password on an account that already exists — the REGISTRATION path.
 *
 * resetPassword() below is a raw primitive with NO authorisation of its own: it takes an email and
 * a new password and writes. That is correct for bin/panel-breakglass.mjs, whose authority is
 * filesystem access to the 0600 store and which opens no socket. It is catastrophic to expose over
 * HTTP, so nothing did — and the consequence was that the panel had no way to set a password at
 * all. An operator who signed in with Google had no password, no route to make one, and therefore
 * no way to reach any credential-mutating action.
 *
 * THE GATE IS FRESH RE-AUTHENTICATION, NOT A SESSION. Setting a password is exactly as sensitive as
 * adding a passkey — it mints a credential that can sign in on its own — so it takes the same proof:
 * the current password, or a provider login completed within the caller's re-auth window. A stolen
 * cookie satisfies neither, which is the property that makes this safe to route.
 *
 * `current` is REQUIRED when the account already has a password and the caller has no fresh
 * re-auth. Changing a password you cannot demonstrate you hold is a takeover, not a change.
 */
export function setPassword({ email, current, newPassword, reauthenticated = false }) {
  return runHashSteps(setPasswordSteps({ email, current, newPassword, reauthenticated }, authStorePath()));
}

export function setPasswordAsync(options, stillAuthorized = () => true) {
  return runHashStepsAsync(setPasswordSteps(options, authStorePath(), stillAuthorized));
}

function* setPasswordSteps({ email, current, newPassword, reauthenticated = false }, path, stillAuthorized = () => true) {
  const snapshot = loadStore(path);
  const u = snapshot.users.find((x) => x.email === normEmail(email));
  const hasPassword = Boolean(u && u.salt && u.hash);
  const currentOk = yield* passwordMatchesSteps(u, current);
  // Unknown account burns the same KDF cost, so this is not an oracle for which addresses exist.
  if (!u) return { ok: false, reason: 'invalid credentials' };
  if (!reauthenticated && !(hasPassword && currentOk)) {
    return { ok: false, reason: hasPassword ? 'invalid credentials' : 'no password is set on this account; re-authenticate with the provider to set one' };
  }
  if (!newPassword || String(newPassword).length < 12) {
    return { ok: false, reason: 'password must be at least 12 characters' };
  }
  // Derive sequentially outside the lock. Rotating the salt requires fresh recovery hashes too.
  // Keep plaintext codes private to this attempt and return them only after a successful commit.
  const { salt, hash, recovery, recoveryHashes } = yield* replacementCredentialsSteps(newPassword);
  return withStoreLock(() => {
    const store = loadStore();
    const target = store.users.find(x => x.id === u.id);
    if (!matchesAuthSnapshot(target, u, { salt: u.salt, hash: u.hash }) || stillAuthorized() !== true) {
      return { ok: false, reason: 'invalid credentials' };
    }
    // Modify the fresh record, preserving concurrent changes to other fields and users.
    target.salt = salt; target.hash = hash; target.recovery = recoveryHashes;
    saveStore(store);
    return { ok: true, email: target.email, recovery, replaced: hasPassword };
  }, path);
}

export function resetPassword(email, newPassword) {
  return withStoreLock(() => {
    const store = loadStore();
    const u = store.users.find((x) => x.email === normEmail(email));
    if (!u) throw new Error(`no account for ${normEmail(email)}`);
    if (!newPassword || String(newPassword).length < 12) throw new Error('password must be at least 12 characters');
    const { salt, hash } = hashPassword(String(newPassword));
    u.salt = salt; u.hash = hash;
    const recovery = makeRecoveryCodes();
    u.recovery = recovery.map((c) => ({ hash: hashPassword(c, salt).hash, used: false }));
    saveStore(store);
    return { email: u.email, recovery };
  });
}

// ── linked identities (profile page) ───────────────────────────────────────────────────────
// A GitHub login shown on the profile page ("linked as @login") — DISPLAY ONLY. It is never a
// sign-in path: findByEmail()/authenticate() are the only gates that decide who may log in, and
// neither reads `github`. Linking merely lets the operator see, next to their account, which
// GitHub identity they have told the panel is theirs.
//
// `login` is UNTRUSTED input that lands in a JSON file and, from there, in the profile route's
// response and eventually the panel's DOM — so it is checked against GitHub's OWN rule for what a
// login can be (https://github.com/join: 1-39 chars, letters/digits/hyphen) before anything is
// written. Anything else is refused rather than sanitised: a login that fails GitHub's own rule
// was never a real login to begin with.
const GITHUB_LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;
/** Error code linkGithub throws when the GitHub id is already linked to a different user. */
export const GITHUB_LINKED_ELSEWHERE = 'GITHUB_LINKED_ELSEWHERE';

export function linkGithub(email, { login, id } = {}) {
  return withStoreLock(() => {
    const store = loadStore();
    const u = store.users.find((x) => x.email === normEmail(email));
    if (!u) throw new Error(`no account for ${normEmail(email)}`);
    if (!GITHUB_LOGIN_RE.test(String(login || ''))) {
      throw new Error('github login must be 1-39 characters of letters, digits or hyphens');
    }
    // GitHub user ids are positive integers; anything else did not come from the API response
    // this is meant to record, whatever the caller claims.
    if (!Number.isInteger(id) || id <= 0) throw new Error('github id must be a positive integer');
    // Keyed on the id, not the login: a login can be renamed and then taken by someone else.
    if (store.users.some((x) => x !== u && x.github && x.github.id === id)) {
      throw Object.assign(new Error('this GitHub account is already linked to another panel user'),
        { code: GITHUB_LINKED_ELSEWHERE });
    }
    u.github = { login: String(login), id, linkedAt: new Date().toISOString() };
    saveStore(store);
    return { email: u.email, github: u.github };
  });
}

// Unlink is idempotent — calling it on an account with nothing linked is a no-op, not an error,
// so the profile page never has to first ask "is anything linked" before offering the button.
export function unlinkGithub(email) {
  return withStoreLock(() => {
    const store = loadStore();
    const u = store.users.find((x) => x.email === normEmail(email));
    if (!u) throw new Error(`no account for ${normEmail(email)}`);
    delete u.github;
    saveStore(store);
    return { email: u.email };
  });
}

// Clear the second factor so the operator can re-enrol a new authenticator. This LOWERS the
// account's protection, which is the point of a break-glass tool, so it says so on the tin and
// the CLI requires an explicit confirmation before calling it.
export function disableTotp(email) {
  return withStoreLock(() => {
    const store = loadStore();
    const u = store.users.find((x) => x.email === normEmail(email));
    if (!u) throw new Error(`no account for ${normEmail(email)}`);
    delete u.totpSecret; delete u.lastTotpStep;
    u.totpConfirmed = false;
    saveStore(store);
    return { email: u.email };
  });
}

// Re-enrol: mint a fresh TOTP secret for an existing account and return the otpauth URI once.
export function reissueTotp(email) {
  return withStoreLock(() => {
    const store = loadStore();
    const u = store.users.find((x) => x.email === normEmail(email));
    if (!u) throw new Error(`no account for ${normEmail(email)}`);
    u.totpSecret = base32Encode(randomBytes(20));
    u.totpConfirmed = false;
    delete u.lastTotpStep;
    saveStore(store);
    return { email: u.email, totpSecret: u.totpSecret, otpauth: otpauthUri(u.totpSecret, u.email) };
  });
}

// Empty the store, reopening the bootstrap window. The single most destructive operation here.
export function removeAllUsers() {
  return withStoreLock(() => {
    const store = loadStore();
    const removed = store.users.length;
    store.users = [];
    saveStore(store);
    return { removed };
  });
}

// A crashed holder leaves the lock directory behind. withStoreLock() breaks a lock older than
// LOCK_STALE_MS on its own, so this is only for the impatient case — and it reports the age so the
// operator can see whether they are clearing a corpse or stealing from a live process.
// `stale` is computed against the same threshold acquisition uses, so what bin/panel-breakglass.mjs
// tells the operator matches what the next caller of withStoreLock() will actually do.
export function inspectStoreLock() {
  const s = inspectLock(LOCK_PATH(), { staleMs: LOCK_STALE_MS });
  return s.held ? { held: true, path: s.path, ageMs: s.ageMs, ageKnown: s.ageKnown, stale: s.stale } : { held: false, path: s.path };
}

// Still a compare-and-delete: it removes the lock it just observed, never "whatever is at that path
// by now". A plain rmdir here would ALSO now fail with ENOTEMPTY, because a lock directory carries
// its owner token — but the reason this goes through the shared primitive is the race, not the file.
export function releaseStoreLock() {
  const r = forceReleaseLock(LOCK_PATH());
  return r.released ? { released: true, path: r.path } : { released: false, reason: r.reason };
}

// ── passkeys (WebAuthn) ──────────────────────────────────────────────────────────────────────
// The third factor family, alongside password and TOTP. Verification lives in lib/webauthn.mjs —
// bytes in, verdict out, no state — so everything below is about the two things a verifier cannot
// decide for itself: WHICH ceremony a response belongs to, and WHOSE credential it is.
//
// fact: the relying-party policy is a PARAMETER, never an inference — `expectedRpId`/`expectedOrigins` come from the caller and this module never reads a request header / Host is caller-controlled, and an attacker-chosen RP ID means the assertion the panel accepts was signed for a site the attacker controls (expiry: never, prev: broken)
// fact: both this and serve.mjs's redirect check read the ONE allowlist, DECLARED_HOSTS from monitor/projects.json `deploy.hostnames` / a second derivation drifts out of agreement with the first (expiry: never, prev: duplicated)
//
// CHALLENGES LIVE IN MEMORY, DELIBERATELY. They are single-use, expire in two minutes, and never
// reach disk: a challenge in users.json would be one more secret-shaped thing to protect for no
// gain, and a process restart invalidating an in-flight ceremony costs the operator one retry.
const PASSKEY_CHALLENGE_TTL_MS = 120_000;
const passkeyChallenges = new Map();   // id -> { challenge, email, type, expires }

function issueChallenge(type, email) {
  const id = randomBytes(16).toString('hex');
  const challenge = randomBytes(32);
  // Opportunistic sweep: without it a panel that issues ceremonies nobody finishes grows this map
  // for the life of the process. Bounded by traffic, not by time, which is the cheap way here.
  const now = Date.now();
  for (const [k, v] of passkeyChallenges) if (v.expires <= now) passkeyChallenges.delete(k);
  passkeyChallenges.set(id, { challenge, email: email ? normEmail(email) : null, type, expires: now + PASSKEY_CHALLENGE_TTL_MS });
  return { challengeId: id, challenge: b64uEncode(challenge) };
}

// Consume is DESTRUCTIVE on every path that finds a record, including the expired one. A challenge
// that survives a failed attempt is a challenge an attacker may retry against, which is the whole
// reason it exists; expiry alone would leave a two-minute replay window after any error.
function consumeChallenge(challengeId, type) {
  const rec = passkeyChallenges.get(String(challengeId || ''));
  if (!rec) return { ok: false, reason: 'unknown or already-used challenge' };
  passkeyChallenges.delete(String(challengeId));
  if (rec.expires <= Date.now()) return { ok: false, reason: 'challenge expired — start again' };
  if (rec.type !== type) return { ok: false, reason: 'challenge was issued for a different ceremony' };
  return { ok: true, rec };
}

const b64uEncode = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Begin enrolment. Proof of ownership is required for the same reason confirmTotp() demands it:
 * this route mutates credential state, and /auth/ is exempt from the login gate, so it is reachable
 * unauthenticated. An ungated enrolment endpoint would let anyone who can reach the panel add their
 * own passkey to the operator's account — a complete takeover with no password ever learned.
 */
export function beginPasskeyRegistration(options) {
  return runHashSteps(beginPasskeyRegistrationSteps(options, authStorePath()));
}

export function beginPasskeyRegistrationAsync(options, stillAuthorized = () => true) {
  return runHashStepsAsync(beginPasskeyRegistrationSteps(options, authStorePath(), stillAuthorized));
}

function* beginPasskeyRegistrationSteps({ email, password, reauthenticated = false }, path, stillAuthorized = () => true) {
  const snapshot = loadStore(path);
  const u = snapshot.users.find((x) => x.email === normEmail(email));
  const passOk = yield* passwordMatchesSteps(u, password);

  // A PASSWORD IS NO LONGER THE ONLY PROOF, because for a whole class of operator it is not a
  // proof that exists.
  //
  // bootstrapSsoRoot() creates accounts with no salt and no hash — "this account exists only behind
  // the provider", in its own words. This function demanded `u.salt && u.hash`. So an operator who
  // signs in with Google could never enrol a passkey: the panel offered SSO as a first-class login
  // and a second factor that SSO users were structurally unable to reach. Found 2026-08-27 by the
  // operator saying "password doesn't work because I used OAuth to log in", after four other
  // defects in the enrolment path had been fixed without touching the wall.
  //
  // `reauthenticated` IS NOT "HAS A SESSION", and the distinction is the entire security of this.
  // The note above says an ungated enrolment lets anyone who reaches the panel add their own
  // passkey — that stays true, and a session cookie alone still buys nothing here. The caller may
  // only set this flag after the operator has PROVEN A CREDENTIAL AGAIN, within a short window:
  // a fresh provider login (prompt=login, so the IdP re-challenges rather than waving a live SSO
  // session through) or the password. A stolen cookie satisfies neither.
  //
  // The caller owns that check because only the caller knows the session; auth.mjs must not be
  // handed a session to inspect, or this module starts depending on the transport it protects.
  if (!u) return { ok: false, reason: 'invalid credentials' };
  if (!passOk && !reauthenticated) {
    return {
      ok: false,
      reason: (u.sso && !(u.salt && u.hash))
        // Naming the real state rather than "invalid credentials". This account HAS no password to
        // get wrong, so reporting a credential failure would send the operator to hunt for one.
        ? `this account signs in with ${u.sso.provider} and has no password — re-authenticate with the provider to enrol`
        : 'invalid credentials',
    };
  }

  return withStoreLock(() => {
    const target = loadStore(path).users.find(x => x.id === u.id);
    if (!matchesAuthSnapshot(target, u, { salt: u.salt, hash: u.hash })
        || (!passOk && stillAuthorized() !== true)) {
      return { ok: false, reason: 'invalid credentials' };
    }
    const { challengeId, challenge } = issueChallenge('create', target.email);
    return {
      ok: true, challengeId, challenge,
      user: { id: b64uEncode(Buffer.from(target.id, 'utf8')), name: target.email, displayName: target.email },
      excludeCredentials: (target.passkeys || []).map(p => p.credentialId),
    };
  }, path);
}

/** Finish enrolment. `rp` is { rpId, origins } supplied by the caller — see the note above. */
export function finishPasskeyRegistration({ challengeId, clientDataJSON, attestationObject, label, rp }) {
  const c = consumeChallenge(challengeId, 'create');
  if (!c.ok) return { ok: false, reason: c.reason };
  const v = verifyRegistration({
    clientDataJSON, attestationObject,
    expectedChallenge: c.rec.challenge,
    expectedOrigins: rp.origins,
    expectedRpId: rp.rpId,
  });
  if (!v.ok) return { ok: false, reason: `passkey rejected: ${v.reason}`, detail: v.detail };

  return withStoreLock(() => {
    const store = loadStore();
    const u = store.users.find((x) => x.email === c.rec.email);
    if (!u) return { ok: false, reason: 'account no longer exists' };
    u.passkeys = u.passkeys || [];
    // A credential id is globally unique per authenticator. Re-enrolling one must UPDATE rather
    // than append, or the stale row keeps an old signCount and every future assertion trips the
    // clone check against whichever copy is found first.
    const existing = u.passkeys.findIndex((p) => p.credentialId === v.credential.credentialId);
    const row = {
      ...v.credential,
      label: String(label || '').slice(0, 64) || `passkey ${(u.passkeys.length + 1)}`,
      addedAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    if (existing >= 0) u.passkeys[existing] = { ...u.passkeys[existing], ...row };
    else u.passkeys.push(row);
    saveStore(store);
    return { ok: true, credentialId: row.credentialId, label: row.label, count: u.passkeys.length };
  });
}

/**
 * Begin a passkey login. `email` is OPTIONAL: omitting it is the discoverable-credential
 * ("usernameless") flow, where the authenticator picks the account. When an email IS given the
 * allowCredentials list is returned — which necessarily discloses whether that account has
 * passkeys, so callers that care about account enumeration should prefer the discoverable flow.
 * Named here rather than hidden, because the disclosure is real and the trade is the caller's.
 */
export function beginPasskeyLogin({ email } = {}) {
  const { challengeId, challenge } = issueChallenge('get', email);
  let allowCredentials = [];
  if (email) {
    const u = loadStore().users.find((x) => x.email === normEmail(email));
    allowCredentials = (u?.passkeys || []).map((p) => p.credentialId);
  }
  return { ok: true, challengeId, challenge, allowCredentials };
}

/**
 * Finish a passkey login. A passkey is a SINGLE-FACTOR login by design: the authenticator already
 * bound possession, and platform authenticators add biometric or PIN user-verification on top. It
 * is not stacked on the password — demanding both would make the strongest factor the most
 * annoying one, and operators respond to that by turning it off.
 */
export function finishPasskeyLogin({ challengeId, credentialId, clientDataJSON, authenticatorData, signature, rp }) {
  const c = consumeChallenge(challengeId, 'get');
  if (!c.ok) return { ok: false, reason: c.reason };

  const snapshot = loadStore();
  const id = String(credentialId || '');
  // Find by CREDENTIAL, not by the email the caller claims: the credential id is what the signature
  // is bound to. Trusting a submitted email and then checking a signature from some other account's
  // key is the shape of an authentication bypass.
  const u = snapshot.users.find((x) => (x.passkeys || []).some((p) => p.credentialId === id));
  const cred = u && (u.passkeys || []).find((p) => p.credentialId === id);
  if (!u || !cred) return { ok: false, reason: 'unknown credential' };
  // If the ceremony named an account, the credential must belong to it — otherwise a challenge
  // issued for one operator could be completed with another's key.
  if (c.rec.email && u.email !== c.rec.email) return { ok: false, reason: 'credential does not belong to that account' };

  const v = verifyAssertion({
    clientDataJSON, authenticatorData, signature, credential: cred,
    expectedChallenge: c.rec.challenge,
    expectedOrigins: rp.origins,
    expectedRpId: rp.rpId,
  });
  if (!v.ok) return { ok: false, reason: `assertion rejected: ${v.reason}`, detail: v.detail };

  withStoreLock(() => {
    const store = loadStore();
    const su = store.users.find((x) => x.id === u.id);
    const sc = su && (su.passkeys || []).find((p) => p.credentialId === id);
    if (!sc) return;
    // Persisting the counter is what makes clone detection work at all — a verdict computed and
    // then dropped is a check that cannot fail on the second attempt.
    sc.signCount = v.signCount;
    sc.lastUsedAt = new Date().toISOString();
    saveStore(store);
  });
  return { ok: true, user: { id: u.id, email: u.email }, userVerified: v.userVerified, counterSupported: v.counterSupported };
}

/**
 * What is enrolled on an account.
 *
 * THREE-VALUED, and it was two. `u?.passkeys || []` collapsed "no such account" and "the store did
 * not read" into the same `[]` as "this account has none enrolled" — so an unknown email and a
 * corrupt store both reported, confidently, that there was nothing to revoke. That is the
 * absence-as-evidence shape this repo refuses everywhere else, sitting on the credential inventory.
 * `null` now means NOT ESTABLISHED and `[]` means MEASURED ZERO, and admin/index.html renders the
 * two differently because they are different facts.
 *
 * Never returns the public key or the counter: the panel lists what to revoke, and a credential
 * dump is material for an attacker enumerating which authenticators to target. `credentialId` IS
 * returned, because revoking names one and there is nothing else to name it by.
 */
export function listPasskeys(email) {
  if (!email) return null;
  let store;
  // Fail closed. An unreadable store is not an account with no passkeys.
  try { store = loadStore(); } catch { return null; }
  const u = store.users.find((x) => x.email === normEmail(email));
  if (!u) return null;
  return (u.passkeys || []).map((p) => ({
    credentialId: p.credentialId, label: p.label, addedAt: p.addedAt,
    lastUsedAt: p.lastUsedAt, uvAtRegistration: p.uvAtRegistration,
  }));
}

/**
 * Revoke one passkey. Refuses to remove the LAST remaining factor: an account whose password was
 * never set (SSO-bootstrapped) and whose only passkey is deleted is an account nobody can reach,
 * and this panel's bootstrap window has closed permanently by then. Locking the operator out of
 * their own box is the failure admin/auth.mjs's header rules out in its first design note.
 */
export function removePasskey(options) {
  return runHashSteps(removePasskeySteps(options, authStorePath()));
}

export function removePasskeyAsync(options, stillAuthorized = () => true) {
  return runHashStepsAsync(removePasskeySteps(options, authStorePath(), stillAuthorized));
}

function* removePasskeySteps({ email, credentialId, password, reauthenticated = false }, path, stillAuthorized = () => true) {
  const snapshot = loadStore(path);
  const u0 = snapshot.users.find((x) => x.email === normEmail(email));
  const passOk = yield* passwordMatchesSteps(u0, password);
  // Same widening as beginPasskeyRegistration, and it has to be the same or the pair is incoherent:
  // an SSO operator who can enrol but can never revoke is worse than one who can do neither, because
  // the credential they cannot remove is the one they were encouraged to add.
  if (!u0) return { ok: false, reason: 'invalid credentials' };
  if (!passOk && !reauthenticated) {
    return {
      ok: false,
      reason: (u0.sso && !(u0.salt && u0.hash))
        ? `this account signs in with ${u0.sso.provider} and has no password — re-authenticate with the provider to revoke`
        : 'invalid credentials',
    };
  }

  return withStoreLock(() => {
    const store = loadStore(path);
    const u = store.users.find(x => x.id === u0.id);
    if (!matchesAuthSnapshot(u, u0, { salt: u0.salt, hash: u0.hash })
        || (!passOk && stillAuthorized() !== true)) return { ok: false, reason: 'invalid credentials' };
    const before = (u.passkeys || []).length;
    const hasPassword = Boolean(u.salt && u.hash);
    if (!hasPassword && before <= 1) {
      return { ok: false, reason: 'refusing to remove the only way into this account — set a password first' };
    }
    u.passkeys = (u.passkeys || []).filter((p) => p.credentialId !== String(credentialId || ''));
    if (u.passkeys.length === before) return { ok: false, reason: 'no such passkey' };
    saveStore(store);
    return { ok: true, remaining: u.passkeys.length };
  }, path);
}
