// Convert COSE public key map to JWK (lib/webauthn.mjs coseToKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coseToKey } from '../webauthn.mjs';

test('throws when input is not a Map', () => {
  assert.throws(() => coseToKey({}), {
    name: 'Error',
    message: 'cose: expected a map'
  });
});

test('throws when alg is missing or unsupported', () => {
  const m = new Map();
  m.set(3, 999);
  assert.throws(() => coseToKey(m), {
    name: 'Error',
    message: 'cose: unsupported or absent alg 999'
  });
});

test('returns correct JWK for EC key (P\u2011256)', () => {
  const m = new Map();
  m.set(3, -7);
  m.set(-2, Buffer.alloc(1, 1));
  m.set(-3, Buffer.alloc(1, 2));
  const result = coseToKey(m);
  assert.deepEqual(result, { jwk: { kty: "EC", crv: "P-256", x: "AQ", y: "Ag" }, alg: "ES256", hash: "sha256" });
});

test('throws when EC key missing x (non\u2011buffer)', () => {
  const m = new Map();
  m.set(3, -7);
  m.set(-2, 123);
  m.set(-3, Buffer.alloc(1, 2));
  assert.throws(() => coseToKey(m), {
    name: 'Error',
    message: 'cose: EC key missing x/y'
  });
});

test('throws when EC key missing y (non\u2011buffer)', () => {
  const m = new Map();
  m.set(3, -7);
  m.set(-2, Buffer.alloc(1, 1));
  m.set(-3, 'not-buffer');
  assert.throws(() => coseToKey(m), {
    name: 'Error',
    message: 'cose: EC key missing x/y'
  });
});

test('returns correct JWK for OKP key (Ed25519)', () => {
  const m = new Map();
  m.set(3, -8);
  m.set(-2, Buffer.alloc(1, 3));
  const result = coseToKey(m);
  assert.deepEqual(result, { jwk: { kty: "OKP", crv: "Ed25519", x: "Aw" }, alg: "EdDSA", hash: null });
});

test('throws when OKP key missing x (non\u2011buffer)', () => {
  const m = new Map();
  m.set(3, -8);
  m.set(-2, null);
  assert.throws(() => coseToKey(m), {
    name: 'Error',
    message: 'cose: OKP key missing x'
  });
});

test('returns correct JWK for RSA key (RS256)', () => {
  const m = new Map();
  m.set(3, -257);
  m.set(-1, Buffer.alloc(1, 4));
  m.set(-2, Buffer.alloc(1, 5));
  const result = coseToKey(m);
  assert.deepEqual(result, { jwk: { kty: "RSA", n: "BA", e: "BQ" }, alg: "RS256", hash: "sha256" });
});

test('throws when RSA key missing n (non\u2011buffer)', () => {
  const m = new Map();
  m.set(3, -257);
  m.set(-1, 'no-buffer');
  m.set(-2, Buffer.alloc(1, 5));
  assert.throws(() => coseToKey(m), {
    name: 'Error',
    message: 'cose: RSA key missing n/e'
  });
});

test('throws when RSA key missing e (non\u2011buffer)', () => {
  const m = new Map();
  m.set(3, -257);
  m.set(-1, Buffer.alloc(1, 4));
  m.set(-2, 42);
  assert.throws(() => coseToKey(m), {
    name: 'Error',
    message: 'cose: RSA key missing n/e'
  });
});
