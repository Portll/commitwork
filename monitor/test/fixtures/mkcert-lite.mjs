// mkcert-lite — a minimal X.509 issuer for TESTS ONLY, pure node:crypto. Exists because no openssl
// on PATH can mint a certificate with attacker-chosen validity dates (LibreSSL silently ignores a
// negative -days). Limits: RSA-2048 + SHA-256 only; UTCTime, so dates must fall in 1950-2049; no
// SKI/AKI (issuer-name matching covers depth-1 chains). Do not promote into non-test code.

import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

// ── minimal DER ────────────────────────────────────────────────────────────────────────────────
const len = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const b = []; let x = n;
  while (x > 0) { b.unshift(x & 0xff); x >>>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
};
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));
const int = (n) => {
  let b = []; let x = BigInt(n);
  if (x === 0n) b = [0];
  else { while (x > 0n) { b.unshift(Number(x & 0xffn)); x >>= 8n; } if (b[0] & 0x80) b.unshift(0); }
  return tlv(0x02, Buffer.from(b));
};
// DER INTEGER must be minimally encoded: strip leading zeros AND prepend 0x00 on a set high bit —
// a serial starting 0x00 otherwise flakes ~1/256 with ERR_OSSL_ASN1_ILLEGAL_PADDING
const intFromBytes = (buf) => {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;      // strip leading zeros, keep at least one byte
  const trimmed = buf.subarray(i);
  return tlv(0x02, trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
};
const oid = (dotted) => {
  const p = dotted.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) {
    const chunk = []; let x = n;
    do { chunk.unshift(x & 0x7f); x >>>= 7; } while (x > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bitString = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const octetString = (buf) => tlv(0x04, buf);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const explicit = (n, body) => tlv(0xa0 | n, body);
// UTCTime, YYMMDDHHMMSSZ — range-checked: 2051 would silently become 1951 and invert an expiry assertion
const utcTime = (d) => {
  const y = d.getUTCFullYear();
  if (y < 1950 || y > 2049) throw new RangeError(`mkcert-lite: ${y} is outside UTCTime's 1950-2049 range`);
  const p = (n) => String(n).padStart(2, '0');
  return tlv(0x17, Buffer.from(`${p(y % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, 'ascii'));
};

const OID = {
  cn: '2.5.4.3', o: '2.5.4.10', sha256RSA: '1.2.840.113549.1.1.11',
  basicConstraints: '2.5.29.19', subjectAltName: '2.5.29.17', extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};
const rdn = (o, cn) => seq(
  ...(o ? [set(seq(oid(OID.o), utf8(o)))] : []),
  set(seq(oid(OID.cn), utf8(cn))),
);
const algId = seq(oid(OID.sha256RSA), tlv(0x05, Buffer.alloc(0))); // NULL params, per RFC 4055
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octetString(value));
// GeneralName: dNSName [2] IA5String, iPAddress [7] OCTET STRING (4 bytes for v4)
const sanExt = (names) => ext(OID.subjectAltName, false, seq(...names.map((n) => (
  /^\d+\.\d+\.\d+\.\d+$/.test(n)
    ? tlv(0x87, Buffer.from(n.split('.').map(Number)))
    : tlv(0x82, Buffer.from(n, 'ascii'))))));

/**
 * Issue one certificate.
 *
 * @param {object}  o
 * @param {string}  o.cn                      subject CN
 * @param {string[]} [o.san]                  subjectAltName entries (DNS names and/or IPv4 literals)
 * @param {boolean} [o.ca]                    mint a CA (basicConstraints CA:TRUE, critical)
 * @param {Date}    o.notBefore
 * @param {Date}    o.notAfter
 * @param {object}  [o.issuer]                { cn, key } — omit to self-sign
 * @returns {{cert: string, key: string, cn: string}}  PEM
 */
export function issue({ cn, san = [], ca = false, notBefore, notAfter, issuer = null }) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const issuerName = issuer ? rdn('mkcert-lite test CA', issuer.cn) : rdn(ca ? 'mkcert-lite test CA' : null, cn);
  const extensions = [
    ...(ca ? [ext(OID.basicConstraints, true, seq(bool(true)))] : [ext(OID.basicConstraints, true, seq())]),
    ...(san.length ? [sanExt(san)] : []),
    ...(ca ? [] : [ext(OID.extKeyUsage, false, seq(oid(OID.serverAuth)))]),
  ];
  const tbs = seq(
    explicit(0, int(2)),                       // version v3
    intFromBytes(randomBytes(8)),              // serialNumber, positive
    algId,
    issuerName,
    seq(utcTime(notBefore), utcTime(notAfter)),
    rdn(ca ? 'mkcert-lite test CA' : null, cn),
    spki,
    explicit(3, seq(...extensions)),
  );
  const sig = createSign('sha256').update(tbs).sign(issuer ? issuer.key : privateKey);
  const der = seq(tbs, algId, bitString(sig));
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`;
  return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cn, keyObject: privateKey };
}

const DAY = 86400000;

/**
 * A root CA plus a leaf, the shape ~/.cloudflared/origin-ca.pem + the mkcert origin cert have.
 * `days` is the leaf's remaining lifetime: negative issues an ALREADY-EXPIRED certificate, which is
 * the fixture no openssl on this platform can produce.
 */
export function issuePair({ cn, san = [cn], days = 365, now = Date.now() } = {}) {
  const root = issue({
    cn: 'mkcert-lite root', ca: true,
    notBefore: new Date(now - 30 * DAY), notAfter: new Date(now + 3650 * DAY),
  });
  const leaf = issue({
    cn, san,
    notBefore: new Date(Math.min(now - DAY, now + (days - 1) * DAY)),
    notAfter: new Date(now + days * DAY),
    issuer: { cn: 'mkcert-lite root', key: root.keyObject },
  });
  return { root, leaf, ca: root.cert };
}
