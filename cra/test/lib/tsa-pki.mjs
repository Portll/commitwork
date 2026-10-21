// A throwaway RFC 3161 PKI for tests: a CA, a TSA certificate and signed TimeStampResps, built
// with lib/der.mjs and node:crypto. Keys are generated per call and never written.
import { createHash, generateKeyPairSync, sign as cryptoSign, X509Certificate } from 'node:crypto';
import * as der from '../../../lib/der.mjs';
import { OID } from '../../timestamp.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest();

export const name = (cn) => der.seq(der.set(der.seq(der.oid('2.5.4.3'), der.utf8(cn))));

export function sigAlgFor(key) {
  if (key.asymmetricKeyType === 'rsa') return { id: der.seq(der.oid(OID.sha256WithRSA), der.nul()), hash: 'sha256' };
  if (key.asymmetricKeyType === 'ec') return { id: der.seq(der.oid(OID.ecdsaSha256)), hash: 'sha256' };
  return { id: der.seq(der.oid(OID.ed25519)), hash: null };
}

const ext = (id, critical, value) => der.seq(der.oid(id), ...(critical ? [der.bool(true)] : []), der.octets(value));

export function makeCert({ cn, issuerCn = cn, publicKey, signKey, serial, ca = false, eku = true, notBefore = '2020-01-01T00:00:00Z', notAfter = '2049-12-31T00:00:00Z' }) {
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

// A root CA and a TSA certificate it issued, and a TimeStampResp builder signing with them.
export function makePki() {
  const caKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const tsaKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const CA = makeCert({ cn: 'synthetic root', publicKey: caKeys.publicKey, signKey: caKeys.privateKey, serial: 1, ca: true });
  const TSA = makeCert({ cn: 'synthetic tsa', issuerCn: 'synthetic root', publicKey: tsaKeys.publicKey, signKey: caKeys.privateKey, serial: 2 });

  // `imprint` defaults to the record's SHA-256; a TSA server that holds only the request passes it.
  // `tamper` hooks break exactly one property each.
  function makeResponse({ record, imprint = sha256(record), nonce, key = tsaKeys.privateKey, cert = TSA, issuerCn = 'synthetic root', serial = 2, certs = [cert, CA], genTime = '2026-10-08T01:02:03.250Z', status = 0, tamper = {} }) {
    const tst = der.seq(
      der.int(1), der.oid('1.3.6.1.4.1.99999.7'),
      der.seq(der.seq(der.oid(OID.sha256), der.nul()), der.octets(imprint)),
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

  return { caKeys, tsaKeys, CA, TSA, makeResponse };
}
