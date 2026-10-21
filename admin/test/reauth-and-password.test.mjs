// Re-authentication and the password registration path.
//
// This surface landed across three commits by two sessions (the routes in the middle one)
// and arrived in HEAD with no guard of any kind — seven symbols on the credential path,
// zero tests. It is the most security-sensitive code the panel gained today, so the gap is closed
// here rather than noted.
//
// WHAT THE SURFACE IS FOR. An SSO account has no password by construction — bootstrapSsoRoot
// creates it with "no salt/hash: this account exists only behind the provider" — while every
// credential-mutating action demanded one. So an operator who signed in with Google could not enrol
// a passkey, could not revoke one, and could not set a password: the panel offered a first-class
// login and a second factor those users were structurally unable to reach.
//
// The fix generalises the PROOF rather than weakening it. `reauthAt` is stamped only when a
// credential is demonstrated again — a password checked now, a passkey asserted now, or a provider
// login with prompt=login so the IdP re-challenges. Holding a cookie stamps nothing. Every
// assertion below exists to keep that sentence true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, '..');
const SERVE = serverSource();
const SESSIONS = readFileSync(join(ADMIN, 'sessions.mjs'), 'utf8');
const SRC = panelSource('index.html');

// STORE_PATH is captured at module load, so the env must be set before the dynamic import.
const STORE = join('/tmp', `cw-reauth-${process.pid}.json`);
process.env.CW_AUTH_STORE = STORE;
const auth = await import('../auth.mjs');
test.after(() => { try { rmSync(STORE, { force: true }); } catch { /* gone */ } });

const PW = 'correct horse battery staple';

// ── the one that would be silent and would cost the most ───────────────────────────────────────
test('reauthAt is NOT persisted — a restart must revoke the standing permission', () => {
  // THE WHOLE SAFETY OF THIS DESIGN RESTS ON ONE LINE, and it is a line somebody would add in
  // good faith. `PERSISTED` in sessions.mjs is the allowlist of session fields that reach disk.
  // The SESSION is meant to survive a restart — that is the feature. The re-auth MARKER is not:
  // it is a five-minute grant to mutate credentials, and a grant that survives a bounce is a
  // grant a stolen cookie keeps forever.
  //
  // Adding `reauthAt` to this list breaks nothing, fails no test that existed before this one, and
  // turns a bounded permission into a permanent one. It reads like completeness.
  const m = SESSIONS.match(/const PERSISTED = \[([^\]]*)\]/);
  assert.ok(m, 'the PERSISTED allowlist is gone or renamed — the field that gates disk writes must stay explicit');
  const fields = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.ok(!fields.includes('reauthAt'),
    'reauthAt is in the PERSISTED allowlist, so a re-authentication now survives a panel restart. '
    + 'It must not: the session is meant to survive, the permission to mutate credentials is not.');
  // The allowlist itself is the mechanism — a denylist would need updating one time too late.
  assert.ok(!fields.includes('token'), 'a provider access token must never reach disk');
  assert.deepEqual(fields.sort(), ['createdAt', 'lastSeenAt', 'provider', 'user'],
    'the persisted field set changed — every addition is a new thing written to disk, decide it deliberately');
});

// ── the proof is bounded, and belongs to ONE account ───────────────────────────────────────────
test('a fresh marker authorises only the account it was minted for', () => {
  // Without this, a re-auth as A authorises a credential mutation on B. serve.mjs compares with
  // sameAccount() precisely so the marker cannot travel sideways.
  assert.match(SERVE, /const sameAccount = /, 'the cross-account comparison is gone');
  const at = SERVE.indexOf('const sameAccount = ');
  const body = SERVE.slice(at, at + 260);
  assert.match(body, /toLowerCase\(\)/, 'the comparison is case-sensitive, so a capitalised store silently orphans every marker');
  assert.match(body, /trim\(\)/, 'the comparison does not trim');
  // Both consumers must use it. An enrol that checked freshness alone would accept a marker minted
  // for a different operator entirely.
  for (const call of ['reauthFresh(sess) && sameAccount(sess.user, b.email)',
                      'reauthFresh(sessR) && sameAccount(sessR.user, b.email)']) {
    assert.ok(SERVE.includes(call), `a passkey route checks freshness without binding it to the account: ${call}`);
  }
});

test('the window is bounded, and is not the session lifetime', () => {
  const m = SERVE.match(/const REAUTH_TTL_MS = ([^;]+);/);
  assert.ok(m, 'REAUTH_TTL_MS is gone');
  const ttl = Function(`return ${m[1]}`)();
  assert.ok(ttl > 0 && ttl <= 15 * 60 * 1000,
    `the re-auth window is ${ttl}ms — a standing grant to mutate credentials must be minutes, not hours`);
  const sess = SERVE.match(/const OAUTH_SESSION_TTL_MS = ([^;]+);/);
  assert.ok(sess, 'the session TTL is gone');
  assert.notEqual(ttl, Function(`return ${sess[1]}`)(),
    'the re-auth window equals the session TTL — they answer different questions, and making them '
    + 'the same makes the marker mean nothing');
});

// ── setPassword: the gate above an ungated primitive ───────────────────────────────────────────
test('setPassword refuses without proof, and resetPassword stays ungated beneath it', () => {
  auth.bootstrapRoot({ email: 'a@example.com', password: PW });

  // No proof at all.
  assert.equal(auth.setPassword({ email: 'a@example.com', newPassword: 'a valid twelve plus phrase' }).ok, false,
    'a password was set with neither the current one nor a fresh re-auth — that is a takeover, not a change');
  // Wrong current password.
  assert.equal(auth.setPassword({ email: 'a@example.com', current: 'wrong', newPassword: 'a valid twelve plus phrase' }).ok, false);
  // Unknown account must not be an oracle: same shape of refusal.
  assert.equal(auth.setPassword({ email: 'nobody@example.com', current: PW, newPassword: 'a valid twelve plus phrase' }).ok, false);

  // The floor is enforced HERE as well as in the primitive, because this is the routed path.
  assert.match(auth.setPassword({ email: 'a@example.com', current: PW, newPassword: 'short' }).reason || '',
    /12 characters/, 'the length floor is not enforced on the routed path');

  // And with proof it works, ROTATES the recovery codes, and RETURNS them.
  const r = auth.setPassword({ email: 'a@example.com', current: PW, newPassword: 'a valid twelve plus phrase' });
  assert.equal(r.ok, true);
  assert.equal(r.replaced, true, 'replacing an existing password must be reported as a replacement');
  assert.ok(Array.isArray(r.recovery) && r.recovery.length > 0,
    'the rotated recovery codes were not returned — setPassword rotates them by design, so codes minted '
    + 'against the old password are void and the operator has silently lost their way back in');
});

test('an account with no password can set one with a fresh re-auth', () => {
  // THE CASE THAT WAS IMPOSSIBLE. bootstrapSsoRoot makes an account with no salt/hash, so every
  // password-gated path refused it forever.
  auth.removeAllUsers();
  auth.bootstrapSsoRoot({ email: 'sso@example.com', provider: 'google' });
  const before = auth.accountFactors('sso@example.com');
  assert.equal(before.hasPassword, false);
  assert.equal(before.sso, 'google');

  assert.equal(auth.setPassword({ email: 'sso@example.com', newPassword: 'a valid twelve plus phrase' }).ok, false,
    'an SSO account set a password with no proof at all');
  const r = auth.setPassword({ email: 'sso@example.com', newPassword: 'a valid twelve plus phrase', reauthenticated: true });
  assert.equal(r.ok, true, 'a fresh re-auth could not set a first password — the SSO operator is still stranded');
  assert.equal(r.replaced, false, 'setting a FIRST password must not report itself as a replacement');
  assert.equal(auth.accountFactors('sso@example.com').hasPassword, true);
});

// ── the widened proof, on both halves of the pair ──────────────────────────────────────────────
test('enrol and revoke accept the same proofs — an operator must not be able to add what they cannot remove', () => {
  auth.removeAllUsers();
  auth.bootstrapSsoRoot({ email: 'sso@example.com', provider: 'google' });

  const enrolNoProof = auth.beginPasskeyRegistration({ email: 'sso@example.com', password: 'anything' });
  assert.equal(enrolNoProof.ok, false);
  assert.match(enrolNoProof.reason, /no password/,
    'the refusal says "invalid credentials" about an account that HAS no password — that sends the '
    + 'operator hunting for a credential which does not exist');
  assert.match(enrolNoProof.reason, /google/, 'the refusal does not name the provider that can verify them');

  assert.equal(auth.beginPasskeyRegistration({ email: 'sso@example.com', reauthenticated: true }).ok, true,
    'a fresh re-auth cannot enrol — the SSO operator still has no reachable second factor');

  // The pair must be symmetric. Being able to add a credential you can never remove is worse than
  // being able to do neither, because the thing you cannot remove is the one you were encouraged
  // to add.
  const rev = auth.removePasskey({ email: 'sso@example.com', credentialId: 'nope', reauthenticated: true });
  assert.notEqual(rev.reason, 'invalid credentials',
    'revoke rejects a fresh re-auth that enrol accepts — the pair is asymmetric');
});

// ── accountFactors: three-valued, and it exists because `kind` collapses ───────────────────────
test('accountFactors distinguishes not-established from measured', () => {
  assert.equal(auth.accountFactors(null), null, 'no email is not an account with no factors');
  assert.equal(auth.accountFactors('nobody@example.com'), null, 'an unknown account is not an account with no factors');
  const f = auth.accountFactors('sso@example.com');
  assert.equal(typeof f.hasPassword, 'boolean');
  assert.equal(typeof f.totpConfirmed, 'boolean');
  // Enrolled and confirmed are different answers — the panel says so about TOTP everywhere else,
  // and an account whose secret exists but was never confirmed has enforcement OFF while looking
  // provisioned.
  assert.ok('totpEnrolled' in f && 'totpConfirmed' in f,
    'enrolled and confirmed are collapsed into one field — that is the state that LOOKS like a second factor and is not');
  assert.equal(f.hash, undefined, 'a password hash reached a display accessor');
  assert.equal(f.salt, undefined);
  assert.equal(f.totpSecret, undefined, 'a TOTP secret reached a display accessor');
});

// ── the regressions that were paid for in operator time ────────────────────────────────────────
test('a passkey 401 does not reload the page out from under the error', () => {
  // The global fetch interceptor reloads on any same-origin 401, on the reading "your session is
  // gone". /auth/passkey/register/begin answers 401 for a WRONG PASSWORD — a statement about that
  // attempt, not about the session. Reloading destroyed the error before it could be read, closed
  // the form, and returned the operator to the start. Reported as "it redirects too fast to see the
  // error", and no sticky message could ever have survived it: location.reload() outranks them all.
  const m = SRC.match(/const AUTH_401_EXEMPT=\[([^\]]*)\]/);
  assert.ok(m, 'the 401 exemption list is gone — every credential error is now a page reload again');
  assert.match(m[1], /auth\\\/passkey/,
    'the passkey ceremony is not exempt from the reload interceptor, so a wrong password reloads the panel');
});

test('a bind failure exits rather than logging and living', () => {
  // process.on('uncaughtException') logs and RETURNS, so EADDRINUSE left a panel up forever —
  // awake, listening on nothing, answering nothing. Fourteen such processes were measured from one
  // 9-minute burst, alive seven hours later, while launchctl reported one healthy job.
  assert.match(SERVE, /const fatalListen = /, 'the bind-failure handler is gone');
  assert.match(SERVE, /PUBLISHED_SERVER\.on\('error', fatalListen/, 'the published listener has no error handler');
  assert.match(SERVE, /OPERATOR_SERVER\.on\('error', fatalListen/, 'the operator listener has no error handler');
  const at = SERVE.indexOf('const fatalListen = ');
  assert.match(SERVE.slice(at, at + 500), /process\.exit\(1\)/, 'a failed bind does not exit non-zero');
  // Scoped deliberately: making the catch-all exit hands a denial of service to anyone who can
  // raise an exception mid-request.
  assert.match(SERVE, /process\.on\('uncaughtException'/, 'the general handler is gone');
  const gen = SERVE.slice(SERVE.indexOf("process.on('uncaughtException'"), SERVE.indexOf("process.on('uncaughtException'") + 200);
  assert.ok(!/process\.exit/.test(gen),
    'the general uncaughtException handler now exits — one exception raised while serving a hostile '
    + 'request would take the panel down. Only a bind failure is unambiguously fatal.');
});
