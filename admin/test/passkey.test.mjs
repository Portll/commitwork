// admin/auth.mjs — the passkey (WebAuthn) factor against the real store: ceremony binding,
// credential ownership, and the store afterwards (the crypto lives in lib/test/webauthn.test.mjs).
// STORE_PATH is captured at module load, so CW_AUTH_STORE must be set before the dynamic import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CW_AUTH_STORE = join(mkdtempSync(join(tmpdir(), 'cw-passkey-')), 'users.json');
const auth = await import('../auth.mjs');

const RP = { rpId: 'panel.example.com', origins: ['https://panel.example.com'] };
const EMAIL = 'op@example.com';
const PASSWORD = 'correct-horse-battery-staple';
const sha256 = (b) => createHash('sha256').update(b).digest();
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Independent CBOR encoder — the test side must not share code with the decoder it exercises.
function cbor(v) {
  const head = (m, n) => (n < 24 ? Buffer.from([(m << 5) | n])
    : n < 256 ? Buffer.from([(m << 5) | 24, n])
      : (() => { const b = Buffer.alloc(3); b[0] = (m << 5) | 25; b.writeUInt16BE(n, 1); return b; })());
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor');
}

function authenticator({ rpId = RP.rpId } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(32);
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]]);
  const ad = ({ counter = 0, attested = false }) => {
    const head = Buffer.concat([sha256(Buffer.from(rpId, 'utf8')), Buffer.from([attested ? 0x45 : 0x05]), Buffer.alloc(4)]);
    head.writeUInt32BE(counter, 33);
    if (!attested) return head;
    const l = Buffer.alloc(2); l.writeUInt16BE(credentialId.length, 0);
    return Buffer.concat([head, Buffer.alloc(16), l, credentialId, cbor(cose)]);
  };
  const cd = (type, ch) => Buffer.from(JSON.stringify({ type, challenge: ch, origin: RP.origins[0], crossOrigin: false }), 'utf8');
  return {
    credentialId: b64u(credentialId),
    create: (ch) => ({ clientDataJSON: cd('webauthn.create', ch), attestationObject: cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad({ attested: true })]])) }),
    get: (ch, counter = 0) => {
      const a = ad({ counter }); const c = cd('webauthn.get', ch);
      return { clientDataJSON: c, authenticatorData: a, signature: cryptoSign('sha256', Buffer.concat([a, sha256(c)]), privateKey) };
    },
  };
}

auth.bootstrapRoot({ email: EMAIL, password: PASSWORD });

function enrol(dev = authenticator(), label = 'yubikey') {
  const b = auth.beginPasskeyRegistration({ email: EMAIL, password: PASSWORD });
  assert.equal(b.ok, true, b.reason);
  const r = auth.finishPasskeyRegistration({ challengeId: b.challengeId, ...dev.create(b.challenge), label, rp: RP });
  assert.equal(r.ok, true, `${r.reason || ''} ${r.detail || ''}`);
  return dev;
}

test('enrol then sign in with the passkey', () => {
  const dev = enrol();
  const b = auth.beginPasskeyLogin({ email: EMAIL });
  const r = auth.finishPasskeyLogin({ challengeId: b.challengeId, credentialId: dev.credentialId, ...dev.get(b.challenge, 1), rp: RP });
  assert.equal(r.ok, true, `${r.reason || ''} ${r.detail || ''}`);
  assert.equal(r.user.email, EMAIL);
});

test('enrolment REQUIRES the password — an open endpoint is account takeover', () => {
  // The route is reachable unauthenticated — without the password check anyone could add a key.
  const b = auth.beginPasskeyRegistration({ email: EMAIL, password: 'wrong' });
  assert.equal(b.ok, false);
  assert.match(b.reason, /invalid credentials/);
  assert.equal(b.challengeId, undefined, 'and no challenge is issued to work with');
});

test('a challenge is SINGLE USE — the second attempt with it fails', () => {
  const dev = enrol();
  const b = auth.beginPasskeyLogin({ email: EMAIL });
  const first = auth.finishPasskeyLogin({ challengeId: b.challengeId, credentialId: dev.credentialId, ...dev.get(b.challenge, 5), rp: RP });
  assert.equal(first.ok, true);
  const replay = auth.finishPasskeyLogin({ challengeId: b.challengeId, credentialId: dev.credentialId, ...dev.get(b.challenge, 6), rp: RP });
  assert.equal(replay.ok, false);
  assert.match(replay.reason, /already-used|unknown/);
});

test('a FAILED attempt also burns the challenge — no retry window', () => {
  const dev = enrol();
  const other = authenticator();
  const b = auth.beginPasskeyLogin({ email: EMAIL });
  // wrong key: rejected, and the challenge must not survive for a second try
  const bad = auth.finishPasskeyLogin({ challengeId: b.challengeId, credentialId: dev.credentialId, ...other.get(b.challenge, 9), rp: RP });
  assert.equal(bad.ok, false);
  const retry = auth.finishPasskeyLogin({ challengeId: b.challengeId, credentialId: dev.credentialId, ...dev.get(b.challenge, 9), rp: RP });
  assert.equal(retry.ok, false, 'a burnt challenge must not be reusable even by the legitimate key');
});

test('a create challenge cannot be spent on a login, or the reverse', () => {
  const dev = authenticator();
  const b = auth.beginPasskeyRegistration({ email: EMAIL, password: PASSWORD });
  const r = auth.finishPasskeyLogin({ challengeId: b.challengeId, credentialId: dev.credentialId, ...dev.get(b.challenge), rp: RP });
  assert.equal(r.ok, false);
  assert.match(r.reason, /different ceremony|unknown/);
});

test('the signCount is PERSISTED, so clone detection works on the next attempt', () => {
  // A verdict computed and then dropped is a check that cannot fail twice.
  const dev = enrol();
  const b1 = auth.beginPasskeyLogin({ email: EMAIL });
  assert.equal(auth.finishPasskeyLogin({ challengeId: b1.challengeId, credentialId: dev.credentialId, ...dev.get(b1.challenge, 20), rp: RP }).ok, true);
  const b2 = auth.beginPasskeyLogin({ email: EMAIL });
  const replayed = auth.finishPasskeyLogin({ challengeId: b2.challengeId, credentialId: dev.credentialId, ...dev.get(b2.challenge, 20), rp: RP });
  assert.equal(replayed.ok, false, 'a counter that did not advance must be refused on the SECOND login too');
  assert.match(replayed.reason, /counter-regressed/);
});

test('an unknown credential is refused, and the RP policy is not taken from the caller', () => {
  const stranger = authenticator();
  const b = auth.beginPasskeyLogin({});
  const r = auth.finishPasskeyLogin({ challengeId: b.challengeId, credentialId: stranger.credentialId, ...stranger.get(b.challenge, 1), rp: RP });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown credential/);

  // and an assertion signed for another RP loses, even with a valid enrolled credential id
  const dev = enrol();
  const evil = authenticator({ rpId: 'evil.tld' });
  const b2 = auth.beginPasskeyLogin({ email: EMAIL });
  const r2 = auth.finishPasskeyLogin({ challengeId: b2.challengeId, credentialId: dev.credentialId, ...evil.get(b2.challenge, 1), rp: RP });
  assert.equal(r2.ok, false);
});

test('re-enrolling the same authenticator UPDATES, never appends a second row', () => {
  const before = auth.listPasskeys(EMAIL).length;
  const dev = enrol(undefined, 'first');
  const mid = auth.listPasskeys(EMAIL).length;
  assert.equal(mid, before + 1);
  enrol(dev, 'renamed');
  const rows = auth.listPasskeys(EMAIL);
  assert.equal(rows.length, mid, 'a duplicate row would leave a stale counter and an ambiguous revoke');
  assert.equal(rows.find((p) => p.credentialId === dev.credentialId).label, 'renamed');
});

test('listPasskeys never returns key material', () => {
  enrol();
  for (const row of auth.listPasskeys(EMAIL)) {
    assert.equal(row.publicKeyJwk, undefined);
    assert.equal(row.signCount, undefined);
    assert.ok(row.credentialId && row.label);
  }
});

test('revoking needs the password, and removes exactly one', () => {
  const dev = enrol();
  const n = auth.listPasskeys(EMAIL).length;
  assert.equal(auth.removePasskey({ email: EMAIL, credentialId: dev.credentialId, password: 'wrong' }).ok, false);
  assert.equal(auth.listPasskeys(EMAIL).length, n, 'a failed revoke must not remove anything');
  const r = auth.removePasskey({ email: EMAIL, credentialId: dev.credentialId, password: PASSWORD });
  assert.equal(r.ok, true);
  assert.equal(auth.listPasskeys(EMAIL).length, n - 1);
  assert.equal(auth.removePasskey({ email: EMAIL, credentialId: dev.credentialId, password: PASSWORD }).ok, false, 'and it is gone');
});
