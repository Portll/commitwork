// lib/update/contract.mjs — the portll-update@1 manifest: canonical JSON, the shape check, Ed25519
// verification by keyId, and semver order. Mirrors spine `updates/contract.mjs`; both must verify
// the contract's test vector (keyId test-2026-11) byte for byte and refuse it with one byte of
// `notes` changed or under an unknown keyId. node:crypto only: no dependency.
//
// Check order is the contract's (section 3), and checkManifest stops at the first failure:
//   1 schema · 2 product · 3 signature (an unknown keyId is refused) · 4 version newer than installed
// Size and sha256 are step 5, checked on the downloaded bytes (lib/update/download.mjs).

import { createPublicKey, verify as edVerify } from 'node:crypto';

export const SCHEMA = 'portll-update@1';
export const CHANNELS = Object.freeze(['stable', 'beta']);
// The DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// A file name written into a temporary directory: no separator, no leading dot, no `..`.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Keys sorted recursively, no whitespace, JSON.stringify encoding for strings and numbers. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObj(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('a non-finite number has no canonical JSON');
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`a ${typeof value} has no canonical JSON`);
  }
  return JSON.stringify(value);
}

/** The bytes the signature covers: the manifest without its `signature` field, canonical, UTF-8. */
export function signedBytes(manifest) {
  const rest = { ...manifest };
  delete rest.signature;
  return Buffer.from(canonicalJson(rest), 'utf8');
}

/** { major, minor, patch, pre: [] } or null. */
export function parseSemver(v) {
  const m = typeof v === 'string' ? SEMVER.exec(v) : null;
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

/** -1, 0 or 1 by semver 2.0.0 precedence; build metadata is ignored. Throws on a non-semver input. */
export function compareSemver(a, b) {
  const x = parseSemver(a), y = parseSemver(b);
  if (!x || !y) throw new TypeError(`not a semver version: ${JSON.stringify(x ? b : a)}`);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  // A version without a prerelease ranks above the same version with one.
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : (x.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

function artifactErrors(a, i) {
  const at = `artifacts[${i}]`;
  if (!isObj(a)) return [`${at} is not an object`];
  const errs = [];
  if (typeof a.name !== 'string' || !SAFE_NAME.test(a.name) || a.name.includes('..')) errs.push(`${at}.name is not a plain file name`);
  if (typeof a.platform !== 'string' || !a.platform) errs.push(`${at}.platform is missing`);
  if (!Number.isSafeInteger(a.size) || a.size <= 0) errs.push(`${at}.size is not a positive integer`);
  if (typeof a.sha256 !== 'string' || !HEX64.test(a.sha256)) errs.push(`${at}.sha256 is not 64 lowercase hex digits`);
  if (typeof a.url !== 'string' || !a.url.startsWith('https://')) errs.push(`${at}.url is not an https URL`);
  if (a.github !== undefined) {
    const g = a.github;
    if (!isObj(g) || typeof g.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(g.repo)
      || typeof g.tag !== 'string' || !g.tag || typeof g.asset !== 'string' || !g.asset) {
      errs.push(`${at}.github needs repo (owner/name), tag and asset`);
    }
  }
  return errs;
}

/** Every way the manifest departs from the portll-update@1 shape; empty when it conforms. */
export function manifestErrors(m) {
  if (!isObj(m)) return ['the manifest is not a JSON object'];
  const errs = [];
  if (m.schema !== SCHEMA) errs.push(`schema is ${JSON.stringify(m.schema)}, not ${SCHEMA}`);
  if (typeof m.product !== 'string' || !m.product) errs.push('product is missing');
  if (!CHANNELS.includes(m.channel)) errs.push(`channel is ${JSON.stringify(m.channel)}, not stable or beta`);
  if (!parseSemver(m.version)) errs.push(`version ${JSON.stringify(m.version)} is not semver`);
  if (typeof m.published !== 'string' || !Number.isFinite(Date.parse(m.published))) errs.push('published is not a timestamp');
  if (m.notes !== undefined && typeof m.notes !== 'string') errs.push('notes is not a string');
  if (!Array.isArray(m.artifacts) || !m.artifacts.length) errs.push('artifacts is not a non-empty array');
  else m.artifacts.forEach((a, i) => errs.push(...artifactErrors(a, i)));
  const s = m.signature;
  if (!isObj(s) || s.alg !== 'ed25519' || typeof s.keyId !== 'string' || !s.keyId
    || typeof s.sig !== 'string' || !BASE64.test(s.sig)) errs.push('signature needs alg ed25519, keyId and a base64 sig');
  return errs;
}

/** A node KeyObject from a raw 32-byte Ed25519 public key in base64. */
export function publicKeyFromRaw(b64) {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new TypeError(`an Ed25519 public key is 32 bytes, not ${raw.length}`);
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** { ok, keyId, reason }: the signature checked against `keys` ({ keyId: raw base64 }). */
export function verifySignature(manifest, keys) {
  const keyId = manifest?.signature?.keyId;
  if (!Object.prototype.hasOwnProperty.call(keys || {}, keyId)) return { ok: false, keyId, reason: `unknown keyId ${JSON.stringify(keyId)}` };
  const sig = Buffer.from(manifest.signature.sig, 'base64');
  if (sig.length !== 64) return { ok: false, keyId, reason: 'the signature is not 64 bytes' };
  const ok = edVerify(null, signedBytes(manifest), publicKeyFromRaw(keys[keyId]), sig);
  return ok ? { ok, keyId, reason: null } : { ok, keyId, reason: `the signature does not verify under ${keyId}` };
}

/**
 * The contract's checks 1-4 in order. `installed` null skips step 4 (a candidate is being ranked).
 * @returns {{ok: boolean, step: string|null, reason: string|null, keyId: string|null, newer: boolean|null}}
 */
export function checkManifest(manifest, { product, installed = null, keys }) {
  const fail = (step, reason, keyId = null) => ({ ok: false, step, reason, keyId, newer: null });
  const errs = manifestErrors(manifest);
  if (errs.length) return fail('schema', errs.join('; '));
  if (manifest.product !== product) return fail('product', `the manifest is for ${JSON.stringify(manifest.product)}, not ${product}`);
  const sig = verifySignature(manifest, keys);
  if (!sig.ok) return fail('signature', sig.reason, sig.keyId ?? null);
  if (installed === null) return { ok: true, step: null, reason: null, keyId: sig.keyId, newer: null };
  if (compareSemver(manifest.version, installed) <= 0) {
    return { ok: false, step: 'version', reason: `${manifest.version} is not newer than the installed ${installed}`, keyId: sig.keyId, newer: false };
  }
  return { ok: true, step: null, reason: null, keyId: sig.keyId, newer: true };
}

/** The artifact for this platform: `any`, or an exact match; the first one listed wins. */
export function pickArtifact(manifest, { platform = 'any', suffix = '' } = {}) {
  return (manifest.artifacts || []).find((a) => (a.platform === 'any' || a.platform === platform) && a.name.endsWith(suffix)) || null;
}
