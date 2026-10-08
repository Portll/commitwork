// node --test cra/test/timestamp.test.mjs — RFC 3161 client: request encoding, token verification, storage.
//
// No test touches the network. Two sources of tokens:
//  · Built here at run time: a throwaway CA and TSA certificate and a signed TSTInfo, assembled with
//    lib/der.mjs and node:crypto. Keys are generated per run and never written.
//  · fixtures/tsa-openssl/: one token from OpenSSL 3.6 `ts`, made once offline to cross-check the
//    encoder and decoder against an independent implementation. Only public material is kept
//    (the CA certificate is PEM named .crt because .pem is ignored repo-wide):
//      openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 36500 \
//        -subj "/CN=commitwork synthetic test TSA root" -extensions v3_ca   (CA:true, keyCertSign)
//      openssl req -newkey rsa:2048 -nodes -keyout tsa.key -out tsa.csr -subj "/CN=commitwork synthetic test TSA"
//      openssl x509 -req -in tsa.csr -CA ca.crt -CAkey ca.key -out tsa.pem -days 36500 \
//        -extensions v3_tsa   (critical EKU timeStamping, keyUsage digitalSignature)
//      openssl ts -query -data record.sig -sha256 -cert -out record.sig.tsq
//      openssl ts -reply -queryfile record.sig.tsq -signer tsa.pem -inkey tsa.key -chain ca.crt \
//        -out record.sig.tsr   (signer_digest sha256, ess_cert_id_alg sha256, policy 1.3.6.1.4.1.99999.1)
//      openssl ts -verify -data record.sig -in record.sig.tsr -CAfile ca.crt -untrusted tsa.pem  → OK
//    The keys were deleted afterwards. A run-time token built below was also checked once with
//    `openssl ts -verify` → OK, so each implementation accepts the other's output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as cryptoSign, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as der from '../../lib/der.mjs';
import {
  OID, EXIT, buildRequest, parseRequest, parseResponse, verifyResponse, verifyStamp, requestStamp, exitFor, tokenPaths,
} from '../timestamp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'tsa-openssl');
const CLI = resolve(HERE, '..', 'timestamp.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-tsa-test-'));
const sha256 = (b) => createHash('sha256').update(b).digest();

// ── a throwaway PKI ──────────────────────────────────────────────────────────────────────────
const name = (cn) => der.seq(der.set(der.seq(der.oid('2.5.4.3'), der.utf8(cn))));
function sigAlgFor(key) {
  if (key.asymmetricKeyType === 'rsa') return { id: der.seq(der.oid(OID.sha256WithRSA), der.nul()), hash: 'sha256' };
  if (key.asymmetricKeyType === 'ec') return { id: der.seq(der.oid(OID.ecdsaSha256)), hash: 'sha256' };
  return { id: der.seq(der.oid(OID.ed25519)), hash: null };
}
const ext = (id, critical, value) => der.seq(der.oid(id), ...(critical ? [der.bool(true)] : []), der.octets(value));

function makeCert({ cn, issuerCn = cn, publicKey, signKey, serial, ca = false, eku = true, notBefore = '2020-01-01T00:00:00Z', notAfter = '2049-12-31T00:00:00Z' }) {
  const exts = [ext('2.5.29.19', true, ca ? der.seq(der.bool(true)) : der.seq())];
  exts.push(ext('2.5.29.15', true, ca ? der.tlv(0x03, [0x01, 0x06]) : der.tlv(0x03, [0x07, 0x80])));
  if (!ca && eku) exts.push(ext('2.5.29.37', true, der.seq(der.oid(OID.ekuTimeStamping))));
  const alg = sigAlgFor(signKey);
  const tbs = der.seq(
    der.ctx(0, der.int(2)), der.int(serial), alg.id, name(issuerCn),
    der.seq(der.utcTime(notBefore), der.utcTime(notAfter)), name(cn),
    publicKey.export({ type: 'spki', format: 'der' }), der.ctx(3, der.seq(...exts)),
  );
  return new X509Certificate(der.seq(tbs, alg.id, der.bitString(cryptoSign(alg.hash, tbs, signKey))));
}

const caKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const tsaKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CA = makeCert({ cn: 'synthetic root', publicKey: caKeys.publicKey, signKey: caKeys.privateKey, serial: 1, ca: true });
const TSA = makeCert({ cn: 'synthetic tsa', issuerCn: 'synthetic root', publicKey: tsaKeys.publicKey, signKey: caKeys.privateKey, serial: 2 });

// A TimeStampResp. `tamper` hooks break exactly one property each.
function makeResponse({ record, nonce, key = tsaKeys.privateKey, cert = TSA, issuerCn = 'synthetic root', serial = 2, certs = [cert, CA], genTime = '2026-10-08T01:02:03.250Z', status = 0, tamper = {} }) {
  const tst = der.seq(
    der.int(1), der.oid('1.3.6.1.4.1.99999.7'),
    der.seq(der.seq(der.oid(OID.sha256), der.nul()), der.octets(tamper.imprint ?? sha256(record))),
    der.int(42), der.genTime(genTime), der.int(BigInt(`0x${nonce}`)),
  );
  const eContent = tamper.eContent ?? tst;
  const certHash = sha256((tamper.boundCert ?? cert).raw);
  const attrs = [
    der.seq(der.oid(OID.contentType), der.set(der.oid(OID.tstInfo))),
    der.seq(der.oid(OID.messageDigest), der.set(der.octets(sha256(tst)))),
    ...(tamper.noBinding ? [] : [der.seq(der.oid(OID.signingCertificateV2), der.set(der.seq(der.seq(der.seq(der.octets(certHash))))))]),
  ].sort(Buffer.compare);
  const attrBody = Buffer.concat(attrs);
  const alg = sigAlgFor(key);
  const signature = cryptoSign(alg.hash, der.tlv(der.TAG.SET, attrBody), key);
  const signerInfo = der.seq(
    der.int(1), der.seq(name(issuerCn), der.int(serial)), der.seq(der.oid(OID.sha256), der.nul()),
    der.tlv(0xa0, attrBody), alg.id, der.octets(signature),
  );
  const signedData = der.seq(
    der.int(3), der.set(der.seq(der.oid(OID.sha256), der.nul())),
    der.seq(der.oid(OID.tstInfo), der.ctx(0, der.octets(eContent))),
    ...(certs.length ? [der.ctx(0, ...certs.map((c) => c.raw))] : []),
    der.set(signerInfo),
  );
  const statusInfo = status ? der.seq(der.int(status), der.seq(der.utf8('policy not accepted'))) : der.seq(der.int(0));
  return status ? der.seq(statusInfo) : der.seq(statusInfo, der.seq(der.oid(OID.signedData), der.ctx(0, signedData)));
}

const RECORD = Buffer.from('{"role":"rollup","algo":"ed25519","digest":"00","signature":"AA=="}\n');
const NONCE = '1f2e3d4c5b6a7988';
const caPem = join(T, 'ca.pem');
writeFileSync(caPem, CA.toString());

function stampedRecord(label, { record = RECORD, nonce = NONCE, ...opts } = {}) {
  const p = join(T, `${label}.sig`);
  writeFileSync(p, record);
  writeFileSync(`${p}.tsq`, buildRequest(record, { nonce: Buffer.from(nonce, 'hex') }).der);
  writeFileSync(`${p}.tsr`, makeResponse({ record, nonce, ...opts }));
  return p;
}
const reasonOf = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };

// ── request encoding ─────────────────────────────────────────────────────────────────────────

test('buildRequest is byte-identical to the request OpenSSL made for the same record and nonce', () => {
  const theirs = readFileSync(join(FIX, 'record.sig.tsq'));
  const q = parseRequest(theirs);
  assert.equal(q.certReq, true);
  const ours = buildRequest(readFileSync(join(FIX, 'record.sig')), { nonce: Buffer.from(q.nonce, 'hex') });
  assert.ok(ours.der.equals(theirs), 'encoder disagrees with openssl ts -query');
});

test('a request carries a SHA-256 imprint of the record, the nonce, and certReq true', () => {
  const r = buildRequest(RECORD, { nonce: Buffer.from('ff00', 'hex') });
  const q = parseRequest(r.der);
  assert.deepEqual(q, { hashAlg: OID.sha256, imprint: sha256(RECORD).toString('hex'), nonce: 'ff00', certReq: true });
});

// ── the OpenSSL token ────────────────────────────────────────────────────────────────────────

test('the OpenSSL token verifies: unanchored without CW_TSA_CA, anchored with its CA', () => {
  const rec = join(FIX, 'record.sig');
  const bare = verifyStamp(rec, { env: {} });
  assert.equal(bare.state, 'unanchored', bare.reason);
  assert.equal(bare.summary, 'signature valid, chain not anchored');
  assert.equal(bare.genTime, '2026-10-07T23:17:33.000Z');
  assert.equal(bare.policy, '1.3.6.1.4.1.99999.1');
  assert.equal(bare.revocation, 'not checked');
  const anchored = verifyStamp(rec, { env: { CW_TSA_CA: join(FIX, 'ca.crt') } });
  assert.equal(anchored.state, 'anchored', anchored.reason);
  assert.equal(anchored.chain.length, 2);
});

test('the OpenSSL token does not verify against bytes it was not made for', () => {
  const p = join(T, 'openssl-changed.sig');
  const bytes = readFileSync(join(FIX, 'record.sig'));
  bytes[5] ^= 1;
  writeFileSync(p, bytes);
  copyFileSync(join(FIX, 'record.sig.tsq'), `${p}.tsq`);
  copyFileSync(join(FIX, 'record.sig.tsr'), `${p}.tsr`);
  const v = verifyStamp(p, { env: {} });
  assert.equal(v.state, 'invalid');
  assert.match(v.reason, /different record bytes/);
});

// ── run-time tokens ──────────────────────────────────────────────────────────────────────────

test('a valid token is unanchored with no anchor, anchored with the issuing CA, and never "trusted" without one', () => {
  const p = stampedRecord('ok');
  const v = verifyStamp(p, { env: {} });
  assert.equal(v.state, 'unanchored', v.reason);
  assert.equal(v.genTime, '2026-10-08T01:02:03.250Z');
  assert.equal(v.genTimeText, '20261008010203.25Z');
  assert.equal(v.nonce, 'matched');
  assert.ok(!('chain' in v));
  const a = verifyStamp(p, { env: { CW_TSA_CA: caPem } });
  assert.equal(a.state, 'anchored', a.reason);
  assert.deepEqual(a.chain, ['CN=synthetic tsa', 'CN=synthetic root']);
});

test('CW_TSA_CA is read at call time from process.env', () => {
  const p = stampedRecord('ambient');
  const was = process.env.CW_TSA_CA;
  process.env.CW_TSA_CA = caPem;
  try { assert.equal(verifyStamp(p).state, 'anchored'); }
  finally { if (was === undefined) delete process.env.CW_TSA_CA; else process.env.CW_TSA_CA = was; }
});

test('tamper: one changed record byte → invalid imprint', () => {
  const p = stampedRecord('tamper-record');
  const bytes = readFileSync(p); bytes[2] ^= 1;
  const reason = reasonOf(() => verifyResponse({ record: bytes, response: readFileSync(`${p}.tsr`), nonce: NONCE }));
  assert.match(reason, /messageImprint does not equal/);
});

test('tamper: a different nonce → invalid', () => {
  const p = stampedRecord('tamper-nonce');
  writeFileSync(`${p}.tsq`, buildRequest(RECORD, { nonce: Buffer.from('1f2e3d4c5b6a7989', 'hex') }).der);
  const v = verifyStamp(p, { env: {} });
  assert.equal(v.state, 'invalid');
  assert.match(v.reason, /nonce does not match/);
});

test('tamper: a swapped certificate → invalid, whether or not the binding attribute was rewritten', () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const imposter = makeCert({ cn: 'synthetic tsa', issuerCn: 'synthetic root', publicKey: other.publicKey, signKey: caKeys.privateKey, serial: 2 });
  const swapped = makeResponse({ record: RECORD, nonce: NONCE, certs: [imposter, CA] });
  assert.match(reasonOf(() => verifyResponse({ record: RECORD, response: swapped, nonce: NONCE })), /names a different certificate/);
  const rebound = makeResponse({ record: RECORD, nonce: NONCE, certs: [imposter, CA], tamper: { boundCert: imposter } });
  assert.match(reasonOf(() => verifyResponse({ record: RECORD, response: rebound, nonce: NONCE })), /signature does not verify/);
});

test('tamper: TSTInfo altered after signing → messageDigest mismatch', () => {
  const resp = makeResponse({ record: RECORD, nonce: NONCE, tamper: { eContent: der.seq(der.int(1), der.oid('1.3.6.1.4.1.99999.7'), der.seq(der.seq(der.oid(OID.sha256), der.nul()), der.octets(sha256(RECORD))), der.int(42), der.genTime('2020-01-01T00:00:00Z'), der.int(BigInt(`0x${NONCE}`))) } });
  assert.match(reasonOf(() => verifyResponse({ record: RECORD, response: resp, nonce: NONCE })), /messageDigest does not equal/);
});

test('a token with no signing-certificate attribute is refused', () => {
  const resp = makeResponse({ record: RECORD, nonce: NONCE, tamper: { noBinding: true } });
  assert.match(reasonOf(() => verifyResponse({ record: RECORD, response: resp, nonce: NONCE })), /no signing-certificate attribute/);
});

test('a TSA certificate without the timeStamping EKU is refused', () => {
  const noEku = makeCert({ cn: 'synthetic tsa', issuerCn: 'synthetic root', publicKey: tsaKeys.publicKey, signKey: caKeys.privateKey, serial: 2, eku: false });
  const resp = makeResponse({ record: RECORD, nonce: NONCE, cert: noEku });
  assert.match(reasonOf(() => verifyResponse({ record: RECORD, response: resp, nonce: NONCE })), /timeStamping/);
});

test('genTime outside the TSA certificate\'s validity is refused', () => {
  const resp = makeResponse({ record: RECORD, nonce: NONCE, genTime: '2019-06-01T00:00:00Z' });
  assert.match(reasonOf(() => verifyResponse({ record: RECORD, response: resp, nonce: NONCE })), /not valid at genTime/);
});

test('a token whose signing certificate is absent and not among the anchors is refused', () => {
  const resp = makeResponse({ record: RECORD, nonce: NONCE, certs: [] });
  assert.match(reasonOf(() => verifyResponse({ record: RECORD, response: resp, nonce: NONCE })), /not in the token/);
});

test('ECDSA and Ed25519 TSA keys verify', () => {
  for (const type of ['ec', 'ed25519']) {
    const k = generateKeyPairSync(type, type === 'ec' ? { namedCurve: 'P-256' } : {});
    const cert = makeCert({ cn: `synthetic ${type} tsa`, issuerCn: 'synthetic root', publicKey: k.publicKey, signKey: caKeys.privateKey, serial: 9 });
    const resp = makeResponse({ record: RECORD, nonce: NONCE, key: k.privateKey, cert, serial: 9 });
    assert.equal(verifyResponse({ record: RECORD, response: resp, nonce: NONCE, anchors: [CA] }).state, 'anchored', type);
  }
});

test('an anchor that did not issue the chain → invalid, not unanchored', () => {
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const otherCa = makeCert({ cn: 'unrelated root', publicKey: other.publicKey, signKey: other.privateKey, serial: 5, ca: true });
  const pem = join(T, 'other-ca.pem');
  writeFileSync(pem, otherCa.toString());
  const v = verifyStamp(stampedRecord('wrong-anchor'), { env: { CW_TSA_CA: pem } });
  assert.equal(v.state, 'invalid');
  assert.match(v.reason, /does not reach the configured trust anchor/);
});

test('a configured anchor that cannot be read fails closed', () => {
  const p = stampedRecord('missing-anchor');
  const v = verifyStamp(p, { env: { CW_TSA_CA: join(T, 'no-such-ca.pem') } });
  assert.equal(v.state, 'invalid');
  assert.match(v.reason, /CW_TSA_CA .* could not be read: ENOENT/);
  const empty = join(T, 'empty-ca.pem');
  writeFileSync(empty, 'not a certificate\n');
  assert.match(verifyStamp(p, { env: { CW_TSA_CA: empty } }).reason, /holds no PEM certificate/);
});

test('absent, missing request, unparseable token, and TSA rejection are distinct outcomes', () => {
  const p = join(T, 'unstamped.sig');
  writeFileSync(p, RECORD);
  assert.equal(verifyStamp(p, { env: {} }).state, 'absent');

  const noReq = stampedRecord('no-req');
  writeFileSync(`${noReq}.tsq`, '');
  assert.equal(verifyStamp(noReq, { env: {} }).state, 'invalid');

  const garbage = stampedRecord('garbage');
  writeFileSync(`${garbage}.tsr`, Buffer.from([0x30, 0x80, 0x00, 0x00]));
  const g = verifyStamp(garbage, { env: {} });
  assert.equal(g.state, 'invalid');
  assert.match(g.reason, /does not parse.*indefinite length/);

  const rejected = makeResponse({ record: RECORD, nonce: NONCE, status: 2 });
  assert.equal(parseResponse(rejected).status, 'rejection');
  assert.match(reasonOf(() => verifyResponse({ record: RECORD, response: rejected, nonce: NONCE })), /TSA status rejection: policy not accepted/);

  assert.equal(verifyStamp(join(T, 'never-written.sig'), { env: {} }).state, 'invalid');
});

// ── requestStamp: the POST, against an in-process fake ──────────────────────────────────────

function fakeTsa({ respond = (reqDer, q) => makeResponse({ record: RECORD, nonce: q.nonce }), status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const q = parseRequest(init.body);
    const body = respond(init.body, q);
    return { ok: status === 200, status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  return { calls, fetchImpl };
}

test('requestStamp POSTs a timestamp-query to CW_TSA_URL, verifies the reply, then writes .tsq and .tsr', async () => {
  const p = join(T, 'post.sig');
  writeFileSync(p, RECORD);
  const tsa = fakeTsa();
  const r = await requestStamp(p, { env: { CW_TSA_URL: 'https://tsa.invalid/tsr' }, fetchImpl: tsa.fetchImpl });
  assert.equal(r.state, 'unanchored');
  assert.equal(tsa.calls.length, 1);
  assert.equal(tsa.calls[0].url, 'https://tsa.invalid/tsr');
  assert.equal(tsa.calls[0].init.method, 'POST');
  assert.equal(tsa.calls[0].init.headers['content-type'], 'application/timestamp-query');
  assert.equal(parseRequest(tsa.calls[0].init.body).certReq, true);
  const { tsq, tsr } = tokenPaths(p);
  assert.ok(readFileSync(tsq).equals(tsa.calls[0].init.body));
  assert.equal(verifyStamp(p, { env: { CW_TSA_CA: caPem } }).state, 'anchored');
  assert.ok(existsSync(tsr));
});

test('requestStamp makes no call without CW_TSA_URL', async () => {
  const p = join(T, 'no-url.sig');
  writeFileSync(p, RECORD);
  const tsa = fakeTsa();
  await assert.rejects(requestStamp(p, { env: {}, fetchImpl: tsa.fetchImpl }), (e) => e.code === 'no-url');
  assert.equal(tsa.calls.length, 0);
});

test('requestStamp writes nothing when the reply is a replay (wrong nonce) or an HTTP error', async () => {
  const p = join(T, 'replay.sig');
  writeFileSync(p, RECORD);
  const replay = fakeTsa({ respond: () => makeResponse({ record: RECORD, nonce: '01' }) });
  await assert.rejects(requestStamp(p, { env: { CW_TSA_URL: 'http://tsa.invalid' }, fetchImpl: replay.fetchImpl }), /nonce does not match/);
  const down = fakeTsa({ status: 503 });
  await assert.rejects(requestStamp(p, { env: { CW_TSA_URL: 'http://tsa.invalid' }, fetchImpl: down.fetchImpl }), (e) => e.code === 'request-failed');
  assert.ok(!existsSync(`${p}.tsq`) && !existsSync(`${p}.tsr`));
});

// ── verdict exits ────────────────────────────────────────────────────────────────────────────

test('exit codes: invalid > absent > unanchored > anchored, and nothing measured is not a pass', () => {
  assert.equal(exitFor([{ state: 'anchored' }]), 0);
  assert.equal(exitFor([{ state: 'anchored' }, { state: 'unanchored' }]), EXIT.UNANCHORED);
  assert.equal(exitFor([{ state: 'unanchored' }, { state: 'absent' }]), EXIT.ABSENT);
  assert.equal(exitFor([{ state: 'absent' }, { state: 'invalid' }]), EXIT.INVALID);
  assert.equal(exitFor([]), EXIT.ABSENT);
  for (const code of Object.values(EXIT)) assert.ok(code >= 20);
});

test('CLI verify reports JSON and exits with the verdict code', () => {
  const p = stampedRecord('cli');
  const env = { ...process.env };
  delete env.CW_TSA_CA;
  const run = (extra) => spawnSync(process.execPath, [CLI, 'verify', p, '--json'], { env: { ...env, ...extra }, encoding: 'utf8' });
  const bare = run({});
  assert.equal(bare.status, EXIT.UNANCHORED, bare.stderr);
  assert.equal(JSON.parse(bare.stdout)[0].state, 'unanchored');
  assert.equal(run({ CW_TSA_CA: caPem }).status, 0);
});
