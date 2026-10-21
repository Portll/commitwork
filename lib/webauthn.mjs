// lib/webauthn.mjs — WebAuthn / passkey verification on node:crypto alone (zero third-party deps;
// this guards the panel's auth). Stateless: bytes in, verdict out. Attestation statements are
// parsed but deliberately NOT verified — origin, RP ID, challenge, UP, signature and counter are.
import { createHash, createPublicKey, verify as cryptoVerify, timingSafeEqual } from 'node:crypto';

// ── base64url ────────────────────────────────────────────────────────────────────────────────
// WebAuthn is base64url end to end (challenges, credential ids, and every field the browser sends).
export const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const sha256 = (b) => createHash('sha256').update(b).digest();

/** Constant-time buffer compare that does not leak length through an exception. */
function sameBytes(a, b) {
  const A = Buffer.from(a); const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

// ── CBOR (RFC 8949), the subset WebAuthn actually uses ───────────────────────────────────────
// Major types 0-5 only; anything outside the subset THROWS rather than being skipped — a decoder
// that ignores what it does not understand hides structure from the verifier.
function cborRead(buf, pos) {
  if (pos >= buf.length) throw new Error('cbor: truncated');
  const ib = buf[pos++];
  const major = ib >> 5;
  const minor = ib & 0x1f;
  let len = minor;
  if (minor === 24) { len = buf.readUInt8(pos); pos += 1; }
  else if (minor === 25) { len = buf.readUInt16BE(pos); pos += 2; }
  else if (minor === 26) { len = buf.readUInt32BE(pos); pos += 4; }
  else if (minor === 27) {
    // A 64-bit length cannot address a Buffer we could hold anyway; refuse rather than truncate.
    throw new Error('cbor: 64-bit lengths are not supported');
  } else if (minor >= 28) throw new Error(`cbor: reserved additional-info ${minor}`);

  switch (major) {
    case 0: return { value: len, pos };
    case 1: return { value: -1 - len, pos };
    case 2: {
      if (pos + len > buf.length) throw new Error('cbor: byte string overruns buffer');
      return { value: buf.subarray(pos, pos + len), pos: pos + len };
    }
    case 3: {
      if (pos + len > buf.length) throw new Error('cbor: text string overruns buffer');
      return { value: buf.subarray(pos, pos + len).toString('utf8'), pos: pos + len };
    }
    case 4: {
      const arr = [];
      for (let i = 0; i < len; i++) { const r = cborRead(buf, pos); arr.push(r.value); pos = r.pos; }
      return { value: arr, pos };
    }
    case 5: {
      // A Map, not an object — COSE keys are negative integers, which object keys would stringify.
      const m = new Map();
      for (let i = 0; i < len; i++) {
        const k = cborRead(buf, pos); pos = k.pos;
        const v = cborRead(buf, pos); pos = v.pos;
        m.set(k.value, v.value);
      }
      return { value: m, pos };
    }
    default:
      throw new Error(`cbor: unsupported major type ${major}`);
  }
}

/** Decode one CBOR item. `requireExact` rejects trailing bytes — see the note in cborRead. */
export function decodeCbor(buf, { requireExact = true } = {}) {
  const { value, pos } = cborRead(Buffer.from(buf), 0);
  if (requireExact && pos !== buf.length) throw new Error(`cbor: ${buf.length - pos} trailing byte(s)`);
  return value;
}

// ── COSE public key → JWK ────────────────────────────────────────────────────────────────────
// COSE labels: 1=kty, 3=alg; EC2 -1=crv, -2=x, -3=y; RSA -1=n, -2=e; OKP -1=crv, -2=x.
// Only the algs browsers actually produce; an unknown alg is REFUSED, never defaulted.
const COSE_ALG = {
  '-7': { name: 'ES256', kty: 'EC', crv: 'P-256', hash: 'sha256' },
  '-35': { name: 'ES384', kty: 'EC', crv: 'P-384', hash: 'sha384' },
  '-8': { name: 'EdDSA', kty: 'OKP', crv: 'Ed25519', hash: null },
  '-257': { name: 'RS256', kty: 'RSA', hash: 'sha256' },
};

export function coseToKey(cose) {
  if (!(cose instanceof Map)) throw new Error('cose: expected a map');
  const alg = cose.get(3);
  const spec = COSE_ALG[String(alg)];
  if (!spec) throw new Error(`cose: unsupported or absent alg ${JSON.stringify(alg)}`);
  let jwk;
  if (spec.kty === 'EC') {
    const x = cose.get(-2); const y = cose.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new Error('cose: EC key missing x/y');
    jwk = { kty: 'EC', crv: spec.crv, x: b64u(x), y: b64u(y) };
  } else if (spec.kty === 'OKP') {
    const x = cose.get(-2);
    if (!Buffer.isBuffer(x)) throw new Error('cose: OKP key missing x');
    jwk = { kty: 'OKP', crv: spec.crv, x: b64u(x) };
  } else {
    const n = cose.get(-1); const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new Error('cose: RSA key missing n/e');
    jwk = { kty: 'RSA', n: b64u(n), e: b64u(e) };
  }
  return { jwk, alg: spec.name, hash: spec.hash };
}

// ── authenticator data ───────────────────────────────────────────────────────────────────────
// rpIdHash(32) | flags(1) | signCount(4) | [ aaguid(16) | credIdLen(2) | credId | COSE key ] | ext
const FLAG_UP = 0x01;   // user present  — someone touched the authenticator
const FLAG_UV = 0x04;   // user verified — biometric or PIN was satisfied
const FLAG_AT = 0x40;   // attested credential data is present (registration)
const FLAG_ED = 0x80;   // extension data follows

export function parseAuthData(raw) {
  const buf = Buffer.from(raw);
  if (buf.length < 37) throw new Error('authData: shorter than the 37-byte minimum');
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32];
  const signCount = buf.readUInt32BE(33);
  const out = {
    rpIdHash,
    flags,
    signCount,
    userPresent: Boolean(flags & FLAG_UP),
    userVerified: Boolean(flags & FLAG_UV),
    attested: Boolean(flags & FLAG_AT),
    extensionData: Boolean(flags & FLAG_ED),
  };
  if (!out.attested) return out;
  if (buf.length < 55) throw new Error('authData: AT flag set but attested data is truncated');
  out.aaguid = buf.subarray(37, 53);
  const idLen = buf.readUInt16BE(53);
  const idEnd = 55 + idLen;
  if (idEnd > buf.length) throw new Error('authData: credential id overruns the buffer');
  out.credentialId = buf.subarray(55, idEnd);
  // Trailing bytes are legitimate here only — extension data follows the COSE key when ED is set.
  const rest = buf.subarray(idEnd);
  const { value, pos } = cborRead(rest, 0);
  out.cose = value;
  out.publicKey = coseToKey(value);
  out.extensionBytes = rest.subarray(pos);
  return out;
}

// ── clientDataJSON ───────────────────────────────────────────────────────────────────────────
// Origin is compared EXACTLY, as a full serialized origin — prefix/endsWith/contains checks are
// the classic WebAuthn bypass.
function checkClientData(clientDataJSON, { type, expectedChallenge, expectedOrigins }) {
  let cd;
  try { cd = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); }
  catch (e) { return { ok: false, reason: 'clientData-unparseable', detail: e.message }; }
  if (cd.type !== type) return { ok: false, reason: 'wrong-type', detail: `expected ${type}, got ${JSON.stringify(cd.type)}` };
  if (!sameBytes(unb64u(cd.challenge || ''), Buffer.from(expectedChallenge)))
    return { ok: false, reason: 'challenge-mismatch', detail: 'the signed challenge is not the one issued' };
  const origins = [].concat(expectedOrigins);
  if (!origins.includes(cd.origin)) {
    return { ok: false, reason: 'origin-mismatch', detail: `${JSON.stringify(cd.origin)} is not an accepted origin` };
  }
  // crossOrigin true means the ceremony ran in an iframe on another site's page.
  if (cd.crossOrigin === true) return { ok: false, reason: 'cross-origin', detail: 'ceremony ran cross-origin' };
  return { ok: true, clientData: cd };
}

/**
 * REGISTRATION. Verify a navigator.credentials.create() response and return the credential to
 * store: { ok:true, credential } or { ok:false, reason, detail } — never a throw for an expected
 * condition, never a bare boolean.
 */
export function verifyRegistration({
  clientDataJSON, attestationObject, expectedChallenge, expectedOrigins, expectedRpId,
  requireUserVerification = false,
}) {
  const cdr = checkClientData(clientDataJSON, { type: 'webauthn.create', expectedChallenge, expectedOrigins });
  if (!cdr.ok) return cdr;

  let att;
  try { att = decodeCbor(attestationObject); }
  catch (e) { return { ok: false, reason: 'attestation-unparseable', detail: e.message }; }
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) {
    return { ok: false, reason: 'attestation-shape', detail: 'attestationObject has no authData byte string' };
  }

  let ad;
  try { ad = parseAuthData(att.get('authData')); }
  catch (e) { return { ok: false, reason: 'authData-unparseable', detail: e.message }; }

  if (!sameBytes(ad.rpIdHash, sha256(Buffer.from(expectedRpId, 'utf8'))))
    return { ok: false, reason: 'rpid-mismatch', detail: 'authenticator signed for a different relying party' };
  if (!ad.userPresent) return { ok: false, reason: 'no-user-presence', detail: 'UP flag clear' };
  if (requireUserVerification && !ad.userVerified)
    return { ok: false, reason: 'no-user-verification', detail: 'UV required by policy but flag is clear' };
  if (!ad.attested || !ad.credentialId || !ad.publicKey)
    return { ok: false, reason: 'no-attested-credential', detail: 'registration carried no credential' };

  return {
    ok: true,
    credential: {
      credentialId: b64u(ad.credentialId),
      publicKeyJwk: ad.publicKey.jwk,
      alg: ad.publicKey.alg,
      signCount: ad.signCount,
      aaguid: ad.aaguid ? ad.aaguid.toString('hex') : null,
      // Recorded so a later require-UV policy can tell which credentials already satisfy it.
      uvAtRegistration: ad.userVerified,
      fmt: att.get('fmt') || 'none',
    },
  };
}

/**
 * AUTHENTICATION. Verify a navigator.credentials.get() response. Signed bytes are
 * authenticatorData || SHA-256(clientDataJSON), over the RAW authenticatorData as received —
 * never a re-serialisation.
 */
export function verifyAssertion({
  clientDataJSON, authenticatorData, signature, credential,
  expectedChallenge, expectedOrigins, expectedRpId, requireUserVerification = false,
}) {
  const cdr = checkClientData(clientDataJSON, { type: 'webauthn.get', expectedChallenge, expectedOrigins });
  if (!cdr.ok) return cdr;

  let ad;
  try { ad = parseAuthData(authenticatorData); }
  catch (e) { return { ok: false, reason: 'authData-unparseable', detail: e.message }; }

  if (!sameBytes(ad.rpIdHash, sha256(Buffer.from(expectedRpId, 'utf8'))))
    return { ok: false, reason: 'rpid-mismatch', detail: 'assertion signed for a different relying party' };
  if (!ad.userPresent) return { ok: false, reason: 'no-user-presence', detail: 'UP flag clear' };
  if (requireUserVerification && !ad.userVerified)
    return { ok: false, reason: 'no-user-verification', detail: 'UV required by policy but flag is clear' };

  const spec = Object.values(COSE_ALG).find((s) => s.name === credential.alg);
  if (!spec) return { ok: false, reason: 'unsupported-alg', detail: `stored credential alg ${credential.alg}` };

  let key;
  try { key = createPublicKey({ key: credential.publicKeyJwk, format: 'jwk' }); }
  catch (e) { return { ok: false, reason: 'bad-stored-key', detail: e.message }; }

  const signed = Buffer.concat([Buffer.from(authenticatorData), sha256(Buffer.from(clientDataJSON))]);
  let sigOk = false;
  try {
    // Ed25519 takes a null digest; ECDSA signatures arrive DER-encoded, which is node's default.
    sigOk = cryptoVerify(spec.hash, signed, key, Buffer.from(signature));
  } catch (e) { return { ok: false, reason: 'verify-threw', detail: e.message }; }
  if (!sigOk) return { ok: false, reason: 'bad-signature', detail: 'signature does not match the signed bytes' };

  // Clone detection: the counter must strictly increase once it has left zero. Many platform
  // authenticators send 0 forever, so 0 == 0 is accepted and reported as counter-unsupported.
  const prev = Number(credential.signCount || 0);
  const counterSupported = !(prev === 0 && ad.signCount === 0);
  if (counterSupported && ad.signCount <= prev) {
    return {
      ok: false,
      reason: 'counter-regressed',
      detail: `signCount ${ad.signCount} did not advance past ${prev} — possible cloned authenticator`,
    };
  }

  return {
    ok: true,
    signCount: ad.signCount,
    counterSupported,
    userVerified: ad.userVerified,
  };
}
