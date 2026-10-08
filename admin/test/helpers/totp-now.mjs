// The current TOTP code for a base32 secret — RFC 6238, SHA-1, 6 digits, 30-second step.
//
// Extracted because it was inlined twice inside `execFileSync` string literals in
// admin/test/auth-sso.test.mjs, where it is unreadable and unshareable. A third copy was about to
// be written for the SSO second-factor tests.
//
// It re-implements rather than importing auth.mjs's verifyTotp on purpose: a test that generates
// codes with the same function that checks them proves only that the function agrees with itself.
// This is the independent side of the pair.
import { createHmac } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** base32 -> bytes. Ignores padding and any character outside the alphabet. */
export function base32Decode(s) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(s || '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i === -1) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** @param {string} secretB32 @param {number} [nowMs] @param {number} [stepOffset] +1/-1 to reach a neighbouring window */
export function totpNow(secretB32, nowMs = Date.now(), stepOffset = 0) {
  const step = Math.floor(nowMs / 1000 / 30) + stepOffset;
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  b.writeUInt32BE(step >>> 0, 4);
  const mac = createHmac('sha1', base32Decode(secretB32)).update(b).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const n = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(n % 1e6).padStart(6, '0');
}
