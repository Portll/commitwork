#!/usr/bin/env node
// cra/timestamp.mjs — RFC 3161 trusted timestamps over signed evidence records, zero deps.
//
// attest.mjs proves WHO signed (whoever holds the local key) but its `at` is this machine's clock.
// A Time-Stamp Authority's token proves the record's bytes existed at genTime by a clock this
// machine does not control. Per record:
//
//   stamp   → TimeStampReq (SHA-256 imprint of the record's bytes, random nonce, certReq) POSTed to
//             CW_TSA_URL; the response is verified before anything is written, then the request and
//             response land atomically beside the record as <record>.tsq / <record>.tsr.
//   verify  → imprint, nonce, CMS signature (signedAttrs, messageDigest, signing-certificate binding)
//             against the TSA certificate in the token, and — only when CW_TSA_CA names a PEM trust
//             anchor — the certificate chain to it.
//
// Verdicts: anchored (signature valid, chain reaches CW_TSA_CA) · unanchored (signature valid, chain
// not anchored — never "trusted") · invalid (with the reason) · absent (no token). Revocation is not
// checked and every result says so.
//
// Example TSAs (examples only; nothing here calls one unless CW_TSA_URL is set):
//   https://freetsa.org/tsr   http://timestamp.digicert.com
//
//   node cra/timestamp.mjs stamp  [record ...]   default: every signatures/*.sig
//   node cra/timestamp.mjs verify [record ...] [--json]

import { createHash, randomBytes, verify as cryptoVerify, X509Certificate } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as der from '../lib/der.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { resolvePaths } from './lib.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const { TAG } = der;

export const EXIT = { UNANCHORED: 20, ABSENT: 21, INVALID: 22, REQUEST_FAILED: 23 };
export const MAX_RESPONSE_BYTES = 1 << 20;

export const OID = {
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRSA: '1.2.840.113549.1.1.11',
  sha384WithRSA: '1.2.840.113549.1.1.12',
  sha512WithRSA: '1.2.840.113549.1.1.13',
  ecPublicKey: '1.2.840.10045.2.1',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  ecdsaSha384: '1.2.840.10045.4.3.3',
  ecdsaSha512: '1.2.840.10045.4.3.4',
  ed25519: '1.3.101.112',
  ekuTimeStamping: '1.3.6.1.5.5.7.3.8',
  subjectKeyIdentifier: '2.5.29.14',
};

const HASH_BY_OID = { [OID.sha256]: 'sha256', [OID.sha384]: 'sha384', [OID.sha512]: 'sha512' };
// SHA-1 is named so it can be refused by name rather than as "unknown".
const WEAK_HASH = { [OID.sha1]: 'sha1', '1.2.840.113549.2.5': 'md5' };
const SIG_HASH = {
  [OID.sha256WithRSA]: 'sha256', [OID.sha384WithRSA]: 'sha384', [OID.sha512WithRSA]: 'sha512',
  [OID.ecdsaSha256]: 'sha256', [OID.ecdsaSha384]: 'sha384', [OID.ecdsaSha512]: 'sha512',
};

export class TsaError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; }
}
const fail = (msg) => { throw new TsaError(msg); };

const sha256 = (b) => createHash('sha256').update(b).digest();
const algId = (o) => der.seq(der.oid(o), der.nul());
const toHex = (big) => big.toString(16);

// ── request ──────────────────────────────────────────────────────────────────────────────────

export function buildRequest(recordBytes, { nonce = randomBytes(8), certReq = true } = {}) {
  const imprint = sha256(recordBytes);
  const nonceInt = BigInt(`0x${Buffer.from(nonce).toString('hex') || '0'}`);
  const body = [der.int(1), der.seq(algId(OID.sha256), der.octets(imprint)), der.int(nonceInt)];
  if (certReq) body.push(der.bool(true));
  return { der: der.seq(...body), imprint: imprint.toString('hex'), nonce: toHex(nonceInt) };
}

export function parseRequest(buf) {
  const top = der.expect(der.decode(buf), TAG.SEQUENCE, 'TimeStampReq');
  const [ver, mi, ...rest] = top.children;
  if (der.readInt(ver, 'TimeStampReq.version') !== 1n) fail('TimeStampReq.version is not 1');
  const { hashAlg, hashed } = readImprint(mi, 'TimeStampReq.messageImprint');
  let nonce = null, certReq = false;
  for (const n of rest) {
    if (n.tag === TAG.INTEGER) nonce = toHex(der.readInt(n, 'TimeStampReq.nonce'));
    else if (n.tag === TAG.BOOLEAN) certReq = der.readBool(n, 'TimeStampReq.certReq');
  }
  return { hashAlg, imprint: hashed.toString('hex'), nonce, certReq };
}

function readImprint(node, what) {
  const [alg, hashed] = der.expect(node, TAG.SEQUENCE, what).children;
  const hashAlg = der.readOid(der.expect(alg, TAG.SEQUENCE, `${what}.hashAlgorithm`).children[0], `${what}.hashAlgorithm`);
  return { hashAlg, hashed: der.expect(hashed, TAG.OCTET_STRING, `${what}.hashedMessage`).content };
}

// ── response / token parsing ─────────────────────────────────────────────────────────────────

const STATUS = ['granted', 'grantedWithMods', 'rejection', 'waiting', 'revocationWarning', 'revocationNotification'];

export function parseResponse(buf) {
  const top = der.expect(der.decode(buf), TAG.SEQUENCE, 'TimeStampResp');
  const [statusInfo, token] = top.children;
  const si = der.expect(statusInfo, TAG.SEQUENCE, 'PKIStatusInfo').children;
  const code = Number(der.readInt(si[0], 'PKIStatus'));
  const text = si[1]?.tag === TAG.SEQUENCE ? si[1].children.map((c) => c.content.toString('utf8')).join('; ') : null;
  return { status: STATUS[code] ?? `unknown(${code})`, statusCode: code, statusText: text, token: token ? token.raw : null };
}

// Certificate fields read by hand: X509Certificate exposes neither the issuer's DER nor the serial's bytes.
function certFields(certDer) {
  const tbs = der.expect(der.decode(certDer), TAG.SEQUENCE, 'Certificate').children[0];
  const f = der.expect(tbs, TAG.SEQUENCE, 'TBSCertificate').children;
  const i = f[0].tag === 0xa0 ? 1 : 0;
  const out = { serial: der.expect(f[i], TAG.INTEGER, 'serialNumber').content, issuer: f[i + 2].raw, ski: null };
  const exts = f.find((n) => n.tag === 0xa3);
  for (const ext of exts?.children?.[0]?.children ?? []) {
    if (der.readOid(ext.children[0]) !== OID.subjectKeyIdentifier) continue;
    out.ski = der.decode(ext.children[ext.children.length - 1].content).content;
  }
  return out;
}

export function parseToken(buf) {
  const ci = der.expect(der.decode(buf), TAG.SEQUENCE, 'ContentInfo').children;
  if (der.readOid(ci[0], 'ContentInfo.contentType') !== OID.signedData) fail('token is not CMS SignedData');
  const sdNode = der.expect(der.expect(ci[1], 0xa0, 'ContentInfo.content').children[0], TAG.SEQUENCE, 'SignedData');
  const sd = sdNode.children;
  let k = 2;
  const encap = der.expect(sd[k++], TAG.SEQUENCE, 'EncapsulatedContentInfo').children;
  if (der.readOid(encap[0], 'eContentType') !== OID.tstInfo) fail('eContentType is not id-ct-TSTInfo');
  const eContent = der.expect(der.expect(encap[1], 0xa0, 'eContent').children[0], TAG.OCTET_STRING, 'eContent').content;
  const certs = [];
  if (sd[k]?.tag === 0xa0) for (const c of sd[k++].children) if (c.tag === TAG.SEQUENCE) certs.push(Buffer.from(c.raw));
  if (sd[k]?.tag === 0xa1) k++;
  const signerInfos = der.expect(sd[k], TAG.SET, 'SignerInfos').children;
  if (signerInfos.length !== 1) fail(`token carries ${signerInfos.length} SignerInfos; RFC 3161 expects exactly one`);
  return { eContent, tstInfo: parseTstInfo(eContent), certs, signer: parseSignerInfo(signerInfos[0]) };
}

function parseTstInfo(buf) {
  const f = der.expect(der.decode(buf), TAG.SEQUENCE, 'TSTInfo').children;
  if (der.readInt(f[0], 'TSTInfo.version') !== 1n) fail('TSTInfo.version is not 1');
  const out = {
    policy: der.readOid(f[1], 'TSTInfo.policy'),
    ...(({ hashAlg, hashed }) => ({ hashAlg, imprint: hashed.toString('hex') }))(readImprint(f[2], 'TSTInfo.messageImprint')),
    serialNumber: toHex(der.readInt(f[3], 'TSTInfo.serialNumber')),
    genTime: null, nonce: null,
  };
  const t = der.readTime(der.expect(f[4], TAG.GENTIME, 'TSTInfo.genTime'), 'TSTInfo.genTime');
  out.genTime = t.iso; out.genTimeText = t.text;
  for (const n of f.slice(5)) if (n.tag === TAG.INTEGER) out.nonce = toHex(der.readInt(n, 'TSTInfo.nonce'));
  return out;
}

function parseSignerInfo(node) {
  const f = der.expect(node, TAG.SEQUENCE, 'SignerInfo').children;
  const sid = f[1];
  const out = { sid: null, digestAlg: null, signedAttrs: null, attrs: {}, sigAlg: null, signature: null };
  if (sid.tag === TAG.SEQUENCE) out.sid = { issuer: sid.children[0].raw, serial: der.expect(sid.children[1], TAG.INTEGER, 'sid.serialNumber').content };
  else if (sid.tag === 0x80) out.sid = { ski: sid.content };
  else fail('SignerInfo.sid has an unrecognised form');
  out.digestAlg = der.readOid(der.expect(f[2], TAG.SEQUENCE, 'digestAlgorithm').children[0], 'digestAlgorithm');
  let k = 3;
  if (f[k]?.tag === 0xa0) {
    out.signedAttrs = f[k];
    for (const a of f[k].children) {
      const type = der.readOid(a.children[0], 'Attribute.type');
      if (out.attrs[type]) fail(`signed attribute ${type} appears twice`);
      const vals = der.expect(a.children[1], TAG.SET, 'Attribute.values').children;
      if (vals.length !== 1) fail(`signed attribute ${type} carries ${vals.length} values`);
      out.attrs[type] = vals[0];
    }
    k++;
  }
  out.sigAlg = der.readOid(der.expect(f[k++], TAG.SEQUENCE, 'signatureAlgorithm').children[0], 'signatureAlgorithm');
  out.signature = der.expect(f[k], TAG.OCTET_STRING, 'signature').content;
  return out;
}

// ── verification ─────────────────────────────────────────────────────────────────────────────

const ekuOf = (c) => c.extKeyUsage ?? c.keyUsage ?? [];
const within = (c, iso) => (c.validFromDate ?? new Date(c.validFrom)) <= new Date(iso) && new Date(iso) <= (c.validToDate ?? new Date(c.validTo));

function findSigner(sid, pool) {
  for (const c of pool) {
    const f = certFields(c.raw);
    if (sid.ski ? f.ski && f.ski.equals(sid.ski) : f.issuer.equals(sid.issuer) && f.serial.equals(sid.serial)) return c;
  }
  return null;
}

function checkSignature(signer, cert) {
  const hash = SIG_HASH[signer.sigAlg];
  const digest = HASH_BY_OID[signer.digestAlg];
  if (!digest) fail(WEAK_HASH[signer.digestAlg] ? `digest algorithm ${WEAK_HASH[signer.digestAlg]} is refused` : `unsupported digest algorithm ${signer.digestAlg}`);
  let alg;
  if (signer.sigAlg === OID.ed25519) alg = null;
  else if (signer.sigAlg === OID.rsaEncryption || signer.sigAlg === OID.ecPublicKey) alg = digest;
  else if (hash) alg = hash;
  else fail(`unsupported signature algorithm ${signer.sigAlg}`);
  // CMS signs the DER of signedAttrs as a SET OF, not as the [0] IMPLICIT it is carried under.
  const signed = Buffer.concat([Buffer.from([TAG.SET]), signer.signedAttrs.raw.subarray(1)]);
  let ok;
  try { ok = cryptoVerify(alg, signed, cert.publicKey, signer.signature); }
  catch (e) { fail(`signature could not be checked: ${e.message}`); }
  if (!ok) fail('CMS signature does not verify against the TSA certificate');
}

// RFC 3161 §2.4.1 requires the signing-certificate attribute; without it the token does not say which certificate signs it.
function checkCertBinding(attrs, cert) {
  const v2 = attrs[OID.signingCertificateV2], v1 = attrs[OID.signingCertificate];
  if (!v2 && !v1) fail('no signing-certificate attribute binds the TSA certificate to the signature');
  const certs = der.expect((v2 || v1).children[0], TAG.SEQUENCE, 'ESSCertID list').children;
  const first = der.expect(certs[0], TAG.SEQUENCE, 'ESSCertID').children;
  let alg = 'sha1', hashNode = first[0];
  if (v2 && first[0].tag === TAG.SEQUENCE) {
    const o = der.readOid(first[0].children[0], 'ESSCertIDv2.hashAlgorithm');
    alg = HASH_BY_OID[o] || fail(`signing-certificate hash ${WEAK_HASH[o] || o} is not accepted`);
    hashNode = first[1];
  } else if (v2) alg = 'sha256';
  const want = der.expect(hashNode, TAG.OCTET_STRING, 'certHash').content;
  if (!createHash(alg).update(cert.raw).digest().equals(want)) fail('signing-certificate attribute names a different certificate');
}

export function parsePemBundle(text) {
  const blocks = String(text).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  return blocks.map((b) => new X509Certificate(b));
}

function chainToAnchor(leaf, pool, anchors, at) {
  const path = [leaf.subject];
  let cur = leaf;
  for (let depth = 0; depth < 8; depth++) {
    if (anchors.some((a) => a.fingerprint256 === cur.fingerprint256)) return path;
    const anchor = anchors.find((a) => cur.checkIssued(a) && cur.verify(a.publicKey));
    if (anchor) {
      if (!within(anchor, at)) fail(`trust anchor ${anchor.subject} was not valid at genTime`);
      path.push(anchor.subject);
      return path;
    }
    const next = pool.find((c) => c.fingerprint256 !== cur.fingerprint256 && c.ca && cur.checkIssued(c) && cur.verify(c.publicKey));
    if (!next) fail(`chain does not reach the configured trust anchor (no verifying issuer for ${cur.subject.replace(/\n/g, ', ')})`);
    if (!within(next, at)) fail(`intermediate ${next.subject.replace(/\n/g, ', ')} was not valid at genTime`);
    path.push(next.subject);
    cur = next;
  }
  fail('chain longer than 8 certificates');
}

// Throws TsaError on any failure; returns the verdict for a structurally and cryptographically valid token.
export function verifyResponse({ record, response, nonce, anchors = null }) {
  let resp, tok;
  try { resp = parseResponse(response); }
  catch (e) { fail(`response does not parse: ${e.message}`); }
  if (resp.statusCode > 1) fail(`TSA status ${resp.status}${resp.statusText ? `: ${resp.statusText}` : ''}`);
  if (!resp.token) fail('response granted but carries no token');
  try { tok = parseToken(resp.token); }
  catch (e) { fail(e instanceof TsaError ? e.message : `token does not parse: ${e.message}`); }
  const { tstInfo, signer } = tok;

  if (tstInfo.hashAlg !== OID.sha256) fail(`messageImprint uses ${tstInfo.hashAlg}, not the SHA-256 that was requested`);
  if (tstInfo.imprint !== sha256(record).toString('hex')) fail('messageImprint does not equal the record\'s SHA-256 — the record changed after it was stamped, or the token is for another record');
  if (nonce == null) fail('no request nonce to compare against');
  if (tstInfo.nonce == null) fail('token carries no nonce');
  if (BigInt(`0x${tstInfo.nonce}`) !== BigInt(`0x${nonce}`)) fail('token nonce does not match the request nonce');

  if (!signer.signedAttrs) fail('SignerInfo has no signed attributes');
  const ct = signer.attrs[OID.contentType], md = signer.attrs[OID.messageDigest];
  if (!ct || der.readOid(ct) !== OID.tstInfo) fail('contentType attribute is missing or is not id-ct-TSTInfo');
  if (!md) fail('messageDigest attribute is missing');
  const digest = HASH_BY_OID[signer.digestAlg];
  if (!digest) fail(WEAK_HASH[signer.digestAlg] ? `digest algorithm ${WEAK_HASH[signer.digestAlg]} is refused` : `unsupported digest algorithm ${signer.digestAlg}`);
  if (!createHash(digest).update(tok.eContent).digest().equals(der.expect(md, TAG.OCTET_STRING, 'messageDigest').content)) fail('messageDigest does not equal the hash of the TSTInfo — the signed content was altered');

  let tokenCerts;
  try { tokenCerts = tok.certs.map((c) => new X509Certificate(c)); }
  catch (e) { fail(`a certificate in the token does not parse: ${e.message}`); }
  const cert = findSigner(signer.sid, [...tokenCerts, ...(anchors || [])]);
  if (!cert) fail('the signing certificate is not in the token (certReq not honoured) and not among the configured anchors');
  checkCertBinding(signer.attrs, cert);
  checkSignature(signer, cert);
  if (!ekuOf(cert).includes(OID.ekuTimeStamping)) fail('signing certificate lacks the timeStamping extended key usage');
  if (!within(cert, tstInfo.genTime)) fail(`signing certificate was not valid at genTime ${tstInfo.genTime}`);

  const base = {
    genTime: tstInfo.genTime, genTimeText: tstInfo.genTimeText, serialNumber: tstInfo.serialNumber, policy: tstInfo.policy,
    imprint: tstInfo.imprint, hashAlgorithm: 'sha256', nonce: 'matched', tsa: cert.subject.replace(/\n/g, ', '),
    revocation: 'not checked',
  };
  if (!anchors) return { state: 'unanchored', summary: 'signature valid, chain not anchored', ...base };
  const chain = chainToAnchor(cert, tokenCerts, anchors, tstInfo.genTime);
  return { state: 'anchored', summary: 'signature valid, chain anchored to CW_TSA_CA', chain: chain.map((s) => s.replace(/\n/g, ', ')), ...base };
}

// CW_TSA_CA is read here, per call. Unset → null (unanchored). Set but unreadable → fail closed:
// a configured anchor that cannot be read is not the same as no anchor.
export function loadAnchors(env = process.env) {
  const p = env.CW_TSA_CA;
  if (!p) return null;
  let text;
  try { text = readFileSync(p, 'utf8'); }
  catch (e) { fail(`CW_TSA_CA (${p}) could not be read: ${e.code || e.message}`); }
  let certs;
  try { certs = parsePemBundle(text); }
  catch (e) { fail(`CW_TSA_CA (${p}) holds a certificate that does not parse: ${e.message}`); }
  if (!certs.length) fail(`CW_TSA_CA (${p}) holds no PEM certificate`);
  return certs;
}

export const tokenPaths = (record) => ({ tsq: `${record}.tsq`, tsr: `${record}.tsr` });

function readOrAbsent(path) {
  try { return readFileSync(path); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// One record → one verdict object; never throws.
export function verifyStamp(record, { env = process.env } = {}) {
  const { tsq, tsr } = tokenPaths(record);
  const invalid = (reason) => ({ record, state: 'invalid', reason });
  try {
    const bytes = readOrAbsent(record);
    if (!bytes) return invalid('the evidence record itself is missing');
    const resp = readOrAbsent(tsr);
    if (!resp) return { record, state: 'absent', reason: `no token at ${tsr}` };
    const req = readOrAbsent(tsq);
    if (!req) return invalid(`no request at ${tsq}, so the token's nonce cannot be checked`);
    let parsedReq;
    try { parsedReq = parseRequest(req); }
    catch (e) { return invalid(`stored request does not parse: ${e.message}`); }
    if (parsedReq.imprint !== sha256(bytes).toString('hex')) return invalid('stored request was made for different record bytes');
    return { record, ...verifyResponse({ record: bytes, response: resp, nonce: parsedReq.nonce, anchors: loadAnchors(env) }) };
  } catch (e) {
    return invalid(e instanceof TsaError ? e.message : `${e.code || 'error'}: ${e.message}`);
  }
}

// POSTs the request, verifies the reply against the record and nonce, and only then writes .tsq/.tsr.
// `.tsq` lands first: a crash between the two leaves a nonce mismatch that verify reports, never a pass.
export async function requestStamp(record, { env = process.env, fetchImpl = globalThis.fetch, nonce } = {}) {
  const url = env.CW_TSA_URL;
  if (!url) throw new TsaError('CW_TSA_URL is not set — no Time-Stamp Authority to ask', 'no-url');
  if (!/^https?:\/\//i.test(url)) throw new TsaError(`CW_TSA_URL must be http(s): ${url}`, 'no-url');
  const bytes = readFileSync(record);
  const req = buildRequest(bytes, nonce ? { nonce } : {});
  const timeoutMs = Number(env.CW_TSA_TIMEOUT_MS) || 30_000;
  let res, body;
  try {
    res = await fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/timestamp-query', accept: 'application/timestamp-reply' },
      body: req.der, signal: AbortSignal.timeout(timeoutMs),
    });
    body = Buffer.from(await res.arrayBuffer());
  } catch (e) { throw new TsaError(`request to ${url} failed: ${e.message}`, 'request-failed'); }
  if (!res.ok) throw new TsaError(`TSA answered HTTP ${res.status}`, 'request-failed');
  if (body.length > MAX_RESPONSE_BYTES) throw new TsaError(`TSA response is ${body.length} bytes, over the ${MAX_RESPONSE_BYTES} cap`, 'request-failed');
  const verdict = verifyResponse({ record: bytes, response: body, nonce: req.nonce, anchors: loadAnchors(env) });
  const { tsq, tsr } = tokenPaths(record);
  writeAtomic(tsq, req.der);
  writeAtomic(tsr, body);
  return { record, ...verdict, tsq, tsr };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────

function defaultRecords() {
  const dir = join(resolvePaths().out, 'signatures');
  let names;
  try { names = readdirSync(dir); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return names.filter((n) => n.endsWith('.sig')).sort().map((n) => join(dir, n));
}

export function exitFor(results) {
  if (!results.length) return EXIT.ABSENT;
  if (results.some((r) => r.state === 'invalid')) return EXIT.INVALID;
  if (results.some((r) => r.state === 'absent')) return EXIT.ABSENT;
  if (results.some((r) => r.state === 'unanchored')) return EXIT.UNANCHORED;
  return 0;
}

function line(r) {
  if (r.state === 'anchored' || r.state === 'unanchored') return `  ${r.state.padEnd(10)} ${r.record}  genTime ${r.genTime}  (${r.summary}; tsa ${r.tsa}; revocation not checked)`;
  return `  ${r.state.padEnd(10)} ${r.record}  ${r.reason}`;
}

async function main(argv) {
  const cmd = argv[0];
  const json = argv.includes('--json');
  const files = argv.slice(1).filter((a) => a !== '--json');
  if (cmd !== 'stamp' && cmd !== 'verify') {
    console.log(`usage: node cra/timestamp.mjs <stamp|verify> [record ...] [--json]
  stamp    ask CW_TSA_URL for an RFC 3161 token over each record; writes <record>.tsq + <record>.tsr
  verify   check each token: imprint, nonce, CMS signature, and the chain when CW_TSA_CA is set
default records: every signatures/*.sig under the CRA output directory
exit: 0 all anchored · ${EXIT.UNANCHORED} valid but unanchored · ${EXIT.ABSENT} a token or record set is absent · ${EXIT.INVALID} invalid · ${EXIT.REQUEST_FAILED} stamp request failed · 2 usage
env: CW_TSA_URL (stamp), CW_TSA_CA (PEM trust anchor), CW_TSA_TIMEOUT_MS; standard CW_* CRA overrides apply`);
    return cmd ? 2 : 0;
  }
  const records = files.length ? files : defaultRecords();
  if (!records.length) { console.error('no signed evidence records found (run: node cra/attest.mjs sign)'); return EXIT.ABSENT; }
  const results = [];
  if (cmd === 'stamp') {
    for (const r of records) {
      try { results.push(await requestStamp(r)); }
      catch (e) {
        if (e.code === 'no-url') { console.error(e.message); return 2; }
        results.push({ record: r, state: e.code === 'request-failed' ? 'request-failed' : 'invalid', reason: e.message });
      }
    }
  } else for (const r of records) results.push(verifyStamp(r));
  if (json) console.log(JSON.stringify(results, null, 2));
  else for (const r of results) console.log(line(r));
  if (results.some((r) => r.state === 'request-failed')) return EXIT.REQUEST_FAILED;
  return exitFor(results);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
