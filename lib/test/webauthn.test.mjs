// node --test lib/test/ — WebAuthn verification, exercised against a REAL authenticator (a live
// ES256 key pair built with node:crypto), so a wrong signature is proven rejected, not just a
// parser proven. Every check runs both directions: honest ceremony passes, each field breaks it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';
import {
  verifyRegistration, verifyAssertion, parseAuthData, decodeCbor, coseToKey, b64u, unb64u,
} from '../webauthn.mjs';

const RP_ID = 'panel.example.com';
const ORIGIN = `https://${RP_ID}`;
const sha256 = (b) => createHash('sha256').update(b).digest();

// ── a minimal CBOR ENCODER, for the test side only ───────────────────────────────────────────
// Deliberately independent of the decoder under test — shared code would let a bug cancel itself out.
function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const b = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  if (value instanceof Map) {
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  }
  throw new Error(`test cbor: cannot encode ${typeof value}`);
}

// ── a working ES256 authenticator ────────────────────────────────────────────────────────────
function makeAuthenticator({ rpId = RP_ID } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(32);
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]]);

  const authData = ({ counter = 0, up = true, uv = true, attested = false, rp = rpId }) => {
    let flags = 0;
    if (up) flags |= 0x01;
    if (uv) flags |= 0x04;
    if (attested) flags |= 0x40;
    const head = Buffer.concat([sha256(Buffer.from(rp, 'utf8')), Buffer.from([flags]), Buffer.alloc(4)]);
    head.writeUInt32BE(counter, 33);
    if (!attested) return head;
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credentialId.length, 0);
    return Buffer.concat([head, Buffer.alloc(16), idLen, credentialId, cbor(cose)]);
  };

  const clientData = (type, challenge, { origin = ORIGIN, crossOrigin = false } = {}) =>
    Buffer.from(JSON.stringify({ type, challenge: b64u(challenge), origin, crossOrigin }), 'utf8');

  return {
    credentialId,
    register(challenge, opts = {}) {
      const ad = authData({ attested: true, ...opts });
      return {
        clientDataJSON: clientData('webauthn.create', challenge, opts),
        attestationObject: cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]])),
      };
    },
    assert(challenge, opts = {}) {
      const ad = authData(opts);
      const cd = clientData('webauthn.get', challenge, opts);
      const signed = Buffer.concat([ad, sha256(cd)]);
      return { clientDataJSON: cd, authenticatorData: ad, signature: cryptoSign('sha256', signed, privateKey) };
    },
  };
}

const base = { expectedOrigins: [ORIGIN], expectedRpId: RP_ID };
function enrol(auth = makeAuthenticator()) {
  const challenge = randomBytes(32);
  const r = verifyRegistration({ ...auth.register(challenge), expectedChallenge: challenge, ...base });
  assert.equal(r.ok, true, `enrolment should succeed: ${r.reason} ${r.detail || ''}`);
  return { auth, credential: r.credential };
}

// ── the positive control ─────────────────────────────────────────────────────────────────────
test('a real registration is accepted and yields a usable credential', () => {
  const { credential } = enrol();
  assert.equal(credential.alg, 'ES256');
  assert.equal(credential.publicKeyJwk.crv, 'P-256');
  assert.ok(credential.credentialId.length > 0);
  assert.equal(credential.fmt, 'none');
});

test('a real assertion from the enrolled key verifies', () => {
  const { auth, credential } = enrol();
  const challenge = randomBytes(32);
  const r = verifyAssertion({ ...auth.assert(challenge, { counter: 1 }), credential, expectedChallenge: challenge, ...base });
  assert.equal(r.ok, true, `${r.reason} ${r.detail || ''}`);
  assert.equal(r.signCount, 1);
});

// ── every field must independently break it ──────────────────────────────────────────────────
test('a challenge that was not the one issued is rejected', () => {
  const { auth, credential } = enrol();
  const r = verifyAssertion({
    ...auth.assert(randomBytes(32)), credential, expectedChallenge: randomBytes(32), ...base,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'challenge-mismatch');
});

test('origin is matched EXACTLY — the two classic bypasses both fail', () => {
  const { auth, credential } = enrol();
  for (const origin of [
    `https://${RP_ID}.evil.tld`,              // suffix-extension: a startsWith check would pass this
    `https://evil.tld?x=https://${RP_ID}`,    // containment: an includes() check would pass this
    `http://${RP_ID}`,                        // scheme downgrade
    `https://${RP_ID}:8443`,                  // port is part of a serialized origin
  ]) {
    const challenge = randomBytes(32);
    const r = verifyAssertion({
      ...auth.assert(challenge, { origin }), credential, expectedChallenge: challenge, ...base,
    });
    assert.equal(r.ok, false, `${origin} must not be accepted`);
    assert.equal(r.reason, 'origin-mismatch');
  }
});

test('an assertion signed for a DIFFERENT relying party is rejected', () => {
  const { credential } = enrol();
  const evil = makeAuthenticator({ rpId: 'evil.tld' });
  const challenge = randomBytes(32);
  const r = verifyAssertion({ ...evil.assert(challenge), credential, expectedChallenge: challenge, ...base });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rpid-mismatch');
});

test('a ceremony run cross-origin (in an iframe) is rejected', () => {
  const { auth, credential } = enrol();
  const challenge = randomBytes(32);
  const r = verifyAssertion({
    ...auth.assert(challenge, { crossOrigin: true }), credential, expectedChallenge: challenge, ...base,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cross-origin');
});

test('user presence is mandatory; user verification is policy', () => {
  const { auth, credential } = enrol();
  const c1 = randomBytes(32);
  const noUp = verifyAssertion({ ...auth.assert(c1, { up: false }), credential, expectedChallenge: c1, ...base });
  assert.equal(noUp.reason, 'no-user-presence');

  const c2 = randomBytes(32);
  const noUv = verifyAssertion({
    ...auth.assert(c2, { uv: false, counter: 1 }), credential, expectedChallenge: c2, ...base,
    requireUserVerification: true,
  });
  assert.equal(noUv.reason, 'no-user-verification');

  // ...and without the policy, UV-clear is fine — otherwise every UV-less key is locked out.
  const c3 = randomBytes(32);
  const ok = verifyAssertion({ ...auth.assert(c3, { uv: false, counter: 2 }), credential, expectedChallenge: c3, ...base });
  assert.equal(ok.ok, true);
  assert.equal(ok.userVerified, false);
});

// ── the signature must actually be checked ───────────────────────────────────────────────────
test('tampering with authenticatorData after signing breaks the signature', () => {
  const { auth, credential } = enrol();
  const challenge = randomBytes(32);
  const a = auth.assert(challenge, { counter: 5 });
  const tampered = Buffer.from(a.authenticatorData);
  tampered.writeUInt32BE(9999, 33);                       // forge a higher counter
  const r = verifyAssertion({ ...a, authenticatorData: tampered, credential, expectedChallenge: challenge, ...base });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-signature', 'the signed bytes must be the RAW authData, not a re-serialisation');
});

test('a signature from a DIFFERENT key is rejected', () => {
  const { credential } = enrol();
  const other = makeAuthenticator();
  const challenge = randomBytes(32);
  const r = verifyAssertion({ ...other.assert(challenge, { counter: 1 }), credential, expectedChallenge: challenge, ...base });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-signature');
});

// ── clone detection, and the reason it cannot be strict ──────────────────────────────────────
test('a counter that does not advance is a possible clone and is refused', () => {
  const { auth, credential } = enrol();
  const used = { ...credential, signCount: 7 };
  for (const counter of [7, 3]) {
    const challenge = randomBytes(32);
    const r = verifyAssertion({ ...auth.assert(challenge, { counter }), credential: used, expectedChallenge: challenge, ...base });
    assert.equal(r.ok, false, `counter ${counter} must not be accepted after 7`);
    assert.equal(r.reason, 'counter-regressed');
  }
});

test('an authenticator that never counts (Touch ID, synced passkeys) still works', () => {
  // 0 → 0 forever is normal for platform authenticators; rejecting it would lock them out.
  const { auth, credential } = enrol();
  assert.equal(credential.signCount, 0);
  for (let i = 0; i < 3; i++) {
    const challenge = randomBytes(32);
    const r = verifyAssertion({ ...auth.assert(challenge, { counter: 0 }), credential, expectedChallenge: challenge, ...base });
    assert.equal(r.ok, true, `${r.reason} ${r.detail || ''}`);
    assert.equal(r.counterSupported, false, 'and it is REPORTED as giving no freshness proof, not assumed to');
  }
});

// ── the CBOR subset ──────────────────────────────────────────────────────────────────────────
test('CBOR decodes the WebAuthn subset and REFUSES everything else', () => {
  assert.equal(decodeCbor(cbor(23)), 23);
  assert.equal(decodeCbor(cbor(-7)), -7);
  assert.equal(decodeCbor(cbor(70000)), 70000);
  assert.equal(decodeCbor(cbor('fmt')), 'fmt');
  assert.deepEqual(decodeCbor(cbor([1, 2])), [1, 2]);
  assert.equal(decodeCbor(cbor(new Map([[-1, 1]]))).get(-1), 1);

  // trailing bytes are an error, not something to skip past
  assert.throws(() => decodeCbor(Buffer.concat([cbor(1), Buffer.from([0xff])])), /trailing/);
  // Which guard fires depends on the encoding: 0xf9 (minor 25) reaches the major-type check;
  // 0xfb's minor 27 is refused as an unsupported length first.
  assert.throws(() => decodeCbor(Buffer.from([0x5f])), /reserved|unsupported|truncated/);
  assert.throws(() => decodeCbor(Buffer.from([0xf9, 0x3c, 0x00])), /unsupported major type 7/);
  assert.throws(() => decodeCbor(Buffer.from([0xfb, 0, 0, 0, 0, 0, 0, 0, 0])), /64-bit lengths/);
  assert.throws(() => decodeCbor(Buffer.from([0xc0, 0x01])), /unsupported major type 6/);   // tag
  // a length that overruns the buffer must not silently return a short string
  assert.throws(() => decodeCbor(Buffer.from([0x45, 1, 2])), /overruns/);
});

test('COSE refuses an algorithm it does not recognise rather than guessing', () => {
  const unknown = new Map([[1, 2], [3, -999], [-1, 1], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]]);
  assert.throws(() => coseToKey(unknown), /unsupported or absent alg/);
  const noAlg = new Map([[1, 2], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]]);
  assert.throws(() => coseToKey(noAlg), /unsupported or absent alg/);
});

test('authData with a credential id that overruns the buffer is refused', () => {
  const head = Buffer.concat([Buffer.alloc(32), Buffer.from([0x40]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0xff, 0xff])]);
  assert.throws(() => parseAuthData(head), /overruns|truncated/);
});
